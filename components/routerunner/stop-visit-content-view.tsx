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
    </div>
  );
}
