import {
  orderedStopVisitPlanItems,
  type Stop,
  type StopId,
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

export interface StopDetailsCtaModel {
  readonly label: string;
  readonly detailStopId: StopId;
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
  const orderedVisitPlanItems =
    stop.visitPlan === undefined
      ? undefined
      : orderedStopVisitPlanItems(stop.visitPlan);
  const visitPlanItems = orderedVisitPlanItems?.length
    ? orderedVisitPlanItems
    : undefined;
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

/** Derives a Details affordance from existing prepared Stop content only. */
export function stopDetailsCtaModel(stop: Stop): StopDetailsCtaModel | null {
  const details = stopVisitContentModel(stop, 'details');
  if (details === null) return null;

  const itemCount = details.visitPlanItems?.length;
  return {
    detailStopId: stop.id,
    label:
      itemCount === undefined
        ? 'View details'
        : `View ${itemCount} ${itemCount === 1 ? 'thing' : 'things'} inside`,
  };
}
