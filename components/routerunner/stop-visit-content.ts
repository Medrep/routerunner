import {
  orderedStopVisitPlanItems,
  type Stop,
  type StopVisitPlanItem,
} from '../../domain/index.ts';

export type StopVisitContentSurface = 'current' | 'details';

export interface StopVisitContentModel {
  surface: StopVisitContentSurface;
  visitBrief?: string;
  highlights?: readonly string[];
  visitPlanItemCount?: number;
  visitPlanItems?: readonly StopVisitPlanItem[];
}

/**
 * Keeps prepared Stop content separate from execution state and returns no
 * presentation model when the optional content is absent.
 */
export function stopVisitContentModel(
  stop: Stop,
  surface: StopVisitContentSurface,
): StopVisitContentModel | null {
  const highlights =
    stop.highlights !== undefined && stop.highlights.length > 0
      ? stop.highlights
      : undefined;
  const visitPlanItems =
    stop.visitPlan === undefined
      ? undefined
      : orderedStopVisitPlanItems(stop.visitPlan);
  if (
    stop.visitBrief === undefined &&
    highlights === undefined &&
    visitPlanItems === undefined
  )
    return null;

  return {
    surface,
    visitBrief: stop.visitBrief,
    highlights,
    ...(surface === 'current' && visitPlanItems !== undefined
      ? { visitPlanItemCount: visitPlanItems.length }
      : {}),
    ...(surface === 'details' && visitPlanItems !== undefined
      ? { visitPlanItems }
      : {}),
  };
}
