#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as config from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { scan } from './scan.mjs';

/**
 * The init conversation proposes module boundaries; this is what actually
 * writes them, so a malformed or empty-matching proposal never reaches disk.
 */
export async function writeConfig(cwd, proposed) {
  const repoRoot = await git.repoRoot(cwd);
  config.validate(proposed);

  const result = await scan(repoRoot, proposed);
  const empty = result.modules.filter((m) => m.fileCount === 0).map((m) => m.id);
  if (empty.length > 0) {
    throw new config.ConfigError(
      `these modules match no files: ${empty.join(', ')} — fix their globs before writing`,
    );
  }

  const file = await config.write(repoRoot, proposed);
  return { file, modules: result.modules.map(({ files, ...m }) => m), unassigned: result.unassigned };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    json: { type: 'string' },
  } });
  const raw = values.json ?? await new Promise((resolve) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (input += c));
    process.stdin.on('end', () => resolve(input));
  });
  const result = await writeConfig(values.repo, JSON.parse(raw));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
