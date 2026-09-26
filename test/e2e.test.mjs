import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createRepo } from './helpers/fixture.mjs';
import { badge, report } from '../comprehend/scripts/report.mjs';
import { publish } from '../comprehend/scripts/publish.mjs';
import { record } from '../comprehend/scripts/record.mjs';
import { render } from '../comprehend/scripts/render.mjs';
import { structure } from '../comprehend/scripts/structure.mjs';
import { writeConfig } from '../comprehend/scripts/write-config.mjs';

const exec = promisify(execFile);
const body = (n, tag) => Array.from({ length: n }, (_, i) => `// ${tag} ${i}`).join('\n') + '\n';

test('the whole flow: discover, configure, answer, publish, then watch a rewrite bite', async (t) => {
  const repo = await createRepo('e2e');
  const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'kenmap-remote-'));
  t.after(() => Promise.all([repo.cleanup(), fs.rm(remote, { recursive: true, force: true })]));
  await exec('git', ['init', '-q', '--bare', remote]);

  // A repo KenMap has never seen: app nested, one generated file, mixed languages.
  await repo.write({
    '.gitignore': '.kenmap-data/\n',
    'tools/deploy.sh': '#!/bin/sh\necho deploy\n',
    'src/app/pubspec.yaml': 'name: demo\n',
    'src/app/lib/ui/home.dart': "import 'package:demo/data/repo.dart';\n" + body(300, 'home'),
    'src/app/lib/ui/settings.dart': "import 'package:demo/data/repo.dart';\n" + body(200, 'settings'),
    'src/app/lib/data/repo.dart': body(150, 'repo'),
    'src/app/lib/data/repo.g.dart': body(400, 'generated'),
  });
  await repo.commit('feat: init');

  // 1. Discovery finds the nested package without being told where it is.
  const found = await structure(repo.path);
  assert.deepEqual(found.packages, [{ name: 'demo', root: 'src/app', language: 'dart' }]);
  assert.equal(found.totals.generated, 1);
  assert.ok(found.edgeCount >= 2);

  // 2. Boundaries get written through the validating script.
  const written = await writeConfig(repo.path, {
    version: 1,
    user: 'tester',
    modules: { ui: ['src/app/lib/ui/**'], data: ['src/app/lib/data/**'] },
  });
  assert.deepEqual(written.modules.map((m) => m.id), ['ui', 'data']);
  await repo.commit('chore: add kenmap config');

  // 3. Answering moves the map.
  const before = await report(repo.path);
  assert.equal(before.anyQuizzed, false);
  assert.equal(badge(before).message, 'no data');

  repo.clock += 60 * 1000;
  await record(repo.path, {
    module: 'ui', score: 1,
    question: 'Why do both screens go through the repository instead of the cache directly?',
    answer: 'So invalidation stays in one place.',
    rationale: 'Named the single owner of invalidation.',
  }, { now: new Date(repo.clock) });

  const answered = await report(repo.path);
  const uiBefore = answered.modules.find((m) => m.id === 'ui');
  assert.equal(uiBefore.score, 1);
  assert.ok(answered.total > before.total, 'answering raises the repo total');
  assert.equal(badge(answered).color, 'yellow', 'data is still unquizzed, so the total is mid-range');

  // 4. The local page works with no push and no network.
  const page = await render(repo.path, { open: false });
  const html = await fs.readFile(page, 'utf8');
  assert.match(html, /window\.__REPORT__/);
  assert.ok(html.includes('"ui"'), 'the report is baked into the page');

  // 5. Publishing lands on the orphan branch and leaves main alone.
  await repo.git(['remote', 'add', 'origin', remote]);
  const published = await publish(repo.path);
  assert.equal(published.pushed, true);
  const { stdout: branches } = await exec('git', ['-C', remote, 'branch', '--format=%(refname:short)']);
  assert.equal(branches.trim(), 'kenmap-data');
  const { stdout: files } = await exec('git', ['-C', remote, 'ls-tree', '--name-only', 'kenmap-data']);
  assert.deepEqual(files.trim().split('\n').sort(), ['.gitignore', 'badge.json', 'report.json', 'results.jsonl']);

  // 6. The line that has to hold: a rewrite the user did not follow costs them.
  await repo.write({
    'src/app/lib/ui/home.dart': "import 'package:demo/data/repo.dart';\n" + body(300, 'rewritten by ai'),
  });
  await repo.commit('refactor: rewrite home screen');

  const after = await report(repo.path);
  const uiAfter = after.modules.find((m) => m.id === 'ui');
  assert.ok(uiAfter.breakdown[0].churn > 0.5, `expected heavy churn, got ${uiAfter.breakdown[0].churn}`);
  assert.ok(uiAfter.score < uiBefore.score, 'the score must fall after a rewrite');
  assert.ok(after.total < answered.total, 'and so must the repo total');
});
