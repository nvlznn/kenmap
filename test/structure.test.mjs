import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepo } from './helpers/fixture.mjs';
import { structure } from '../skill/scripts/structure.mjs';

const dir = (result, path) => result.directories.find((d) => d.path === path);

test('a flat repo with no subdirectories still reports totals and seams', async (t) => {
  const repo = await createRepo('flat');
  t.after(() => repo.cleanup());
  await repo.write({
    'pubspec.yaml': 'name: flat\n',
    'a.dart': "import 'b.dart';\nclass A {}\n",
    'b.dart': 'class B {}\n',
    'c.dart': "import 'b.dart';\nclass C {}\n",
  });
  await repo.commit('feat: init');

  const result = await structure(repo.path);
  assert.equal(result.totals.files, 4);
  assert.equal(dir(result, '.').depth, 0);
  // With no directory layout to cut on, import concentration is the only seam.
  assert.equal(result.edgeCount, 2);
});

test('the package manifest is found wherever it is buried', async (t) => {
  const repo = await createRepo('nested');
  t.after(() => repo.cleanup());
  await repo.write({
    'tools/readme.md': 'not the app\n',
    'src/apps/mobile/pubspec.yaml': 'name: mobile\n',
    'src/apps/mobile/lib/main.dart': "import 'package:mobile/ui/home.dart';\nvoid main() {}\n",
    'src/apps/mobile/lib/ui/home.dart': 'class Home {}\n',
  });
  await repo.commit('feat: init');

  const result = await structure(repo.path);
  assert.deepEqual(result.packages, [{ name: 'mobile', root: 'src/apps/mobile', language: 'dart' }]);
  assert.equal(result.edgeCount, 1, 'package: imports resolve against the nested root');
});

test('a monorepo keeps every package separate', async (t) => {
  const repo = await createRepo('monorepo');
  t.after(() => repo.cleanup());
  await repo.write({
    'packages/core/pubspec.yaml': 'name: core\n',
    'packages/core/lib/core.dart': 'class Core {}\n',
    'packages/app/pubspec.yaml': 'name: app\n',
    'packages/app/lib/app.dart': "import 'package:core/core.dart';\nclass App {}\n",
  });
  await repo.commit('feat: init');

  const result = await structure(repo.path);
  assert.deepEqual(result.packages.map((p) => p.name).sort(), ['app', 'core']);
  assert.equal(result.edgeCount, 1, 'cross-package imports resolve');
});

test('generated code is flagged but never dropped from the totals', async (t) => {
  const repo = await createRepo('generated');
  t.after(() => repo.cleanup());
  await repo.write({
    'pubspec.yaml': 'name: g\n',
    'lib/model.dart': 'class Model {}\n',
    'lib/model.g.dart': 'class ModelGen {}\n',
    'lib/l10n/generated/strings.dart': 'class Strings {}\n',
    'lib/redistribute/helper.dart': 'class Helper {}\n',
  });
  await repo.commit('feat: init');

  const result = await structure(repo.path);
  assert.equal(result.totals.generated, 2, '.g.dart and the generated/ directory');
  assert.equal(result.totals.files, 5, 'flagged files stay in the count');
  assert.equal(dir(result, 'lib/redistribute').generatedFiles, 0, '"dist" as a substring is not a match');
});

test('a repo in an unrecognized language scans without edges', async (t) => {
  const repo = await createRepo('nolang');
  t.after(() => repo.cleanup());
  await repo.write({
    'Makefile': 'all:\n\techo hi\n',
    'src/main.zig': 'const std = @import("std");\npub fn main() void {}\n',
    'src/util.zig': 'pub fn help() void {}\n',
  });
  await repo.commit('feat: init');

  const result = await structure(repo.path);
  assert.deepEqual(result.languages, []);
  assert.equal(result.edgeCount, 0);
  assert.ok(result.totals.loc > 0, 'lines still count, so the module can still be scored');
  assert.equal(dir(result, 'src').files, 2);
});

test('binary and UTF-16 files are not counted as source lines', async (t) => {
  const repo = await createRepo('binary');
  t.after(() => repo.cleanup());
  await repo.write({
    'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]),
    'docs/notes.txt': Buffer.from('two\nlines\n', 'utf16le'),
    'lib/a.dart': 'class A {}\n',
  });
  await repo.commit('feat: init');

  const result = await structure(repo.path);
  assert.equal(dir(result, 'assets').loc, 0);
  assert.equal(dir(result, 'docs').loc, 0, 'UTF-16 must not be decoded as garbage utf8 lines');
  assert.equal(dir(result, 'lib').loc, 1);
});

test('a repo with no commits is refused with an explanation', async (t) => {
  const repo = await createRepo('empty');
  t.after(() => repo.cleanup());
  await assert.rejects(() => structure(repo.path), /no commits yet/);
});
