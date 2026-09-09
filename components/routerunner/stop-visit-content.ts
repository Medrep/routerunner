import type { Stop } from '../../domain/index.ts';

export type StopVisitContentSurface = 'current' | 'details';

export interface StopVisitContentModel {
  surface: StopVisitContentSurface;
  visitBrief?: string;
  highlights?: readonly string[];
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
  if (stop.visitBrief === undefined && highlights === undefined) return null;

  return {
    surface,
    visitBrief: stop.visitBrief,
    highlights,
  };
}
