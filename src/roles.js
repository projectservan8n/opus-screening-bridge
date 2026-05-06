import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLES_DIR = path.resolve(__dirname, '..', 'roles');

let cache = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30_000;

function loadAll() {
  const files = fs.readdirSync(ROLES_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const map = {};
  for (const file of files) {
    const slug = file.replace(/\.json$/, '');
    try {
      const spec = JSON.parse(fs.readFileSync(path.join(ROLES_DIR, file), 'utf-8'));
      if (spec.slug && spec.slug !== slug) {
        console.warn(`Slug mismatch in ${file}: file=${slug} spec=${spec.slug}`);
      }
      map[slug] = { ...spec, slug };
    } catch (e) {
      console.error(`Failed to parse role ${file}:`, e.message);
    }
  }
  return map;
}

function getMap() {
  const now = Date.now();
  if (!cache || now - cacheLoadedAt > CACHE_TTL_MS) {
    cache = loadAll();
    cacheLoadedAt = now;
  }
  return cache;
}

export function getRole(slug) {
  return getMap()[slug] || null;
}

export function listRoles({ statusFilter = ['open'] } = {}) {
  const all = Object.values(getMap());
  return all.filter((r) => statusFilter.includes(r.status));
}

export function clearCache() {
  cache = null;
  cacheLoadedAt = 0;
}
