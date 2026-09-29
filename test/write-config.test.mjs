import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createRepo } from './helpers/fixture.mjs';
import { writeConfig } from '../comprehend/scripts/write-config.mjs';

const proposal = { version: 1, user: 'tester', modules: { ui: ['lib/ui/**'], data: ['lib/data/*.dart'] } };

async function setup(t) {
  const repo = await createRepo('write-config');
  t.after(() => repo.cleanup());
  await repo.write({
    'lib/ui/a.dart': 'a\nb\n',
    'lib/data/repo.dart': 'r\n',
    'lib/data/nested/deep.dart': 'd\n',
    'tool/build.sh': 'echo\n',
  });
  await repo.commit('feat: init');
  return repo;
}

test('a dry run reports real sizes and coverage without writing anything', async (t) => {
  const repo = await setup(t);
  const result = await writeConfig(repo.path, proposal, { dryRun: true });
  assert.equal(result.written, false);
  assert.deepEqual(result.modules.map((m) => [m.id, m.loc, m.fileCount]), [['ui', 2, 1], ['data', 1, 1]]);
  assert.equal(result.covered, 3);
  assert.equal(result.unassigned.loc, 2, 'the nested file and the script are outside every module');
  await assert.rejects(() => fs.access(path.join(repo.path, '.kenmap.json')));
});

test('without a dry run the same proposal is written', async (t) => {
  const repo = await setup(t);
  const result = await writeConfig(repo.path, proposal);
  assert.equal(result.written, true);
  await fs.access(path.join(repo.path, '.kenmap.json'));
});

test('a module that matches nothing is refused, dry run or not', async (t) => {
  const repo = await setup(t);
  const bad = { ...proposal, modules: { ...proposal.modules, ghost: ['lib/none/**'] } };
  await assert.rejects(() => writeConfig(repo.path, bad, { dryRun: true }), /match no files: ghost/);
});

test('a module named after a subcommand is refused', async (t) => {
  const repo = await setup(t);
  const clash = { ...proposal, modules: { web: ['lib/ui/**'] } };
  await assert.rejects(() => writeConfig(repo.path, clash, { dryRun: true }), /is a \/kenmap:comprehend subcommand/);
});
