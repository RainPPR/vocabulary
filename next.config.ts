import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  cleanDistDir: true,
  basePath: process.env.PAGES_BASE_PATH || '',
  output: 'export',
  images: {
    unoptimized: true
  }
};

export default nextConfig;
