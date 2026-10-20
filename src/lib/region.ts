/**
 * Phân loại URL "Trong nước" / "Ngoài nước" theo src/config/sources.ts.
 * Dùng chung cho cả hai bước lọc: URL trên kết quả tìm kiếm và URL thật sau khi tải (sau chuyển hướng).
 */
import {
  DOMESTIC_SOURCES,
  FOREIGN_VIETNAMESE_SOURCES,
  SOCIAL_PLATFORMS,
  type SourceEntry,
} from '@/config/sources';
import type { Region } from './types';

interface CompiledSource {
  host: string;
  path: string;
  name: string;
}

function compile(entries: SourceEntry[]): CompiledSource[] {
  return entries.map(({ match, name }) => {
    const slash = match.indexOf('/');
    const host = (slash === -1 ? match : match.slice(0, slash)).toLowerCase().replace(/^www\./, '');
    const path = slash === -1 ? '' : match.slice(slash).toLowerCase().replace(/\/+$/, '');
    return { host, path, name };
  });
}

const DOMESTIC = compile(DOMESTIC_SOURCES);
const FOREIGN = compile(FOREIGN_VIETNAMESE_SOURCES);
const SOCIAL = compile(SOCIAL_PLATFORMS);

function parse(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: u.pathname.toLowerCase() };
  } catch {
    return null;
  }
}

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const pathMatches = (path: string, prefix: string) => !prefix || path === prefix || path.startsWith(`${prefix}/`);

function findIn(list: CompiledSource[], url: { host: string; path: string }): CompiledSource | undefined {
  return list.find((s) => hostMatches(url.host, s.host) && pathMatches(url.path, s.path));
}

/** Hostname viết thường, bỏ "www." */
export function hostnameOf(url: string): string {
  return parse(url)?.host ?? '';
}

export function classifyRegion(url: string): Region {
  const u = parse(url);
  if (!u) return 'foreign';
  if (findIn(FOREIGN, u)) return 'foreign';
  if (u.host.endsWith('.vn') || findIn(DOMESTIC, u)) return 'domestic';
  return 'foreign';
}

/** Tên báo theo cấu hình (null nếu không có trong danh sách) */
export function sourceNameOf(url: string): string | null {
  const u = parse(url);
  return u ? (findIn(FOREIGN, u) ?? findIn(DOMESTIC, u))?.name ?? null : null;
}

/** Báo nước ngoài viết tiếng Việt (BBC Tiếng Việt, VOA…): được nhận khi tìm "Ngoài nước" dù bài viết bằng tiếng Việt */
export function isForeignVietnameseSource(url: string): boolean {
  const u = parse(url);
  return !!u && !!findIn(FOREIGN, u);
}

/** Tên mạng xã hội / nền tảng video của URL (null nếu không phải) */
export function socialPlatformOf(url: string): string | null {
  const u = parse(url);
  return u ? findIn(SOCIAL, u)?.name ?? null : null;
}

/** Trang chủ của một trang web (không có đường dẫn, không có tham số): không phải bài viết */
export function isHomePage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, '') === '' && !u.search;
  } catch {
    return false;
  }
}

/** Domain báo VN không đuôi .vn (cần loại riêng khi tìm "Ngoài nước") */
export function domesticDomainsOutsideVn(): string[] {
  return [...new Set(DOMESTIC.filter((s) => !s.host.endsWith('.vn')).map((s) => s.host))];
}
