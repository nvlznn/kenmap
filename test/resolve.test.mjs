import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepo } from './helpers/fixture.mjs';
import { resolveModule, scan } from '../comprehend/scripts/scan.mjs';

const MODULES = { ui: ['lib/ui/**'], data: ['lib/data/**'] };

async function setup(t) {
  const repo = await createRepo('resolve');
  t.after(() => repo.cleanup());
  await repo.write({
    'lib/ui/home.dart': 'class Home {}\n',
    'lib/ui/cards/card.dart': 'class Card {}\n',
    'lib/data/repo.dart': 'class Repo {}\n',
  });
  await repo.commit('feat: init');
  return repo;
}

test('resolveModule accepts a module id directly', async (t) => {
  const repo = await setup(t);
  const result = await scan(repo.path, { version: 1, user: 'i', modules: MODULES });
  assert.deepEqual(resolveModule(result, 'ui'), { moduleId: 'ui' });
});

test('resolveModule accepts a file path', async (t) => {
  const repo = await setup(t);
  const result = await scan(repo.path, { version: 1, user: 'i', modules: MODULES });
  assert.deepEqual(resolveModule(result, 'lib/ui/home.dart'), { moduleId: 'ui' });
});

test('resolveModule accepts a folder path, trailing slash and all', async (t) => {
  const repo = await setup(t);
  const result = await scan(repo.path, { version: 1, user: 'i', modules: MODULES });
  assert.deepEqual(resolveModule(result, 'lib/ui/cards/'), { moduleId: 'ui' });
  assert.deepEqual(resolveModule(result, 'lib/data'), { moduleId: 'data' });
});

test('resolveModule refuses a path that spans more than one module', async (t) => {
  const repo = await setup(t);
  const result = await scan(repo.path, { version: 1, user: 'i', modules: MODULES });
  const resolved = resolveModule(result, 'lib');
  assert.equal(resolved.moduleId, null);
  assert.deepEqual(resolved.candidates.sort(), ['data', 'ui']);
});

test('resolveModule reports a path that matches nothing', async (t) => {
  const repo = await setup(t);
  const result = await scan(repo.path, { version: 1, user: 'i', modules: MODULES });
  const resolved = resolveModule(result, 'lib/nope');
  assert.equal(resolved.moduleId, null);
  assert.match(resolved.error, /not a module id/);
});
