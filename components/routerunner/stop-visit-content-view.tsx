import type { Stop } from '../../domain/index.ts';
import {
  stopVisitContentModel,
  type StopVisitContentSurface,
} from './stop-visit-content.ts';

export function StopVisitContent({
  stop,
  surface,
}: {
  stop: Stop;
  surface: StopVisitContentSurface;
}) {
  const content = stopVisitContentModel(stop, surface);
  if (content === null) return null;

  return (
    <div className={`stop-visit-content ${content.surface}`}>
      {content.visitBrief !== undefined && (
        <p className="visit-brief">{content.visitBrief}</p>
      )}
      {content.highlights !== undefined && (
        <section className="stop-highlights" aria-label="What to notice or do">
          <h3>What to notice or do</h3>
          <ul>
            {content.highlights.map((highlight, index) => (
              <li key={`${index}-${highlight}`}>{highlight}</li>
            ))}
          </ul>
        </section>
      )}
      {content.visitPlanItemCount !== undefined && (
        <p className="visit-plan-summary">
          {content.visitPlanItemCount}{' '}
          {content.visitPlanItemCount === 1 ? 'thing' : 'things'} planned inside
        </p>
      )}
      {content.visitPlanItems !== undefined && (
        <section className="stop-visit-plan" aria-label="Inside this stop">
          <h3>Inside this stop</h3>
          <ol>
            {content.visitPlanItems.map((item) => (
              <li key={item.id}>
                <div>
                  <h4>{item.name}</h4>
                  {item.visitBrief !== undefined && <p>{item.visitBrief}</p>}
                  {item.highlights !== undefined && (
                    <ul aria-label={`What to notice or do at ${item.name}`}>
                      {item.highlights.map((highlight, index) => (
                        <li key={`${index}-${highlight}`}>{highlight}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
