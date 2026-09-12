import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const publicFile = (name: string) =>
  new URL(`../../public/${name}`, import.meta.url);

function pngDimensions(file: URL): readonly [number, number] {
  const png = readFileSync(file);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

void test('production manifest has the owner-field RouteRunner contract', () => {
  const manifest = JSON.parse(
    readFileSync(publicFile('manifest.webmanifest'), 'utf8'),
  ) as {
    background_color: string;
    description: string;
    display: string;
    icons: Array<{
      purpose: string;
      sizes: string;
      src: string;
      type: string;
    }>;
    id: string;
    name: string;
    scope: string;
    short_name: string;
    start_url: string;
    theme_color: string;
  };

  assert.equal(manifest.id, '/');
  assert.equal(manifest.name, 'RouteRunner');
  assert.equal(manifest.short_name, 'RouteRunner');
  assert.equal(manifest.description, 'Your AI plans. RouteRunner executes.');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#f4f5f2');
  assert.equal(manifest.theme_color, '#176b50');

  const regular192 = manifest.icons.find(
    ({ sizes, purpose }) => sizes === '192x192' && purpose === 'any',
  );
  const regular512 = manifest.icons.find(
    ({ sizes, purpose }) => sizes === '512x512' && purpose === 'any',
  );
  const maskable = manifest.icons.find(
    ({ sizes, purpose }) => sizes === '512x512' && purpose === 'maskable',
  );
  assert.ok(regular192);
  assert.ok(regular512);
  assert.ok(maskable);

  for (const icon of [regular192, regular512, maskable]) {
    assert.equal(icon.type, 'image/png');
    assert.ok(existsSync(publicFile(icon.src.slice(1))));
  }
  assert.deepEqual(
    pngDimensions(publicFile(regular192.src.slice(1))),
    [192, 192],
  );
  assert.deepEqual(
    pngDimensions(publicFile(regular512.src.slice(1))),
    [512, 512],
  );
  assert.deepEqual(
    pngDimensions(publicFile(maskable.src.slice(1))),
    [512, 512],
  );
  assert.deepEqual(
    pngDimensions(publicFile('apple-touch-icon.png')),
    [180, 180],
  );
});
