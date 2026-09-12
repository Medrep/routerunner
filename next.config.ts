import type { NextConfig } from 'next';

const releaseId = process.env.ROUTERUNNER_RELEASE_ID;

const nextConfig: NextConfig = releaseId
  ? { generateBuildId: async () => releaseId }
  : {};

export default nextConfig;
