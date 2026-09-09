import type {
  DoNowQueueEntry,
  StopExecution,
  TripExecutionState,
} from '../execution/types.ts';
import type { DayPlanItem, PostDayDestinationId } from '../trip/types.ts';
import type { StopVisitPlanItemId } from '../trip/types.ts';

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type ExpectFalse<Value extends false> = Value;

/** Compile-only regression evidence for the post-day identity boundary. */
export type PostDayDestinationIdentityBoundaryAssertions = [
  ExpectFalse<IsAssignable<PostDayDestinationId, DayPlanItem['stopId']>>,
  ExpectFalse<
    IsAssignable<PostDayDestinationId, TripExecutionState['currentStopId']>
  >,
  ExpectFalse<IsAssignable<PostDayDestinationId, StopExecution['stopId']>>,
  ExpectFalse<IsAssignable<PostDayDestinationId, DoNowQueueEntry['stopId']>>,
];

/** Compile-only evidence that internal item identity cannot become Stop identity. */
export type StopVisitPlanIdentityBoundaryAssertions = [
  ExpectFalse<IsAssignable<StopVisitPlanItemId, DayPlanItem['stopId']>>,
  ExpectFalse<
    IsAssignable<StopVisitPlanItemId, TripExecutionState['currentStopId']>
  >,
  ExpectFalse<IsAssignable<StopVisitPlanItemId, StopExecution['stopId']>>,
  ExpectFalse<IsAssignable<StopVisitPlanItemId, DoNowQueueEntry['stopId']>>,
];
