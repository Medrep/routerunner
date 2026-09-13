import type { NextConfig } from 'next';
import { ROUTERUNNER_RELEASE_HEADER } from './pwa/service-worker-core.ts';

const releaseId = process.env.ROUTERUNNER_RELEASE_ID;

const nextConfig: NextConfig = releaseId
  ? {
      generateBuildId: async () => releaseId,
      headers: async () => [
        {
          source: '/',
          headers: [{ key: ROUTERUNNER_RELEASE_HEADER, value: releaseId }],
        },
      ],
    }
  : {};

export default nextConfig;
