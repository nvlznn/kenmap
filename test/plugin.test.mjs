import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8'));

const plugin = await readJson('.claude-plugin/plugin.json');
const marketplace = await readJson('.claude-plugin/marketplace.json');
const pkg = await readJson('package.json');

test('the marketplace lists this repo itself as the kenmap plugin', () => {
  assert.equal(marketplace.name, 'noky');
  assert.ok(marketplace.owner?.name, 'owner.name is required');
  assert.equal(marketplace.plugins.length, 1);
  const [entry] = marketplace.plugins;
  // A name that differs from plugin.json is the most common install failure.
  assert.equal(entry.name, plugin.name);
  assert.equal(entry.source, '.');
  assert.equal(entry.version, undefined, 'the version lives in plugin.json only, or the two drift apart');
});

test('the plugin points at the comprehend skill, which is where it says', async () => {
  assert.equal(plugin.name, 'kenmap');
  assert.deepEqual(plugin.skills, ['./comprehend']);
  const skill = await fs.readFile(path.join(ROOT, 'comprehend/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: comprehend\n/);
});

test('plugin.json and package.json carry the same version, so a release bumps both', () => {
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.version, pkg.version);
});

test('the page template the skill renders from ships inside the plugin', async () => {
  await fs.access(path.join(ROOT, 'web/index.html'));
});

test('everything a user reads names the command the way the plugin registers it', async () => {
  // A plugin skill always runs as /<plugin>:<skill>; a bare /comprehend no
  // longer exists. Lines that compare the two on purpose are allowed.
  const bare = /(?<![\w.~$/:-])\/comprehend(?![\w-])/;
  const files = ['comprehend/SKILL.md', 'README.md', 'docs/GUIDE.md', 'web/index.html', 'api/report.js'];
  for (const file of files) {
    const lines = (await fs.readFile(path.join(ROOT, file), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (bare.test(line) && !line.includes('/kenmap:comprehend')) {
        assert.fail(`${file}:${i + 1} still says /comprehend: ${line.trim()}`);
      }
    });
  }
});
