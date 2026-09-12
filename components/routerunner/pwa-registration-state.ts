export type PwaState = 'idle' | 'offline-ready' | 'update-available';

interface RegistrationWorkers {
  active: ServiceWorker | null;
  waiting: ServiceWorker | null;
}

function isRouteRunnerWorker(worker: ServiceWorker | null): boolean {
  return worker ? new URL(worker.scriptURL).pathname === '/sw.js' : false;
}

export function pwaStateForRegistration(
  registration: RegistrationWorkers,
  hasController: boolean,
): PwaState {
  if (hasController && isRouteRunnerWorker(registration.waiting)) {
    return 'update-available';
  }
  return isRouteRunnerWorker(registration.active) ? 'offline-ready' : 'idle';
}

export function pwaStateForInstalledWorker(hasController: boolean): PwaState {
  return hasController ? 'update-available' : 'idle';
}
