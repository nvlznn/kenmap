#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_DIR } from './lib/config.mjs';
import { fileEdges, findPackages, languagesUsed } from './lib/edges.mjs';
import { countLines, extensionOf, isBinary, looksGenerated } from './lib/files.mjs';
import * as git from './lib/git.mjs';

/** `pattern linguist-generated` entries in .gitattributes, treated as authoritative. */
function parseGitattributes(text) {
  const patterns = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [pattern, ...attrs] = trimmed.split(/\s+/);
    const generated = attrs.some((a) => a === 'linguist-generated' || a === 'linguist-generated=true');
    if (generated) patterns.push(pattern.replace(/^\//, ''));
  }
  return patterns;
}

function isLinguistGenerated(filePath, patterns) {
  return patterns.some((p) =>
    filePath === p ||
    filePath.startsWith(p.replace(/\/$/, '') + '/') ||
    path.matchesGlob(filePath, p));
}

function dirsOf(filePath) {
  const parts = filePath.split('/');
  parts.pop();
  const dirs = ['.'];
  for (let i = 1; i <= parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
  return dirs;
}

export async function describe(cwd) {
  const repoRoot = await git.repoRoot(cwd);
  if (!(await git.hasCommits(repoRoot))) {
    throw new Error('this repository has no commits yet — KenMap measures committed code');
  }
  const commit = await git.headCommit(repoRoot);

  const tracked = (await git.listTree(repoRoot, commit))
    .filter((f) => !f.path.startsWith(`${DATA_DIR}/`));
  const blobs = await git.readBlobs(repoRoot, tracked.map((f) => f.sha));

  const attributes = tracked.find((f) => f.path === '.gitattributes');
  const generatedPatterns = attributes && blobs.get(attributes.sha)
    ? parseGitattributes(blobs.get(attributes.sha).toString('utf8'))
    : [];

  const files = [];
  for (const file of tracked) {
    const blob = blobs.get(file.sha) ?? Buffer.alloc(0);
    const binary = isBinary(blob);
    files.push({
      path: file.path,
      sha: file.sha,
      ext: extensionOf(file.path),
      binary,
      loc: binary ? 0 : countLines(blob),
      generated: looksGenerated(file.path, {
        linguistGenerated: isLinguistGenerated(file.path, generatedPatterns),
      }),
    });
  }

  const packages = findPackages(tracked, blobs);
  const edges = fileEdges(tracked.filter((f) => !f.path.startsWith(`${DATA_DIR}/`)), blobs, packages);

  return { repoRoot, commit, files, packages, edges, languages: languagesUsed(tracked) };
}

/** Aggregated at every depth so module boundaries can be cut wherever they fit. */
export function summarize({ files, edges }) {
  const dirs = new Map();
  const touch = (path) => {
    if (!dirs.has(path)) {
      dirs.set(path, {
        path, depth: path === '.' ? 0 : path.split('/').length,
        files: 0, loc: 0, generatedFiles: 0, binaryFiles: 0,
        extensions: {}, edgesIn: 0, edgesOut: 0, edgesInternal: 0,
      });
    }
    return dirs.get(path);
  };

  for (const file of files) {
    for (const dir of dirsOf(file.path)) {
      const entry = touch(dir);
      entry.files++;
      entry.loc += file.loc;
      if (file.generated) entry.generatedFiles++;
      if (file.binary) entry.binaryFiles++;
      entry.extensions[file.ext] = (entry.extensions[file.ext] ?? 0) + 1;
    }
  }

  for (const edge of edges) {
    const from = new Set(dirsOf(edge.from));
    const to = new Set(dirsOf(edge.to));
    for (const dir of from) (to.has(dir) ? touch(dir).edgesInternal++ : touch(dir).edgesOut++);
    for (const dir of to) if (!from.has(dir)) touch(dir).edgesIn++;
  }

  return [...dirs.values()]
    .map((d) => ({
      ...d,
      extensions: Object.entries(d.extensions).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([ext, count]) => ({ ext, count })),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function structure(cwd) {
  const described = await describe(cwd);
  const totals = described.files.reduce(
    (acc, f) => ({ files: acc.files + 1, loc: acc.loc + f.loc, generated: acc.generated + (f.generated ? 1 : 0) }),
    { files: 0, loc: 0, generated: 0 },
  );
  return {
    repoRoot: described.repoRoot,
    commit: described.commit,
    totals,
    languages: described.languages,
    packages: described.packages,
    edgeCount: described.edges.length,
    directories: summarize(described),
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { values } = parseArgs({ options: { repo: { type: 'string', default: process.cwd() } } });
  const result = await structure(values.repo);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
