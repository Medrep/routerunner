declare const __ROUTERUNNER_RELEASE_ID__: string;

export const routeRunnerReleaseId =
  typeof __ROUTERUNNER_RELEASE_ID__ === 'string'
    ? __ROUTERUNNER_RELEASE_ID__
    : 'development';
