import { createMDX } from 'fumadocs-mdx/next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();
const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default withMDX({
  ...config,
  // Apply after withMDX so it is not dropped
  turbopack: {
    root: appDir,
  },
  outputFileTracingRoot: appDir,
});
