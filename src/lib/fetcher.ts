/**
 * Tải trang HTML: tôn trọng robots.txt, timeout, User-Agent rõ ràng, giới hạn dung lượng, tự nhận charset.
 */
import robotsParser from 'robots-parser';
import { createCache } from './cache';

/** Tên bot dùng để đối chiếu luật trong robots.txt */
export const BOT_NAME = 'ArticleFinderBot';
export const USER_AGENT = process.env.FETCH_USER_AGENT?.trim() || `Mozilla/5.0 (compatible; ${BOT_NAME}/0.1)`;
export const FETCH_TIMEOUT_MS = 10_000;

const ROBOTS_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

export type FetchErrorKind = 'robots' | 'http' | 'timeout' | 'network' | 'not_html' | 'blocked' | 'aborted';

export class FetchError extends Error {
  readonly kind: FetchErrorKind;

  constructor(kind: FetchErrorKind, message: string) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;
  }
}

export interface FetchedHtml {
  url: string;
  /** URL thật sau khi đi theo chuyển hướng */
  finalUrl: string;
  status: number;
  html: string;
}

type Robot = ReturnType<typeof robotsParser>;

const robotsCache = createCache<{ status: number; body: string }>('robots', { ttlMs: 24 * 3_600_000 });
const robotsInFlight = new Map<string, Promise<Robot | null>>();

async function loadRobots(origin: string): Promise<Robot | null> {
  const robotsUrl = `${origin}/robots.txt`;
  let entry = await robotsCache.get(origin);
  if (!entry) {
    try {
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      });
      entry = { status: res.status, body: res.ok ? (await res.text()).slice(0, 512_000) : '' };
    } catch {
      // Không tải được robots.txt → coi như không có luật (giống Scrapy / đa số crawler)
      entry = { status: 0, body: '' };
    }
    await robotsCache.set(origin, entry);
  }
  // Chỉ áp dụng luật khi robots.txt tải được (2xx); 4xx/5xx/lỗi mạng → cho phép
  return entry.status >= 200 && entry.status < 300 ? robotsParser(robotsUrl, entry.body) : null;
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  const { origin } = new URL(url);
  let pending = robotsInFlight.get(origin);
  if (!pending) {
    pending = loadRobots(origin).finally(() => robotsInFlight.delete(origin));
    robotsInFlight.set(origin, pending);
  }
  const robot = await pending;
  return robot ? robot.isAllowed(url, BOT_NAME) !== false : true;
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks);
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const charset =
    /charset=["']?\s*([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head)?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function networkErrorCode(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause;
  return cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
}

export async function fetchHtml(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<FetchedHtml> {
  const { signal, timeoutMs = FETCH_TIMEOUT_MS } = options;
  if (!(await isAllowedByRobots(url))) {
    throw new FetchError('robots', 'robots.txt không cho phép tải trang này');
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'vi,en;q=0.8',
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new FetchError('http', `HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !/html|xml/i.test(contentType)) {
      await res.body?.cancel().catch(() => {});
      throw new FetchError('not_html', `Không phải trang HTML (${contentType.split(';')[0].trim()})`);
    }
    const bytes = await readLimited(res, MAX_HTML_BYTES);
    return { url, finalUrl: res.url || url, status: res.status, html: decodeHtml(bytes, contentType) };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (signal?.aborted) throw new FetchError('aborted', 'Đã dừng');
    if (timeout.aborted) throw new FetchError('timeout', `Quá thời gian ${timeoutMs / 1000}s`);
    throw new FetchError('network', `Lỗi mạng: ${networkErrorCode(err)}`);
  }
}
