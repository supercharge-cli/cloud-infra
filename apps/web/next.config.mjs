import { createMDX } from 'fumadocs-mdx/next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();
const appDir = path.dirname(fileURLToPath(import.meta.url));
// Monorepo root (cloud-infra/) — used for correct file tracing of shared deps
const monorepoRoot = path.join(appDir, '../..');

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Keep the app self-contained when Root Directory = apps/web
  outputFileTracingRoot: monorepoRoot,
  experimental: { cpus: 2 },
};

export default withMDX(config);
