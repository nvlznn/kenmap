#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as config from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { scan } from './scan.mjs';
import { isMainModule } from './lib/cli.mjs';

/**
 * The init conversation proposes module boundaries; this is what actually
 * writes them, so a malformed or empty-matching proposal never reaches disk.
 * `dryRun` runs every check and returns the sizes without writing, so the
 * proposal table shows real line counts instead of the model's arithmetic.
 */
export async function writeConfig(cwd, proposed, { dryRun = false } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  config.validate(proposed);

  const result = await scan(repoRoot, proposed);
  const empty = result.modules.filter((m) => m.fileCount === 0).map((m) => m.id);
  if (empty.length > 0) {
    throw new config.ConfigError(
      `these modules match no files: ${empty.join(', ')} — fix their globs before writing`,
    );
  }

  const modules = result.modules.map(({ files, ...m }) => m);
  const covered = modules.reduce((n, m) => n + m.loc, 0);
  const summary = { modules, covered, unassigned: result.unassigned, warnings: result.warnings };
  if (dryRun) return { written: false, ...summary };
  return { written: true, file: await config.write(repoRoot, proposed), ...summary };
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    json: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  } });
  const raw = values.json ?? await new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (input += c));
    process.stdin.on('end', () => resolve(input));
  });
  const result = await writeConfig(values.repo, JSON.parse(raw), { dryRun: values['dry-run'] });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
