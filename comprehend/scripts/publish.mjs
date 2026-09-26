#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DATA_BRANCH } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { ensure, isIgnored } from './lib/worktree.mjs';

/** Pushes the data branch. Never force: these results are the only record. */
export async function publish(cwd, { branch = DATA_BRANCH, push = true } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  const dir = await ensure(repoRoot, { branch });

  // The worktree holds only KenMap's own files, and its .gitignore keeps
  // local.html out, so staging everything there is safe.
  await git.raw(dir, ['add', '-A']);
  const staged = await git.raw(dir, ['diff', '--cached', '--name-only']);
  if (staged.trim() === '') return { pushed: false, reason: 'nothing changed since the last publish' };

  await git.raw(dir, ['commit', '-q', '-m', 'chore: update comprehension report']);
  if (!push) return { pushed: false, reason: 'commit only, push skipped' };

  let hasRemote = true;
  try {
    await git.raw(repoRoot, ['remote', 'get-url', 'origin']);
  } catch {
    hasRemote = false;
  }
  if (!hasRemote) return { pushed: false, reason: 'no origin remote — the commit is local only' };

  await git.raw(dir, ['push', '-q', '-u', 'origin', `${branch}:${branch}`]);
  return { pushed: true, branch, ignored: await isIgnored(repoRoot) };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    'no-push': { type: 'boolean', default: false },
  } });
  const result = await publish(values.repo, { push: !values['no-push'] });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
