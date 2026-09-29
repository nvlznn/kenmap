import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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

test('with no target, the largest never-quizzed module is picked without scoring anything', async (t) => {
  const repo = await setup(t);
  await answer(repo, 'data', 1);
  const result = await prepare(repo.path);
  assert.equal(result.module.id, 'ui');
});

test('once every module has an answer, the lowest score is picked', async (t) => {
  const repo = await setup(t);
  await answer(repo, 'ui', 1);
  await answer(repo, 'data', 0.25);
  await answer(repo, 'tiny', 0.75);
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
  assert.deepEqual(result.previous, ['What breaks if home stops going through the repository?']);
  assert.match(format(result), /之前問過/);
});

test('a path spanning modules comes back as candidates, not a guess', async (t) => {
  const repo = await setup(t);
  const result = await prepare(repo.path, { target: 'lib' });
  assert.ok(result.error);
  assert.deepEqual(result.candidates.sort(), ['data', 'tiny', 'ui']);
  assert.match(format(result), /橫跨多個模組/);
});

test('record --render records, rescores and redraws in one call', async (t) => {
  const repo = await setup(t);
  const { stdout } = await exec('node', [RECORD, '--repo', repo.path, '--module', 'ui', '--score', '0.75',
    '--question', 'why?', '--answer', 'because', '--render', '--no-open']);
  const out = JSON.parse(stdout);
  assert.equal(out.module, 'ui');
  assert.equal(out.moduleScore, 0.75);
  assert.match(out.map, /^file:\/\/.*local\.html$/);
  assert.equal(out.opened, false);
});
