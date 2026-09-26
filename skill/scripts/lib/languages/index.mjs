import dart from './dart.mjs';

export const adapters = [dart];

export function adapterFor(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return adapters.find((a) => a.extensions.includes(ext)) ?? null;
}

export function manifestAdapter(filePath) {
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  return adapters.find((a) => a.manifestFiles.includes(base)) ?? null;
}
