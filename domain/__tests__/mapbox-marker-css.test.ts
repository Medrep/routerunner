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
