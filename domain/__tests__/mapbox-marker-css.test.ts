import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('custom stop markers preserve Mapbox absolute positioning', () => {
  const css = readFileSync(
    new URL('../../app/globals.css', import.meta.url),
    'utf8',
  );
  const rule = css.match(/\.mapbox-stop-marker\s*\{([^}]*)\}/);

  assert.ok(rule?.[1], 'mapbox stop marker rule must exist');
  assert.match(rule[1], /(?:^|;)\s*position:\s*absolute\s*;/);
  assert.doesNotMatch(rule[1], /position:\s*relative\s*;/);
});

void test('Via markers preserve Mapbox positioning and remain unnumbered presentation', () => {
  const css = readFileSync(
    new URL('../../app/globals.css', import.meta.url),
    'utf8',
  );
  const routeMap = readFileSync(
    new URL('../../components/routerunner/route-map.tsx', import.meta.url),
    'utf8',
  );
  const rule = css.match(/\.mapbox-via-marker\s*\{([^}]*)\}/);

  assert.ok(rule?.[1], 'Mapbox Via marker rule must exist');
  assert.match(rule[1], /(?:^|;)\s*position:\s*absolute\s*;/);
  assert.match(css, /\.mapbox-via-marker\s*>\s*span\s*\{/);
  assert.doesNotMatch(routeMap, /LineString|addLayer|line-dasharray/);
  assert.match(routeMap, /viaLabel\.textContent\s*=\s*'Via'/);
});
