#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_BRANCH } from './lib/config.mjs';
import * as git from './lib/git.mjs';
import { ensure, isIgnored, localBranchExists } from './lib/worktree.mjs';
import { isMainModule } from './lib/cli.mjs';
import { mapUrl, originRepo } from './lib/site.mjs';
import { writeReport } from './report.mjs';

/**
 * Commits whatever changed in the data worktree and pushes the data branch,
 * which is what the site reads. Runs after every answer, so it also pushes
 * commits an earlier, failed push left behind. Never forces: these results
 * are the only record, and a rejected push is reported, not overwritten.
 */
export async function publish(cwd, { branch = DATA_BRANCH, push = true } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  const dir = await ensure(repoRoot, { branch });

  // Maps used to be rendered into this folder; the site replaced them.
  await fs.rm(path.join(dir, 'local.html'), { force: true });

  // The worktree holds only KenMap's own files, so staging everything is safe.
  await git.raw(dir, ['add', '-A']);
  const staged = await git.raw(dir, ['diff', '--cached', '--name-only']);
  const committed = staged.trim() !== '';
  if (committed) await git.raw(dir, ['commit', '-q', '-m', 'chore: update comprehension report']);

  if (!(await localBranchExists(repoRoot, branch))) return { pushed: false, committed, reason: 'nothing recorded yet' };
  if (!push) return { pushed: false, committed, reason: 'commit only, push skipped' };

  try {
    await git.raw(repoRoot, ['remote', 'get-url', 'origin']);
  } catch {
    return { pushed: false, committed, reason: 'no origin remote — the commit is local only' };
  }

  await git.raw(dir, ['push', '-q', '-u', 'origin', `${branch}:${branch}`]);
  return { pushed: true, committed, branch, repo: await originRepo(repoRoot), ignored: await isIgnored(repoRoot) };
}

/**
 * publish(), shaped for the reply after an answer: whether the site now has
 * the new score, and the link to it. A failed push never loses the answer —
 * it is already committed locally, and the next sync pushes it.
 */
export async function sync(cwd) {
  const repoRoot = await git.repoRoot(cwd);
  const repo = await originRepo(repoRoot);
  const map = repo ? mapUrl(repo) : null;
  try {
    const result = await publish(repoRoot);
    return { synced: result.pushed, syncError: result.pushed ? null : result.reason, map };
  } catch (err) {
    return { synced: false, syncError: reason(err.message), map };
  }
}

/** The line of a git failure worth showing a person, e.g. "! [rejected] ... (fetch first)". */
function reason(message) {
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /rejected|denied|could not|fatal|error/i.test(l) && !/^git .* failed:$/.test(l))
    ?? lines.at(-1) ?? 'push failed';
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    'no-push': { type: 'boolean', default: false },
  } });
  // Run by hand, the report may be older than the code: rescore first, so
  // what the site shows matches HEAD.
  await writeReport(await git.repoRoot(values.repo));
  const result = await publish(values.repo, { push: !values['no-push'] });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
