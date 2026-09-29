import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createRepo } from './helpers/fixture.mjs';
import { format, prepare } from '../comprehend/scripts/prepare.mjs';
import { record } from '../comprehend/scripts/record.mjs';

const exec = promisify(execFile);
const RECORD = path.resolve(import.meta.dirname, '../comprehend/scripts/record.mjs');
const lines = (n, tag) => Array.from({ length: n }, (_, i) => `// ${tag} ${i}`).join('\n') + '\n';

async function setup(t) {
  const repo = await createRepo('prepare');
  t.after(() => repo.cleanup());
  await repo.write({
    '.kenmap.json': JSON.stringify({ version: 1, user: 'tester', modules: {
      ui: ['lib/ui/**'], data: ['lib/data/**'], tiny: ['lib/tiny/**'],
    } }, null, 2),
    '.gitignore': '.kenmap-data/\n',
    'pubspec.yaml': 'name: app\n',
    'lib/ui/home.dart': "import 'package:app/data/repo.dart';\n" + lines(30, 'home'),
    'lib/ui/card.dart': "import 'package:app/data/model.dart';\n" + lines(20, 'card'),
    'lib/data/repo.dart': lines(40, 'repo'),
    'lib/data/model.dart': lines(10, 'model'),
    'lib/data/unused.dart': lines(200, 'unused'),
    'lib/data/model.g.dart': lines(500, 'generated'),
    'lib/tiny/a.dart': lines(5, 'tiny'),
  });
  await repo.commit('feat: init');
  return repo;
}

const answer = (repo, module, score, question = `why is ${module} shaped like this?`) => {
  repo.clock += 60 * 1000;
  return record(repo.path, { module, score, question, answer: 'because' }, { now: new Date(repo.clock) });
};

test('a path resolves to its module, and the code comes back in the same call', async (t) => {
  const repo = await setup(t);
  const result = await prepare(repo.path, { target: 'lib/data/repo.dart' });
  assert.equal(result.module.id, 'data');
  assert.ok(result.files.length > 0);
  assert.ok(result.files.some((f) => /repo 0/.test(f.text)));
});

test('files other modules import come first, generated code is left out', async (t) => {
  const repo = await setup(t);
  const result = await prepare(repo.path, { target: 'data' });
  const shown = result.files.map((f) => f.path);
  assert.deepEqual(shown.slice(0, 2).sort(), ['lib/data/model.dart', 'lib/data/repo.dart']);
  assert.ok(!shown.includes('lib/data/model.g.dart'));
});

test('the line budget is respected, cutting the first file rather than showing nothing', async (t) => {
  const repo = await setup(t);
  const result = await prepare(repo.path, { target: 'data', lines: 25 });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].truncated, true);
  assert.equal(result.files[0].text.split('\n').length, 25);
});

const scoreModule = async (repo, module, score) => {
  for (let i = 0; i < 3; i++) await answer(repo, module, score);
};

test('with no target, a module part way to its first score is finished first', async (t) => {
  const repo = await setup(t);
  await answer(repo, 'tiny', 1);
  assert.equal((await prepare(repo.path)).module.id, 'tiny', 'tiny is smaller, but it was already started');
});

test('with nothing started, the largest never-quizzed module is picked without scoring anything', async (t) => {
  const repo = await setup(t);
  await scoreModule(repo, 'data', 1);
  assert.equal((await prepare(repo.path)).module.id, 'ui');
});

test('once every module has a score, the lowest one is picked', async (t) => {
  const repo = await setup(t);
  await scoreModule(repo, 'ui', 1);
  await scoreModule(repo, 'data', 0.25);
  await scoreModule(repo, 'tiny', 0.75);
  assert.equal((await prepare(repo.path)).module.id, 'data');
});

test('only uncommitted edits inside the module are reported', async (t) => {
  const repo = await setup(t);
  await repo.write({ 'lib/ui/home.dart': 'changed\n', 'notes.txt': 'elsewhere\n' });
  assert.deepEqual((await prepare(repo.path, { target: 'ui' })).dirty, ['lib/ui/home.dart']);
  assert.deepEqual((await prepare(repo.path, { target: 'data' })).dirty, []);
});

test('earlier questions for the module are handed back so they are not repeated', async (t) => {
  const repo = await setup(t);
  await answer(repo, 'ui', 0.5, 'What breaks if home stops going through the repository?');
  const result = await prepare(repo.path, { target: 'ui' });
  assert.deepEqual(result.previous, [{ type: 'why', question: 'What breaks if home stops going through the repository?' }]);
  assert.match(format(result), /之前問過/);
});

test('a path spanning modules comes back as candidates, not a guess', async (t) => {
  const repo = await setup(t);
  const result = await prepare(repo.path, { target: 'lib' });
  assert.ok(result.error);
  assert.deepEqual(result.candidates.sort(), ['data', 'tiny', 'ui']);
  assert.match(format(result), /橫跨多個模組/);
});

test('record --sync records and rescores in one call, and says when there is nowhere to push', async (t) => {
  const repo = await setup(t);
  const { stdout } = await exec('node', [RECORD, '--repo', repo.path, '--module', 'ui', '--score', '0.75',
    '--question', 'why?', '--answer', 'because', '--sync']);
  const out = JSON.parse(stdout);
  assert.equal(out.module, 'ui');
  assert.equal(out.moduleBefore, null, 'never quizzed before');
  assert.equal(out.moduleAfter, null, 'one answer is not a score yet');
  assert.equal(out.answers, 1);
  assert.equal(out.required, 3);
  assert.equal(out.totalBefore, null);
  assert.equal(out.totalAfter, null);
  assert.equal(out.synced, false);
  assert.match(out.syncError, /no origin remote/);
  assert.equal(out.map, null, 'no GitHub origin, so no page on the site to link to');
});

test('record --sync pushes the answer so the site sees it, and links to the repo on the site', async (t) => {
  const repo = await setup(t);
  const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'kenmap-sync-remote-'));
  t.after(() => fs.rm(remote, { recursive: true, force: true }));
  await exec('git', ['init', '-q', '--bare', remote]);
  await repo.git(['remote', 'add', 'origin', remote]);

  const out = await syncAnswer(repo, 1);
  assert.equal(out.synced, true);
  assert.equal(out.syncError, null);
  const { stdout: log } = await exec('git', ['-C', remote, 'log', '--oneline', 'kenmap-data']);
  assert.equal(log.trim().split('\n').length, 1);

  // The link names the GitHub repo, whatever form the remote URL takes.
  await repo.git(['remote', 'set-url', 'origin', 'git@github.com:someone/app.git']);
  await repo.git(['remote', 'set-url', '--push', 'origin', remote]);
  assert.equal((await syncAnswer(repo, 1)).map, 'https://kenmap.noky.dev/?repo=someone/app');
});

test('an answer whose push failed goes up with the next one', async (t) => {
  const repo = await setup(t);
  assert.equal((await syncAnswer(repo, 1)).synced, false, 'no remote yet');

  const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'kenmap-retry-remote-'));
  t.after(() => fs.rm(remote, { recursive: true, force: true }));
  await exec('git', ['init', '-q', '--bare', remote]);
  await repo.git(['remote', 'add', 'origin', remote]);

  assert.equal((await syncAnswer(repo, 0.5)).synced, true);
  const { stdout: results } = await exec('git', ['-C', remote, 'show', 'kenmap-data:results.jsonl']);
  assert.equal(results.trim().split('\n').length, 2, 'both answers reached the remote');
});

const syncAnswer = async (repo, score) => JSON.parse((await exec('node', [RECORD, '--repo', repo.path,
  '--module', 'ui', '--score', String(score), '--question', 'why?', '--answer', 'because', '--sync'])).stdout);

test('the third answer is the one that gives the module its first score', async (t) => {
  const repo = await setup(t);
  await answer(repo, 'ui', 0.5);
  await answer(repo, 'ui', 0.5);
  const out = await syncAnswer(repo, 1);
  assert.equal(out.moduleBefore, null);
  assert.equal(out.moduleAfter, 0.667);
  assert.equal(out.answers, 3);
  assert.ok(out.totalAfter > 0);
});

test('an answer on a scored module reports the score it replaced', async (t) => {
  const repo = await setup(t);
  await scoreModule(repo, 'ui', 0.25);
  const out = await syncAnswer(repo, 1);
  assert.equal(out.moduleBefore, 0.25);
  assert.equal(out.moduleAfter, 0.5);
});

test('a module never asked about opens with a trade-off question', async (t) => {
  const repo = await setup(t);
  const result = await prepare(repo.path, { target: 'ui' });
  assert.equal(result.type.id, 'tradeoff');
  assert.match(format(result), /這次題型：取捨與技術債/);
});

test('question types rotate so every type comes up before any repeats', async (t) => {
  const repo = await setup(t);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const { type } = await prepare(repo.path, { target: 'ui' });
    seen.push(type.id);
    repo.clock += 60 * 1000;
    await record(repo.path, { module: 'ui', score: 1, type: type.id, question: `q${i}` }, { now: new Date(repo.clock) });
  }
  assert.deepEqual([...new Set(seen)].sort(), ['alternative', 'reading', 'scenario', 'tradeoff', 'why']);
  assert.equal((await prepare(repo.path, { target: 'ui' })).type.id, 'tradeoff', 'the cycle starts over');
});

test('answers recorded before types existed count as the original "why" type', async (t) => {
  const repo = await setup(t);
  await answer(repo, 'ui', 1); // no type passed
  const types = [];
  for (let i = 0; i < 4; i++) {
    const { type } = await prepare(repo.path, { target: 'ui' });
    types.push(type.id);
    repo.clock += 60 * 1000;
    await record(repo.path, { module: 'ui', score: 1, type: type.id, question: `q${i}` }, { now: new Date(repo.clock) });
  }
  assert.ok(!types.includes('why'), 'why was already covered by the untyped answer');
});

test('an unknown question type is refused', async (t) => {
  const repo = await setup(t);
  await assert.rejects(
    () => record(repo.path, { module: 'ui', score: 1, type: 'trivia', question: 'q' }),
    /unknown question type "trivia"/,
  );
});

test('code comes with repo-relative paths and line numbers so questions can cite an exact location', async (t) => {
  const repo = await setup(t);
  const result = await prepare(repo.path, { target: 'tiny' });
  const out = format(result);
  assert.match(out, /^── lib\/tiny\/a\.dart/m, 'path starts at the repo root');
  assert.match(out, /^1│\/\/ tiny 0$/m, 'first line is numbered 1');
  assert.match(out, /^5│\/\/ tiny 4$/m);
});
