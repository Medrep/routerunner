import type { LogisticsRole, Stop, StopKind } from './types.ts';

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
