import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_BRANCH, DATA_DIR } from './config.mjs';
import * as git from './git.mjs';

/**
 * The results branch is an orphan: it shares no history with the code, so it
 * can be fetched and rewritten without touching the project's own history.
 */
export async function ensure(repoRoot, { dir = DATA_DIR, branch = DATA_BRANCH } = {}) {
  const full = path.join(repoRoot, dir);
  if (await pathExists(path.join(full, '.git'))) return full;

  if (await localBranchExists(repoRoot, branch)) {
    await git.raw(repoRoot, ['worktree', 'add', '-q', dir, branch]);
  } else if (await remoteBranchExists(repoRoot, branch)) {
    await git.raw(repoRoot, ['fetch', '-q', 'origin', `${branch}:${branch}`]);
    await git.raw(repoRoot, ['worktree', 'add', '-q', dir, branch]);
  } else {
    await git.raw(repoRoot, ['worktree', 'add', '-q', '--orphan', '-b', branch, dir]);
    await fs.writeFile(path.join(full, '.gitignore'), 'local.html\n', 'utf8');
  }
  return full;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function localBranchExists(repoRoot, branch) {
  try {
    await git.raw(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function remoteBranchExists(repoRoot, branch) {
  try {
    const out = await git.raw(repoRoot, ['ls-remote', '--heads', 'origin', branch]);
    return out.trim().length > 0;
  } catch {
    return false; // no remote configured is fine — local-only works
  }
}

/** Tells the caller whether main still needs the data dir ignored. */
export async function isIgnored(repoRoot, dir = DATA_DIR) {
  try {
    await git.raw(repoRoot, ['check-ignore', '-q', `${dir}/`]);
    return true;
  } catch {
    return false;
  }
}
