import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepo } from './helpers/fixture.mjs';
import * as git from '../comprehend/scripts/lib/git.mjs';

test('listTree drops submodules and symlinks, keeps real files', async (t) => {
  const inner = await createRepo('inner');
  await inner.write({ 'readme.md': 'inner\n' });
  await inner.commit('feat: inner');

  const repo = await createRepo('outer');
  t.after(() => Promise.all([repo.cleanup(), inner.cleanup()]));

  await repo.write({ 'lib/a.dart': 'void main() {}\n' });
  await repo.symlink('a.dart', 'lib/link.dart');
  await repo.addSubmodule(inner, 'third_party/inner');
  await repo.commit('feat: init');

  const paths = (await git.listTree(repo.path)).map((f) => f.path);
  assert.ok(paths.includes('lib/a.dart'));
  assert.ok(!paths.includes('lib/link.dart'), 'symlink must be dropped');
  assert.ok(!paths.includes('third_party/inner'), 'submodule gitlink must be dropped');
});

test('diffNumstat reports renames as one change, not delete plus add', async (t) => {
  const repo = await createRepo('rename');
  t.after(() => repo.cleanup());

  const body = Array.from({ length: 40 }, (_, i) => `// line ${i}`).join('\n') + '\n';
  await repo.write({ 'lib/ui/widget.dart': body });
  const base = await repo.commit('feat: init');

  await repo.move('lib/ui/widget.dart', 'lib/data/widget.dart');
  await repo.commit('refactor: move widget');

  const changes = await git.diffNumstat(repo.path, base);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].oldPath, 'lib/ui/widget.dart');
  assert.equal(changes[0].path, 'lib/data/widget.dart');
  assert.equal(changes[0].added, 0);
  assert.equal(changes[0].deleted, 0);
});

test('diffNumstat marks binary files instead of returning NaN', async (t) => {
  const repo = await createRepo('binary');
  t.after(() => repo.cleanup());

  await repo.write({ 'assets/logo.png': Buffer.from([0x89, 0x50, 0, 1, 2, 3]) });
  const base = await repo.commit('feat: init');
  await repo.write({ 'assets/logo.png': Buffer.from([0x89, 0x50, 0, 9, 9, 9, 9]) });
  await repo.commit('chore: replace logo');

  const [change] = await git.diffNumstat(repo.path, base);
  assert.equal(change.added, null);
  assert.equal(change.deleted, null);
});

test('commitAtTime recovers a baseline when history is partly rewritten', async (t) => {
  const repo = await createRepo('rewrite');
  t.after(() => repo.cleanup());

  await repo.write({ 'lib/a.dart': 'a\n' });
  const first = await repo.commit('feat: init');

  await repo.write({ 'lib/b.dart': 'b\n' });
  const quizCommit = await repo.commit('feat: more');
  const quizTime = new Date(repo.clock).toISOString();

  // Force-push style rewrite: the quizzed commit is replaced, earlier ones live on.
  await repo.git(['reset', '-q', '--hard', first]);
  await repo.write({ 'lib/c.dart': 'c\n' });
  await repo.commit('feat: different');
  await repo.git(['reflog', 'expire', '--expire=now', '--all']);
  await repo.git(['gc', '-q', '--prune=now']);

  assert.equal(await git.commitExists(repo.path, quizCommit), false);
  assert.equal(await git.commitAtTime(repo.path, quizTime), first);
});

test('commitAtTime gives up when a full squash leaves nothing old enough', async (t) => {
  const repo = await createRepo('squash');
  t.after(() => repo.cleanup());

  await repo.write({ 'lib/a.dart': 'a\n' });
  const quizCommit = await repo.commit('feat: init');
  const quizTime = new Date(repo.clock).toISOString();

  await repo.write({ 'lib/b.dart': 'b\n' });
  await repo.commit('feat: more');
  await repo.squashAll();

  assert.equal(await git.commitExists(repo.path, quizCommit), false);
  // The single surviving commit is dated after the quiz, so there is no
  // honest baseline left: report.mjs must mark this churn as unknown rather
  // than inventing one.
  assert.equal(await git.commitAtTime(repo.path, quizTime), null);
});
