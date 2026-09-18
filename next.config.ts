import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
  typescript: { ignoreBuildErrors: false },
  // pdfjs-dist has an optional `canvas` dependency it only uses under Node; the
  // browser bundle must never try to resolve it.
  turbopack: {
    resolveAlias: { canvas: './src/client/lib/empty-module.ts' },
  },
};

export default nextConfig;
