#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_FILENAME, DATA_BRANCH, DATA_DIR, configPath } from './lib/config.mjs';
import { isMainModule } from './lib/cli.mjs';
import * as git from './lib/git.mjs';
import { localBranchExists, pathExists, remoteBranchExists } from './lib/worktree.mjs';

/**
 * Finds what KenMap has left behind in a repo, without touching any of it.
 * This is the thing to run first — and by default the only thing reset()
 * does — because the three things it finds carry very different weight: the
 * config file and worktree are easy to regenerate, but a branch already
 * pushed to origin is visible to anyone else with access to the repo.
 */
export async function status(cwd) {
  const repoRoot = await git.repoRoot(cwd);
  const worktreePath = path.join(repoRoot, DATA_DIR);

  let hasOrigin = true;
  try {
    await git.raw(repoRoot, ['remote', 'get-url', 'origin']);
  } catch {
    hasOrigin = false;
  }

  return {
    repoRoot,
    config: await pathExists(configPath(repoRoot)) ? CONFIG_FILENAME : null,
    worktree: (await pathExists(path.join(worktreePath, '.git'))) ? worktreePath : null,
    localBranch: await localBranchExists(repoRoot, DATA_BRANCH),
    remoteBranch: hasOrigin && (await remoteBranchExists(repoRoot, DATA_BRANCH)),
    hasOrigin,
  };
}

/**
 * `local` removes the config file, the worktree and the local branch — all
 * of it reversible by running /kenmap:comprehend init again. `remote` deletes the
 * branch on origin and must be requested on its own: never inferred from
 * `local`, never defaulted to true. This mirrors deleting nothing unless
 * explicitly told to, at each of the three tiers.
 */
export async function reset(cwd, { local = false, remote = false } = {}) {
  const repoRoot = await git.repoRoot(cwd);
  const before = await status(repoRoot);
  const removed = { config: false, worktree: false, localBranch: false, remoteBranch: false };

  if (local) {
    if (before.config) {
      await fs.rm(configPath(repoRoot));
      removed.config = true;
    }
    if (before.worktree) {
      await git.raw(repoRoot, ['worktree', 'remove', before.worktree, '--force']);
      removed.worktree = true;
    }
    // The worktree remove above only detaches it; the branch itself survives
    // until deleted separately.
    if (await localBranchExists(repoRoot, DATA_BRANCH)) {
      await git.raw(repoRoot, ['branch', '-D', DATA_BRANCH]);
      removed.localBranch = true;
    }
  }

  if (remote) {
    if (!before.hasOrigin) throw new Error('no origin remote configured — nothing to delete remotely');
    if (before.remoteBranch) {
      await git.raw(repoRoot, ['push', 'origin', '--delete', DATA_BRANCH]);
      removed.remoteBranch = true;
    }
  }

  return { before, removed };
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: process.cwd() },
    local: { type: 'boolean', default: false },
    remote: { type: 'boolean', default: false },
  } });
  if (!values.local && !values.remote) {
    process.stdout.write(JSON.stringify(await status(values.repo), null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(await reset(values.repo, values), null, 2) + '\n');
  }
}
