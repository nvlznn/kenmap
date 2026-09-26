import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepo } from './helpers/fixture.mjs';
import { badge, report } from '../comprehend/scripts/report.mjs';
import { record as writeRecord } from '../comprehend/scripts/record.mjs';

// Fixture commits run on a pinned clock; answers must share it or the
// timestamp fallback compares against the wrong era.
const record = (repo, entry) => {
  repo.clock += 60 * 1000;
  return writeRecord(repo.path, entry, { now: new Date(repo.clock) });
};

const MODULES = { ui: ['lib/ui/**'], data: ['lib/data/**'] };

function lines(n, prefix = 'line') {
  return Array.from({ length: n }, (_, i) => `// ${prefix} ${i}`).join('\n') + '\n';
}

async function setup(t, { files, modules = MODULES } = {}) {
  const repo = await createRepo('report');
  t.after(() => repo.cleanup());
  await repo.write({
    '.kenmap.json': JSON.stringify({ version: 1, user: 'tester', modules }, null, 2),
    '.gitignore': '.kenmap-data/\n',
    ...files,
  });
  await repo.commit('feat: init');
  return repo;
}

const answer = (module, score) => ({ module, score, question: `why is ${module} like this?`, answer: 'because' });

test('a module nobody has been quizzed on scores zero', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(10), 'lib/data/b.dart': lines(10) } });
  const result = await report(repo.path);
  assert.deepEqual(result.modules.map((m) => m.score), [0, 0]);
  assert.equal(result.total, 0);
  assert.equal(result.anyQuizzed, false);
});

test('untouched code keeps the full quiz score', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(10), 'lib/data/b.dart': lines(10) } });
  await record(repo, answer('ui', 1));
  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  assert.equal(ui.score, 1);
  assert.equal(ui.breakdown[0].churn, 0);
});

test('a one-line edit is not counted twice', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(100), 'lib/data/b.dart': lines(10) } });
  await record(repo, answer('ui', 1));

  await repo.write({ 'lib/ui/a.dart': lines(100).replace('// line 0', '// edited') });
  await repo.commit('fix: tweak one line');

  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  // 1 added + 1 deleted over 100 lines would read as 2%; the edit is one line.
  assert.equal(ui.breakdown[0].churn, 0.01);
});

test('deleting code is not mistaken for a rewrite', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(1000), 'lib/data/b.dart': lines(10) } });
  await record(repo, answer('ui', 1));

  await repo.write({ 'lib/ui/a.dart': lines(200) });
  await repo.commit('refactor: drop dead code');

  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  // Against the 200 lines that remain this would be 4.0 and clamp to 1.
  assert.equal(ui.breakdown[0].churn, 0.8);
  assert.equal(ui.score, 0.2);
});

test('a rewrite drives the score down', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(100), 'lib/data/b.dart': lines(10) } });
  await record(repo, answer('ui', 1));

  await repo.write({ 'lib/ui/a.dart': lines(100, 'rewritten') });
  await repo.commit('refactor: rewrite ui');

  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  assert.equal(ui.breakdown[0].churn, 1);
  assert.equal(ui.score, 0);
});

test('moving a file between modules does not spike churn on both sides', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(50), 'lib/data/b.dart': lines(50) } });
  await record(repo, answer('ui', 1));
  await record(repo, answer('data', 1));

  await repo.move('lib/ui/a.dart', 'lib/data/a.dart');
  await repo.commit('refactor: move a into data');

  const result = await report(repo.path);
  for (const module of result.modules) {
    assert.equal(module.breakdown[0].churn, 0, `${module.id} churn should stay 0 for a pure move`);
  }
});

test('a module score averages its three most recent answers', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(10), 'lib/data/b.dart': lines(10) } });
  for (const score of [0, 0, 0.5, 1, 1]) await record(repo, answer('ui', score));

  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  assert.equal(ui.breakdown.length, 3);
  assert.deepEqual(ui.breakdown.map((b) => b.quizScore), [1, 1, 0.5]);
  assert.equal(ui.score, 0.833);
});

test('fewer than three answers average what exists', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(10), 'lib/data/b.dart': lines(10) } });
  await record(repo, answer('ui', 1));
  await record(repo, answer('ui', 0.5));

  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  assert.equal(ui.score, 0.75);
});

test('the repo total is weighted by lines, not by module count', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(900), 'lib/data/b.dart': lines(100) } });
  await record(repo, answer('ui', 1));
  await record(repo, answer('data', 0));

  const result = await report(repo.path);
  assert.equal(result.total, 0.9);
});

test('binary files never poison the arithmetic', async (t) => {
  const repo = await setup(t, {
    files: { 'lib/ui/a.dart': lines(10), 'lib/ui/logo.png': Buffer.from([0x89, 0, 1, 2]), 'lib/data/b.dart': lines(10) },
  });
  await record(repo, answer('ui', 1));

  await repo.write({ 'lib/ui/logo.png': Buffer.from([0x89, 0, 9, 9, 9]) });
  await repo.commit('chore: swap logo');

  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  assert.equal(Number.isFinite(ui.breakdown[0].churn), true);
  assert.equal(ui.breakdown[0].churn, 0);
});

test('a squashed baseline is reported as unverifiable, not as zero', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(10), 'lib/data/b.dart': lines(10) } });
  await record(repo, answer('ui', 1));
  await repo.write({ 'lib/ui/a.dart': lines(12) });
  await repo.commit('feat: more');
  await repo.squashAll();

  const ui = (await report(repo.path)).modules.find((m) => m.id === 'ui');
  assert.equal(ui.breakdown[0].churn, null);
  assert.equal(ui.score, 1, 'the answer still counts; only the churn is unknown');
  assert.ok((await report(repo.path)).warnings.some((w) => w.includes('unverifiable')));
});

test('a module whose globs match nothing warns instead of lifting the total', async (t) => {
  const repo = await setup(t, {
    files: { 'lib/ui/a.dart': lines(10) },
    modules: { ui: ['lib/ui/**'], ghost: ['lib/gone/**'] },
  });
  const result = await report(repo.path);
  assert.ok(result.warnings.some((w) => w.includes('ghost')));
});

test('the badge says no data before the first quiz and a percentage after', async (t) => {
  const repo = await setup(t, { files: { 'lib/ui/a.dart': lines(10), 'lib/data/b.dart': lines(10) } });
  assert.equal(badge(await report(repo.path)).message, 'no data');

  await record(repo, answer('ui', 1));
  await record(repo, answer('data', 1));
  const after = badge(await report(repo.path));
  assert.equal(after.message, '100%');
  assert.equal(after.color, 'brightgreen');
});
