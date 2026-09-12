import type { LogisticsRole, Stop, StopKind } from './types.ts';

export type MapMarkerRole =
  | 'sightseeing'
  | 'logistics-start'
  | 'logistics-end'
  | 'logistics-transfer'
  | 'post-day';

/** Resolves the backward-compatible default for existing Stop fixtures. */
export function stopKind(stop: Pick<Stop, 'kind'>): StopKind {
  return stop.kind ?? 'sightseeing';
}

export function isSightseeingStop(stop: Pick<Stop, 'kind'>): boolean {
  return stopKind(stop) === 'sightseeing';
}

export function isLogisticsStop(stop: Pick<Stop, 'kind'>): boolean {
  return stopKind(stop) === 'logistics';
}

/** Concise field-language for a validated logistics role. */
export function logisticsRoleLabel(role: LogisticsRole): string {
  switch (role) {
    case 'start':
      return 'Start point';
    case 'accommodation':
      return 'Accommodation / end';
    case 'transfer':
      return 'Transfer';
  }
}

/** Short marker language that does not consume a sightseeing number. */
export function logisticsRoleMarkerLabel(role: LogisticsRole): string {
  return role === 'start' ? 'START' : role === 'accommodation' ? 'END' : 'VIA';
}

/** Semantic map role used for color-independent marker shape and text. */
export function stopMapMarkerRole(
  stop: Pick<Stop, 'kind' | 'logisticsRole'>,
): Exclude<MapMarkerRole, 'post-day'> {
  if (isSightseeingStop(stop)) return 'sightseeing';
  if (stop.logisticsRole === 'start') return 'logistics-start';
  if (stop.logisticsRole === 'accommodation') return 'logistics-end';
  return 'logistics-transfer';
}

/** User-facing semantic label; logistics never leaks compatibility priority. */
export function stopSemanticLabel(stop: Stop): string {
  if (isLogisticsStop(stop) && stop.logisticsRole) {
    return logisticsRoleLabel(stop.logisticsRole);
  }
  if (stop.priority === 'must') return 'Must-see';
  if (stop.priority === 'optional') return 'Optional';
  return 'Part of your route';
}

export function stopActivityLabel(stop: Stop): string {
  return isLogisticsStop(stop) && stop.logisticsRole
    ? logisticsRoleLabel(stop.logisticsRole)
    : 'Explore';
}

export function stopMarkerLabel(
  stop: Stop,
  sightseeingPosition: number | undefined,
): string {
  if (isSightseeingStop(stop)) return String(sightseeingPosition ?? '—');
  return stop.logisticsRole
    ? logisticsRoleMarkerLabel(stop.logisticsRole)
    : 'LOGISTICS';
}
