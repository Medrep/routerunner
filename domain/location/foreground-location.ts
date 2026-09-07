export interface ForegroundCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  observedAt: string;
}

export type ForegroundLocationState =
  | { status: 'inactive' }
  | { status: 'locating' }
  | { status: 'available'; coordinates: ForegroundCoordinates }
  | { status: 'denied'; message: string }
  | { status: 'unavailable'; message: string }
  | { status: 'timeout'; message: string }
  | { status: 'error'; message: string };

export type GeolocationAdapter = Pick<
  Geolocation,
  'watchPosition' | 'clearWatch'
>;

export interface VisibilityAdapter {
  isVisible(): boolean;
  addChangeListener(listener: () => void): void;
  removeChangeListener(listener: () => void): void;
}

export function mapGeolocationError(
  error: Pick<GeolocationPositionError, 'code' | 'message'>,
): ForegroundLocationState {
  if (error.code === 1) {
    return {
      status: 'denied',
      message: error.message || 'Location permission was denied.',
    };
  }
  if (error.code === 2) {
    return {
      status: 'unavailable',
      message: error.message || 'The current position is unavailable.',
    };
  }
  if (error.code === 3) {
    return {
      status: 'timeout',
      message: error.message || 'The location request timed out.',
    };
  }
  return {
    status: 'error',
    message: error.message || 'An unexpected location error occurred.',
  };
}

export class ForegroundLocationController {
  private active = false;
  private disposed = false;
  private generation = 0;
  private watchId: number | undefined;
  private readonly geolocation: GeolocationAdapter | undefined;
  private readonly visibility: VisibilityAdapter;
  private readonly onState: (state: ForegroundLocationState) => void;
  private readonly now: () => number;
  private readonly handleVisibilityChange = () => this.reconcile();

  constructor(
    geolocation: GeolocationAdapter | undefined,
    visibility: VisibilityAdapter,
    onState: (state: ForegroundLocationState) => void,
    now: () => number = Date.now,
  ) {
    this.geolocation = geolocation;
    this.visibility = visibility;
    this.onState = onState;
    this.now = now;
    this.visibility.addChangeListener(this.handleVisibilityChange);
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.reconcile();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWatch();
    this.visibility.removeChangeListener(this.handleVisibilityChange);
  }

  private reconcile(): void {
    if (this.disposed) return;
    if (!this.active || !this.visibility.isVisible()) {
      this.stopWatch();
      this.onState({ status: 'inactive' });
      return;
    }
    if (this.watchId !== undefined) return;
    if (!this.geolocation) {
      this.onState({
        status: 'unavailable',
        message: 'Browser geolocation is unavailable.',
      });
      return;
    }

    this.onState({ status: 'locating' });
    const generation = ++this.generation;
    try {
      const watchId = this.geolocation.watchPosition(
        (position) => {
          if (!this.isCurrentGeneration(generation)) return;
          this.onState({
            status: 'available',
            coordinates: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              observedAt: new Date(
                position.timestamp || this.now(),
              ).toISOString(),
            },
          });
        },
        (error) => {
          if (!this.isCurrentGeneration(generation)) return;
          this.stopWatch();
          this.onState(mapGeolocationError(error));
        },
        {
          enableHighAccuracy: true,
          maximumAge: 15_000,
          timeout: 20_000,
        },
      );
      if (!this.isCurrentGeneration(generation)) {
        this.geolocation.clearWatch(watchId);
        return;
      }
      this.watchId = watchId;
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) return;
      this.generation += 1;
      this.watchId = undefined;
      this.onState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to start foreground location tracking.',
      });
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return (
      generation === this.generation &&
      !this.disposed &&
      this.active &&
      this.visibility.isVisible()
    );
  }

  private stopWatch(): void {
    this.generation += 1;
    const watchId = this.watchId;
    this.watchId = undefined;
    if (watchId !== undefined && this.geolocation) {
      this.geolocation.clearWatch(watchId);
    }
  }
}
