export const ROUTERUNNER_CACHE_PREFIX = 'routerunner-shell:';

interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

interface CacheStorageLike {
  delete(cacheName: string): Promise<boolean>;
  keys(): Promise<string[]>;
  open(cacheName: string): Promise<CacheLike>;
}

export interface InstallReleaseOptions {
  assetUrls: readonly string[];
  cacheStorage: CacheStorageLike;
  fetcher: (request: Request) => Promise<Response>;
  origin: string;
  releaseId: string;
}

interface HtmlStartTag {
  attributes: Map<string, string | undefined>;
  duplicateAttributes: Set<string>;
  end: number;
  malformed: boolean;
  name: string;
}

function isHtmlSpace(character: string | undefined): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\n' ||
    character === '\f' ||
    character === '\r'
  );
}

function isAsciiLetter(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function skipMarkup(html: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let cursor = start; cursor < html.length; cursor += 1) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return cursor + 1;
    }
  }
  return html.length;
}

function parseStartTag(html: string, start: number): HtmlStartTag | undefined {
  let cursor = start + 1;
  if (!isAsciiLetter(html[cursor])) return undefined;

  const nameStart = cursor;
  while (
    cursor < html.length &&
    !isHtmlSpace(html[cursor]) &&
    html[cursor] !== '/' &&
    html[cursor] !== '>'
  ) {
    cursor += 1;
  }
  const name = html.slice(nameStart, cursor).toLowerCase();
  const attributes = new Map<string, string | undefined>();
  const duplicateAttributes = new Set<string>();

  while (cursor < html.length) {
    while (isHtmlSpace(html[cursor])) cursor += 1;
    if (html[cursor] === '>') {
      return {
        attributes,
        duplicateAttributes,
        end: cursor + 1,
        malformed: false,
        name,
      };
    }
    if (html[cursor] === '/' && html[cursor + 1] === '>') {
      return {
        attributes,
        duplicateAttributes,
        end: cursor + 2,
        malformed: false,
        name,
      };
    }
    if (
      cursor >= html.length ||
      html[cursor] === '/' ||
      html[cursor] === '<' ||
      html[cursor] === '"' ||
      html[cursor] === "'" ||
      html[cursor] === '`' ||
      html[cursor] === '='
    ) {
      return {
        attributes,
        duplicateAttributes,
        end: skipMarkup(html, cursor),
        malformed: true,
        name,
      };
    }

    const attributeStart = cursor;
    while (
      cursor < html.length &&
      !isHtmlSpace(html[cursor]) &&
      html[cursor] !== '/' &&
      html[cursor] !== '>' &&
      html[cursor] !== '=' &&
      html[cursor] !== '<' &&
      html[cursor] !== '"' &&
      html[cursor] !== "'" &&
      html[cursor] !== '`'
    ) {
      cursor += 1;
    }
    const attributeName = html.slice(attributeStart, cursor).toLowerCase();
    while (isHtmlSpace(html[cursor])) cursor += 1;

    let value: string | undefined;
    if (html[cursor] === '=') {
      cursor += 1;
      while (isHtmlSpace(html[cursor])) cursor += 1;
      const quote = html[cursor];
      if (quote === '"' || quote === "'") {
        const valueStart = ++cursor;
        while (cursor < html.length && html[cursor] !== quote) cursor += 1;
        if (cursor >= html.length) {
          return {
            attributes,
            duplicateAttributes,
            end: html.length,
            malformed: true,
            name,
          };
        }
        value = html.slice(valueStart, cursor);
        cursor += 1;
      } else {
        const valueStart = cursor;
        while (
          cursor < html.length &&
          !isHtmlSpace(html[cursor]) &&
          html[cursor] !== '>'
        ) {
          if (
            html[cursor] === '"' ||
            html[cursor] === "'" ||
            html[cursor] === '<' ||
            html[cursor] === '=' ||
            html[cursor] === '`'
          ) {
            return {
              attributes,
              duplicateAttributes,
              end: skipMarkup(html, cursor),
              malformed: true,
              name,
            };
          }
          cursor += 1;
        }
        if (cursor === valueStart) {
          return {
            attributes,
            duplicateAttributes,
            end: skipMarkup(html, cursor),
            malformed: true,
            name,
          };
        }
        value = html.slice(valueStart, cursor);
      }
    }

    if (attributes.has(attributeName)) {
      duplicateAttributes.add(attributeName);
    } else {
      attributes.set(attributeName, value);
    }
  }

  return {
    attributes,
    duplicateAttributes,
    end: html.length,
    malformed: true,
    name,
  };
}

function skipRawText(
  html: string,
  lowerHtml: string,
  start: number,
  tagName: 'script' | 'style',
): number {
  const closingTag = `</${tagName}`;
  let cursor = start;
  while ((cursor = lowerHtml.indexOf(closingTag, cursor)) !== -1) {
    const boundary = lowerHtml[cursor + closingTag.length];
    if (boundary === '>' || boundary === '/' || isHtmlSpace(boundary)) {
      return skipMarkup(html, cursor + closingTag.length);
    }
    cursor += closingTag.length;
  }
  return html.length;
}

export function rootDocumentRelease(html: string): string | undefined {
  const releaseMarkers: Array<string | undefined> = [];
  const lowerHtml = html.toLowerCase();
  let cursor = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart === -1) break;
    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }
    const marker = html[tagStart + 1];
    if (marker === '!' || marker === '?' || marker === '/') {
      cursor = skipMarkup(html, tagStart + 2);
      continue;
    }

    const tag = parseStartTag(html, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    cursor = tag.end;
    if (!tag.malformed && (tag.name === 'script' || tag.name === 'style')) {
      cursor = skipRawText(html, lowerHtml, cursor, tag.name);
      continue;
    }
    if (tag.malformed || tag.name !== 'meta') continue;

    const name = tag.attributes.get('name');
    if (name === 'routerunner-release') {
      const content = tag.attributes.get('content');
      releaseMarkers.push(
        tag.duplicateAttributes.has('name') ||
          tag.duplicateAttributes.has('content') ||
          content === undefined ||
          content.length === 0
          ? undefined
          : content,
      );
    }
  }

  return releaseMarkers.length === 1 ? releaseMarkers[0] : undefined;
}

export function releaseCacheName(releaseId: string): string {
  return `${ROUTERUNNER_CACHE_PREFIX}${releaseId}`;
}

export function isRootDocumentNavigation(
  request: Pick<Request, 'method' | 'mode' | 'url'>,
  origin: string,
): boolean {
  if (request.method !== 'GET' || request.mode !== 'navigate') return false;
  const url = new URL(request.url);
  return url.origin === origin && url.pathname === '/';
}

export function precachedAssetUrl(
  request: Pick<Request, 'method' | 'url'>,
  origin: string,
  assetUrls: ReadonlySet<string>,
): string | undefined {
  if (request.method !== 'GET') return undefined;
  const url = new URL(request.url);
  if (url.origin !== origin) return undefined;
  const key = `${url.pathname}${url.search}`;
  return assetUrls.has(key) ? key : undefined;
}

export async function installRelease({
  assetUrls,
  cacheStorage,
  fetcher,
  origin,
  releaseId,
}: InstallReleaseOptions): Promise<string> {
  const cacheName = releaseCacheName(releaseId);
  const rootUrl = new URL('/', origin).toString();

  try {
    const cache = await cacheStorage.open(cacheName);
    const rootRequest = new Request(rootUrl, {
      cache: 'reload',
      credentials: 'same-origin',
      headers: { 'cache-control': 'no-cache' },
    });
    const rootResponse = await fetcher(rootRequest);
    if (!rootResponse.ok) {
      throw new Error(`Root document returned ${rootResponse.status}.`);
    }
    const contentType = rootResponse.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new Error('Root document is not HTML.');
    }
    const rootHtml = await rootResponse.clone().text();
    if (rootDocumentRelease(rootHtml) !== releaseId) {
      throw new Error('Root document release does not match service worker.');
    }

    await cache.put(rootRequest, rootResponse.clone());
    await Promise.all(
      assetUrls.map(async (assetUrl) => {
        const request = new Request(new URL(assetUrl, origin), {
          cache: 'reload',
          credentials: 'same-origin',
        });
        const response = await fetcher(request);
        if (!response.ok) {
          throw new Error(`${assetUrl} returned ${response.status}.`);
        }
        await cache.put(request, response);
      }),
    );
    return cacheName;
  } catch (error) {
    await cacheStorage.delete(cacheName);
    throw error;
  }
}

export async function cleanupObsoleteRouteRunnerCaches(
  cacheStorage: CacheStorageLike,
  currentCacheName: string,
): Promise<void> {
  const cacheNames = await cacheStorage.keys();
  await Promise.all(
    cacheNames
      .filter(
        (cacheName) =>
          cacheName.startsWith(ROUTERUNNER_CACHE_PREFIX) &&
          cacheName !== currentCacheName,
      )
      .map((cacheName) => cacheStorage.delete(cacheName)),
  );
}
