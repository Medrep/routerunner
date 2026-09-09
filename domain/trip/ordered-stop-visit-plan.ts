import type { StopVisitPlan, StopVisitPlanItem } from './types.ts';

/** Returns canonical explicit order without mutating prepared Trip data. */
export function orderedStopVisitPlanItems(
  visitPlan: Pick<StopVisitPlan, 'items'>,
): StopVisitPlanItem[] {
  return [...visitPlan.items].sort((left, right) => left.order - right.order);
}
