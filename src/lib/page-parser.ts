/**
 * Phân tích HTML bằng jsdom: tiêu đề, canonical, ngày đăng (bước 1–4), toàn văn và nội dung chính
 * (Mozilla Readability — bỏ menu/sidebar/footer). Readability thất bại thì dùng toàn văn.
 */
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import { extractDateFromDocument } from './date-extractor';
import type { ExtractedDate } from './types';

export interface ParsedPage {
  /** URL thật của trang (sau chuyển hướng) */
  finalUrl: string;
  canonicalUrl: string | null;
  title: string;
  description: string;
  siteName: string | null;
  /** Nội dung chính; nếu Readability thất bại thì bằng `fullText` */
  mainText: string;
  /** Toàn bộ chữ trong <body>, kể cả menu, sidebar, footer */
  fullText: string;
  usedReadability: boolean;
  /** Ngày đăng đọc từ trang / URL (bước 1–4) */
  date: ExtractedDate | null;
}

const MAX_TEXT_LENGTH = 300_000;
/** Nội dung chính ngắn hơn mức này coi như Readability thất bại */
const MIN_MAIN_TEXT_LENGTH = 140;

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED', 'SELECT', 'HEAD']);
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/**
 * Chữ của một nút DOM. Khác `textContent`: xuống dòng giữa các khối, nên
 * "<li>Nguyễn Văn B</li><li>Trần Văn A</li>" không bị dính thành "Nguyễn Văn BTrần Văn A".
 */
export function textOf(root: Node): string {
  const parts: string[] = [];
  const stack: (Node | string)[] = [root];
  while (stack.length) {
    const item = stack.pop()!;
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (item.nodeType === 3) {
      parts.push((item.nodeValue ?? '').replace(/\s+/g, ' '));
      continue;
    }
    if (item.nodeType !== 1 && item.nodeType !== 9 && item.nodeType !== 11) continue;
    const tag = item.nodeType === 1 ? (item as Element).tagName.toUpperCase() : '';
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'BR') {
      parts.push('\n');
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      parts.push('\n');
      stack.push('\n');
    }
    const children = item.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return parts.join('').replace(/ *\n\s*/g, '\n').replace(/ {2,}/g, ' ').trim();
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

function findCanonical(doc: Document, pageUrl: string): string | null {
  const link = Array.from(doc.querySelectorAll('link[rel][href]')).find((l) =>
    (l.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'),
  );
  const href = link?.getAttribute('href') ?? doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
  if (!href) return null;
  try {
    const canonical = new URL(href, pageUrl);
    if (canonical.protocol !== 'http:' && canonical.protocol !== 'https:') return null;
    // Trang cấu hình sai thường để canonical = trang chủ cho mọi bài → bỏ qua
    const isHome = (u: URL) => u.pathname.replace(/\/+$/, '') === '';
    if (isHome(canonical) && !isHome(new URL(pageUrl))) return null;
    return canonical.href;
  } catch {
    return null;
  }
}

export function parsePage(html: string, url: string, now = new Date()): ParsedPage {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  try {
    const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
    const canonicalUrl = findCanonical(doc, url);
    const title = squash(meta('meta[property="og:title"]') || doc.title || doc.querySelector('h1')?.textContent || '');
    const description = squash(meta('meta[property="og:description"]') || meta('meta[name="description"]'));
    const siteName = meta('meta[property="og:site_name"]') || null;
    const date = extractDateFromDocument(doc, canonicalUrl ? [url, canonicalUrl] : [url], now);
    // Lấy toàn văn trước vì Readability sửa trực tiếp DOM
    const fullText = textOf(doc.body ?? doc.documentElement).slice(0, MAX_TEXT_LENGTH);

    let mainText = '';
    try {
      const article = new Readability<Node>(doc, { serializer: (node) => node }).parse();
      if (article?.content) mainText = textOf(article.content).slice(0, MAX_TEXT_LENGTH);
    } catch {
      // Readability lỗi → dùng toàn văn
    }
    const usedReadability = mainText.length >= MIN_MAIN_TEXT_LENGTH;
    return {
      finalUrl: url,
      canonicalUrl,
      title,
      description,
      siteName,
      mainText: usedReadability ? mainText : fullText,
      fullText,
      usedReadability,
      date,
    };
  } finally {
    dom.window.close();
  }
}
