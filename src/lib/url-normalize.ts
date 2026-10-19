/**
 * Chuẩn hoá URL.
 * - `normalizeUrl`: khoá để gộp trùng — bỏ http/https, www, tham số theo dõi (utm_*, fbclid…),
 *   dấu "/" cuối, #hash và các dạng AMP; sắp xếp tham số còn lại.
 * - `cleanUrl`: URL sạch để tải và hiển thị — bỏ tham số theo dõi, #hash, bóc AMP cache; giữ nguyên host.
 */

const TRACKING_PARAM =
  /^(?:utm_\w+|fbclid|gclid|gclsrc|dclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl|igshid|gidzl|zarsrc|ocid|cmpid|ref_src|_hsenc|_hsmi|mkt_tok)$/i;

function isAmpParam(key: string, value: string): boolean {
  const k = key.toLowerCase();
  return (
    k === 'amp' ||
    k === '_amp' ||
    k === 'usqp' ||
    k.startsWith('amp_') ||
    k === '__amp_source_origin' ||
    (k === 'outputtype' && value.toLowerCase() === 'amp')
  );
}

/** Bóc URL gốc từ Google AMP cache (*.cdn.ampproject.org/c/s/…) và AMP viewer (google.com/amp/s/…) */
function unwrapAmpCache(url: URL): URL {
  let rest: string | null = null;
  if (url.hostname.endsWith('.cdn.ampproject.org')) {
    rest = url.pathname.replace(/^\/[a-z]\//, '');
  } else if (/^(?:www\.)?google\.[a-z.]+$/.test(url.hostname) && url.pathname.startsWith('/amp/')) {
    rest = url.pathname.slice('/amp/'.length);
  }
  if (rest === null) return url;
  const secure = rest.startsWith('s/');
  try {
    return new URL(`${secure ? 'https' : 'http'}://${secure ? rest.slice(2) : rest}${url.search}`);
  } catch {
    return url;
  }
}

function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? unwrapAmpCache(url) : null;
  } catch {
    return null;
  }
}

function keptParams(url: URL, dropAmp: boolean): [string, string][] {
  return [...url.searchParams].filter(([k, v]) => !TRACKING_PARAM.test(k) && !(dropAmp && isAmpParam(k, v)));
}

const stripHostPrefix = (hostname: string) => hostname.toLowerCase().replace(/^(?:www\d*|m|mobile|amp)\./, '');

/** Host bỏ tiền tố www/m/amp — dùng để so hai URL có cùng trang web không. */
export function siteOf(input: string): string {
  const url = parseHttpUrl(input);
  return url ? stripHostPrefix(url.hostname) : '';
}

export function normalizeUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (!url) return input.trim().toLowerCase();
  const port = url.port ? `:${url.port}` : '';
  const path = url.pathname
    .replace(/%[0-9a-f]{2}/gi, (s) => s.toUpperCase())
    .replace(/\/amp\/?$/i, '') // /bai-viet/amp
    .replace(/^\/amp(?=\/)/i, '') // /amp/bai-viet
    .replace(/\.amp(?=\.html?$)/i, '') // bai-viet.amp.html
    .replace(/\/+$/, '');
  const params = keptParams(url, true).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  return `${stripHostPrefix(url.hostname)}${port}${path}${query}`;
}

export function cleanUrl(input: string): string {
  const url = parseHttpUrl(input);
  if (!url) return input.trim();
  const params = keptParams(url, false);
  if (params.length !== [...url.searchParams].length) {
    url.search = params.length ? new URLSearchParams(params).toString() : '';
  }
  url.hash = '';
  return url.href;
}
