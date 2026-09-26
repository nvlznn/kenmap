import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Pinned so commit SHAs are reproducible across machines and runs.
const IDENTITY = {
  GIT_AUTHOR_NAME: 'KenMap Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@kenmap.test',
  GIT_COMMITTER_NAME: 'KenMap Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@kenmap.test',
};

/**
 * Fixtures live in a tmpdir, never inside the tool repo: a nested repo
 * confuses git commands that walk up to the enclosing worktree.
 */
export async function createRepo(name = 'repo') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `kenmap-${name}-`));
  const repo = new Fixture(dir);
  await repo.git(['init', '-q', '-b', 'main']);
  return repo;
}

class Fixture {
  constructor(dir) {
    this.path = dir;
    this.clock = Date.UTC(2026, 0, 1);
  }

  git(args, extraEnv = {}) {
    return exec('git', ['-C', this.path, ...args], {
      env: { ...process.env, ...IDENTITY, ...extraEnv },
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  async write(files) {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(this.path, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content);
    }
    return this;
  }

  async remove(...rels) {
    for (const rel of rels) await fs.rm(path.join(this.path, rel), { recursive: true, force: true });
    return this;
  }

  async move(from, to) {
    const target = path.join(this.path, to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await this.git(['mv', from, to]);
    return this;
  }

  async symlink(target, linkPath) {
    const full = path.join(this.path, linkPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.symlink(target, full);
    return this;
  }

  async addSubmodule(otherRepo, at) {
    await this.git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', otherRepo.path, at]);
    return this;
  }

  /** Each commit advances a fake clock, so ordering is deterministic. */
  async commit(message) {
    this.clock += 60 * 60 * 1000;
    const when = new Date(this.clock).toISOString();
    await this.git(['add', '-A']);
    await this.git(['commit', '-q', '-m', message], {
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    });
    return this.head();
  }

  async head() {
    const { stdout } = await this.git(['rev-parse', 'HEAD']);
    return stdout.trim();
  }

  /**
   * Collapses history into one commit, the way "Squash and merge" does, then
   * prunes. Without the prune the old commits survive in the object database
   * via the reflog, so they would still be usable as a churn baseline — the
   * interesting failure only appears on a fresh clone or after gc.
   */
  async squashAll(message = 'chore: squash') {
    await this.git(['checkout', '-q', '--orphan', 'squashed']);
    await this.git(['add', '-A']);
    this.clock += 60 * 60 * 1000;
    const when = new Date(this.clock).toISOString();
    await this.git(['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
    await this.git(['branch', '-q', '-D', 'main']);
    await this.git(['branch', '-q', '-m', 'main']);
    await this.git(['reflog', 'expire', '--expire=now', '--all']);
    await this.git(['gc', '-q', '--prune=now']);
    return this.head();
  }

  cleanup() {
    return fs.rm(this.path, { recursive: true, force: true });
  }
}
