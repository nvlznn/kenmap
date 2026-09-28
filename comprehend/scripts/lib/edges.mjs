import { adapterFor, manifestAdapter } from './languages/index.mjs';

/** Manifests are hints, never requirements: a repo with none still scans. */
export function findPackages(files, blobs) {
  const packages = [];
  for (const file of files) {
    const adapter = manifestAdapter(file.path);
    if (!adapter) continue;
    const blob = blobs.get(file.sha);
    if (!blob) continue;
    const name = adapter.packageName(blob.toString('utf8'));
    if (!name) continue;
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '.';
    packages.push({ name, root: dir, language: adapter.id });
  }
  return packages;
}

/**
 * File-level dependency edges. Unresolvable targets (third-party packages,
 * stdlib) and files no adapter recognizes are simply skipped — a repo in an
 * unsupported language still scores, it just has no edges.
 */
export function fileEdges(files, blobs, packages) {
  const known = new Set(files.map((f) => f.path));
  const edges = [];
  for (const file of files) {
    const adapter = adapterFor(file.path);
    if (!adapter) continue;
    const blob = blobs.get(file.sha);
    if (!blob || blob.includes(0)) continue;
    for (const raw of adapter.parseImports(blob.toString('utf8'))) {
      const target = adapter.resolve(raw, { filePath: file.path, packages });
      if (target && target !== file.path && known.has(target)) edges.push({ from: file.path, to: target });
    }
  }
  return edges;
}

export function languagesUsed(files) {
  const ids = new Set();
  for (const file of files) {
    const adapter = adapterFor(file.path);
    if (adapter) ids.add(adapter.id);
  }
  return [...ids];
}
