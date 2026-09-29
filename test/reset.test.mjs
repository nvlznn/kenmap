import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createRepo } from './helpers/fixture.mjs';
import { record } from '../comprehend/scripts/record.mjs';
import { reset, status } from '../comprehend/scripts/reset.mjs';

const exec = promisify(execFile);

async function setup(t, { withRemote = false } = {}) {
  const repo = await createRepo('reset');
  t.after(() => repo.cleanup());
  await repo.write({
    '.kenmap.json': JSON.stringify({ version: 1, user: 'tester', modules: { ui: ['lib/ui/**'] } }, null, 2),
    '.gitignore': '.kenmap-data/\n',
    'lib/ui/a.dart': 'class A {}\n',
  });
  await repo.commit('feat: init');

  if (withRemote) {
    const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'kenmap-reset-remote-'));
    await exec('git', ['init', '-q', '--bare', remote]);
    t.after(() => fs.rm(remote, { recursive: true, force: true }));
    await repo.git(['remote', 'add', 'origin', remote]);
  }
  return repo;
}

test('status reports nothing left behind on a repo that was never quizzed', async (t) => {
  const repo = await setup(t);
  const result = await status(repo.path);
  assert.equal(result.config, '.kenmap.json');
  assert.equal(result.worktree, null);
  assert.equal(result.localBranch, false);
  assert.equal(result.remoteBranch, false);
});

test('status finds the worktree right after a quiz, before anything is committed', async (t) => {
  const repo = await setup(t);
  await record(repo.path, { module: 'ui', score: 1, question: 'why?', answer: 'because' });

  // The orphan branch is unborn until the first commit, which only publish()
  // makes — so results.jsonl sits as real, uncommitted data in the worktree
  // with no branch ref yet. `worktree` truthy is what must catch this.
  const result = await status(repo.path);
  // .worktree is derived from the real, symlink-resolved repo root (git.repoRoot),
  // which on macOS differs from the tmpdir path before resolution (/tmp vs /private/tmp).
  assert.equal(result.worktree, path.join(result.repoRoot, '.kenmap-data'));
  assert.equal(result.localBranch, false);
});

test('status reports a local branch once something has actually been committed', async (t) => {
  const repo = await setup(t);
  await record(repo.path, { module: 'ui', score: 1, question: 'why?', answer: 'because' });
  const { publish } = await import('../comprehend/scripts/publish.mjs');
  await publish(repo.path, { push: false });

  assert.equal(await status(repo.path).then((s) => s.localBranch), true);
});

test('reset with no options deletes nothing', async (t) => {
  const repo = await setup(t);
  await record(repo.path, { module: 'ui', score: 1, question: 'why?', answer: 'because' });

  const { removed } = await reset(repo.path, {});
  assert.deepEqual(removed, { config: false, worktree: false, localBranch: false, remoteBranch: false });
  assert.equal(await status(repo.path).then((s) => s.worktree !== null), true, 'the worktree must still be there');
});

test('reset({ local: true }) removes the config, worktree and an already-committed local branch', async (t) => {
  const repo = await setup(t, { withRemote: true });
  await record(repo.path, { module: 'ui', score: 1, question: 'why?', answer: 'because' });
  const { publish } = await import('../comprehend/scripts/publish.mjs');
  await publish(repo.path, { push: false }); // commits locally without pushing

  const { removed } = await reset(repo.path, { local: true });
  assert.deepEqual(removed, { config: true, worktree: true, localBranch: true, remoteBranch: false });

  const after = await status(repo.path);
  assert.equal(after.worktree, null);
  assert.equal(after.localBranch, false);
  await assert.rejects(() => fs.access(path.join(repo.path, '.kenmap.json')));
});

test('reset({ local: true }) still clears an uncommitted worktree even with no branch ref yet', async (t) => {
  const repo = await setup(t);
  await record(repo.path, { module: 'ui', score: 1, question: 'why?', answer: 'because' });

  const { removed } = await reset(repo.path, { local: true });
  assert.equal(removed.worktree, true);
  assert.equal(removed.localBranch, false, 'there was never a ref to delete');
  assert.equal(await status(repo.path).then((s) => s.worktree), null);
});

test('local: true never touches the remote branch, even when one exists', async (t) => {
  const repo = await setup(t, { withRemote: true });
  await record(repo.path, { module: 'ui', score: 1, question: 'why?', answer: 'because' });
  const { publish } = await import('../comprehend/scripts/publish.mjs');
  await publish(repo.path);

  await reset(repo.path, { local: true });
  const after = await status(repo.path);
  assert.equal(after.remoteBranch, true, 'remote must survive a local-only reset');
});

test('remote: true deletes the pushed branch', async (t) => {
  const repo = await setup(t, { withRemote: true });
  await record(repo.path, { module: 'ui', score: 1, question: 'why?', answer: 'because' });
  const { publish } = await import('../comprehend/scripts/publish.mjs');
  await publish(repo.path);

  const { removed } = await reset(repo.path, { remote: true });
  assert.equal(removed.remoteBranch, true);
  assert.equal(await status(repo.path).then((s) => s.remoteBranch), false);
});

test('remote: true without a remote configured fails loudly instead of pretending to succeed', async (t) => {
  const repo = await setup(t, { withRemote: false });
  await assert.rejects(() => reset(repo.path, { remote: true }), /no origin remote/);
});
