import {
  mapGeolocationError,
  type ForegroundCoordinates,
  type ForegroundLocationState,
} from './foreground-location.ts';

export const ONE_SHOT_GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 15_000,
  timeout: 20_000,
};

export type OneShotGeolocationAdapter = Pick<Geolocation, 'getCurrentPosition'>;

/**
 * Bounded, presentation-only location acquisition for an explicit user action.
 * It never starts a watcher and late callbacks are ignored after reset/dispose.
 */
export class OneShotLocationController {
  private disposed = false;
  private locating = false;
  private generation = 0;
  private readonly geolocation: OneShotGeolocationAdapter | undefined;
  private readonly onState: (state: ForegroundLocationState) => void;
  private readonly now: () => number;

  constructor(
    geolocation: OneShotGeolocationAdapter | undefined,
    onState: (state: ForegroundLocationState) => void,
    now: () => number = Date.now,
  ) {
    this.geolocation = geolocation;
    this.onState = onState;
    this.now = now;
  }

  request(): void {
    if (this.disposed || this.locating) return;
    if (!this.geolocation) {
      this.onState({
        status: 'unsupported',
        message: 'Browser geolocation is unavailable.',
      });
      return;
    }

    this.locating = true;
    this.onState({ status: 'locating' });
    const generation = ++this.generation;
    try {
      this.geolocation.getCurrentPosition(
        (position) => {
          if (!this.isCurrentGeneration(generation)) return;
          this.locating = false;
          const observedAt = position.timestamp || this.now();
          const coordinates: ForegroundCoordinates = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            observedAt: new Date(observedAt).toISOString(),
          };
          this.onState({ status: 'available', coordinates });
        },
        (error) => {
          if (!this.isCurrentGeneration(generation)) return;
          this.locating = false;
          this.onState(mapGeolocationError(error));
        },
        ONE_SHOT_GEOLOCATION_OPTIONS,
      );
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) return;
      this.locating = false;
      this.onState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to request the current location.',
      });
    }
  }

  reset(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.locating = false;
    this.onState({ status: 'inactive' });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.locating = false;
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.generation && !this.disposed;
  }
}
