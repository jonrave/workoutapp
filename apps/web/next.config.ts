import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@peakspan/engine', '@peakspan/adapters', '@peakspan/store'],
};

export default nextConfig;
