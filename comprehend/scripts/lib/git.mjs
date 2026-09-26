import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

export class GitError extends Error {}

async function git(cwd, args, { buffer = false } = {}) {
  try {
    const { stdout } = await exec('git', ['-C', cwd, ...args], {
      maxBuffer: MAX_BUFFER,
      encoding: buffer ? 'buffer' : 'utf8',
    });
    return stdout;
  } catch (err) {
    throw new GitError(`git ${args.join(' ')} failed: ${err.stderr || err.message}`);
  }
}

export async function repoRoot(cwd) {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

export async function headCommit(cwd) {
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

export async function hasCommits(cwd) {
  try {
    await headCommit(cwd);
    return true;
  } catch {
    return false;
  }
}

export async function commitExists(cwd, ref) {
  try {
    await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// Fallback baseline when a recorded commit was squashed or rebased away.
export async function commitAtTime(cwd, isoTime) {
  const out = (await git(cwd, ['rev-list', '-1', `--before=${isoTime}`, 'HEAD'])).trim();
  return out || null;
}

export async function isDirty(cwd) {
  return (await git(cwd, ['status', '--porcelain'])).trim().length > 0;
}

/**
 * Tracked files at a commit. Submodules (160000) and symlinks (120000) are
 * dropped: a submodule is a gitlink with no content, and reports 1 added /
 * 1 deleted on every SHA bump; a symlink's "content" is its target path.
 */
export async function listTree(cwd, ref = 'HEAD') {
  const out = await git(cwd, ['ls-tree', '-r', '-z', '--full-tree', ref]);
  const files = [];
  for (const entry of out.split('\0')) {
    if (!entry) continue;
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const [mode, type, sha] = entry.slice(0, tab).split(/\s+/);
    if (type !== 'blob') continue;
    if (mode === '160000' || mode === '120000') continue;
    files.push({ path: entry.slice(tab + 1), sha, mode });
  }
  return files;
}

export async function readBlob(cwd, sha) {
  return git(cwd, ['cat-file', 'blob', sha], { buffer: true });
}

/**
 * Reads many blobs through a single `git cat-file --batch` process. One spawn
 * per file makes scanning a few hundred files take seconds.
 */
export function readBlobs(cwd, shas) {
  const wanted = [...new Set(shas)];
  const out = new Map();
  if (wanted.length === 0) return Promise.resolve(out);

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new GitError(`git cat-file --batch failed: ${stderr}`));
      try {
        resolve(parseBatch(Buffer.concat(chunks), out));
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.end(wanted.join('\n') + '\n');
  });
}

function parseBatch(buf, out) {
  let offset = 0;
  while (offset < buf.length) {
    const newline = buf.indexOf('\n', offset);
    if (newline === -1) break;
    const [sha, type, size] = buf.toString('utf8', offset, newline).split(' ');
    offset = newline + 1;
    if (type !== 'blob') continue; // missing objects report "<sha> missing"
    const length = Number(size);
    out.set(sha, buf.subarray(offset, offset + length));
    offset += length + 1; // trailing newline
  }
  return out;
}

/**
 * One repo-wide diff, rename/copy aware. Per-module pathspec diffs cannot see
 * a file moving between modules: the source module reads as fully deleted and
 * the destination as fully added, spiking churn to 1 on both sides.
 * Returns [{ added, deleted, path, oldPath }]; binary files report added and
 * deleted as null (git prints "-\t-") and must not reach the arithmetic.
 */
export async function diffNumstat(cwd, base, head = 'HEAD') {
  const out = await git(cwd, ['diff', '-M', '-C', '--numstat', '-z', base, head]);
  const parts = out.split('\0');
  const changes = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const fields = parts[i].split('\t');
    if (fields.length < 3) continue;
    const [addedRaw, deletedRaw, inlinePath] = fields;
    const added = addedRaw === '-' ? null : Number(addedRaw);
    const deleted = deletedRaw === '-' ? null : Number(deletedRaw);
    if (inlinePath === '') {
      // Rename or copy: the two paths follow as their own NUL-delimited fields.
      const oldPath = parts[++i];
      const path = parts[++i];
      changes.push({ added, deleted, path, oldPath });
    } else {
      changes.push({ added, deleted, path: inlinePath, oldPath: null });
    }
  }
  return changes;
}

export { git as raw };
