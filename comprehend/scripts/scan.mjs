#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as config from './lib/config.mjs';
import { describe } from './structure.mjs';

/**
 * Maps the discovered files onto the module boundaries frozen in .kenmap.json.
 * A module whose globs match nothing is loud, never silent: dropping it would
 * remove it from the weighted total and make the repo score rise.
 */
export async function scan(cwd, cfg) {
  const described = await describe(cwd);
  const conf = cfg ?? (await config.read(described.repoRoot));

  const moduleOf = new Map();
  const warnings = [];
  const modules = new Map(
    Object.keys(conf.modules).map((id) => [id, { id, globs: conf.modules[id], files: [], loc: 0, generatedFiles: 0 }]),
  );

  for (const file of described.files) {
    const matches = Object.entries(conf.modules)
      .filter(([, globs]) => globs.some((g) => path.matchesGlob(file.path, g)))
      .map(([id]) => id);
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      warnings.push(`${file.path} matches ${matches.join(', ')} — counted in ${matches[0]}`);
    }
    const module = modules.get(matches[0]);
    module.files.push(file.path);
    module.loc += file.loc;
    if (file.generated) module.generatedFiles++;
    moduleOf.set(file.path, matches[0]);
  }

  for (const module of modules.values()) {
    if (module.files.length === 0) {
      warnings.push(`module "${module.id}" matches no files — check its globs in ${config.CONFIG_FILENAME}`);
    }
  }

  const weights = new Map();
  for (const edge of described.edges) {
    const from = moduleOf.get(edge.from);
    const to = moduleOf.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }
  const edges = [...weights].map(([key, weight]) => {
    const [from, to] = key.split('\u0000');
    return { from, to, weight };
  }).sort((a, b) => b.weight - a.weight);

  const assigned = new Set(moduleOf.keys());
  const unassigned = described.files.filter((f) => !assigned.has(f.path));

  return {
    repoRoot: described.repoRoot,
    commit: described.commit,
    modules: [...modules.values()].map(({ files, ...rest }) => ({ ...rest, fileCount: files.length, files })),
    edges,
    unassigned: { fileCount: unassigned.length, loc: unassigned.reduce((n, f) => n + f.loc, 0) },
    warnings,
  };
}

/**
 * Turns whatever the user typed — a module id, or a file/folder path they
 * are looking at right now — into a module id. A path is more natural to
 * hand over than an arbitrary id you have to remember, and scan() already
 * knows which files belong to which module.
 */
export function resolveModule(result, arg) {
  const byId = result.modules.find((m) => m.id === arg);
  if (byId) return { moduleId: byId.id };

  const normalized = arg.replace(/^\.\//, '').replace(/\/+$/, '');
  const candidates = new Set();
  for (const module of result.modules) {
    const hit = module.files?.some((f) => f === normalized || f.startsWith(`${normalized}/`));
    if (hit) candidates.add(module.id);
  }
  if (candidates.size === 0) {
    return { moduleId: null, error: `"${arg}" is not a module id and no module contains that path` };
  }
  if (candidates.size > 1) {
    return { moduleId: null, candidates: [...candidates], error: `"${arg}" spans multiple modules: ${[...candidates].join(', ')}` };
  }
  return { moduleId: [...candidates][0] };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    files: { type: 'boolean', default: false },
    resolve: { type: 'string' },
  } });
  const result = await scan(values.repo);
  if (values.resolve) {
    process.stdout.write(JSON.stringify(resolveModule(result, values.resolve), null, 2) + '\n');
  } else {
    if (!values.files) for (const m of result.modules) delete m.files;
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}
