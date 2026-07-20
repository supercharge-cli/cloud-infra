/**
 * On Vercel monorepos, Next may build to apps/web/.next while a later
 * platform step still lstats <repo>/.next/package.json (ENOENT).
 * Mirror the build output to the git root when that layout is detected.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(webDir, '../..');
const src = path.join(webDir, '.next');
const dest = path.join(repoRoot, '.next');

const isMonorepo =
  fs.existsSync(path.join(repoRoot, 'apps/web/package.json')) &&
  path.basename(path.dirname(webDir)) === 'apps';

if (!process.env.VERCEL || !isMonorepo) {
  process.exit(0);
}

if (!fs.existsSync(src)) {
  console.warn('[vercel-align-next] skip: missing', src);
  process.exit(0);
}

// Already the same path (Root Directory == apps/web and path0 == webDir)
if (path.resolve(src) === path.resolve(dest)) {
  process.exit(0);
}

console.log('[vercel-align-next] mirroring', src, '→', dest);
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
