/**
 * Thông tin SEO của một bài viết, đọc từ thẻ meta, Open Graph, Twitter card và JSON-LD (NewsArticle…).
 * Mỗi trường lấy theo thứ tự ưu tiên: thẻ meta chuẩn → Open Graph / Twitter → JSON-LD.
 */
import { isArticleNode, parseDate, parseJsonLoose, walkJsonLd } from './date-extractor';
import type { ArticleSeo } from './types';

const MAX_KEYWORDS = 20;
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const firstNonEmpty = (...values: (string | null | undefined)[]) => values.map(squash).find(Boolean) ?? null;

/** Giá trị JSON-LD dạng chuỗi, mảng, hoặc đối tượng { name } / { url } → danh sách chuỗi */
function jsonLdStrings(value: unknown, key: 'name' | 'url'): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((v) => jsonLdStrings(v, key));
  if (value && typeof value === 'object') {
    const inner = (value as Record<string, unknown>)[key];
    return typeof inner === 'string' ? [inner] : [];
  }
  return [];
}

/** Node JSON-LD của bài viết (NewsArticle, Article, BlogPosting…) đầu tiên, nếu có */
function articleJsonLd(doc: Document): Record<string, unknown> | null {
  for (const script of doc.querySelectorAll('script')) {
    if (script.getAttribute('type')?.trim().toLowerCase() !== 'application/ld+json') continue;
    const data = parseJsonLoose(script.textContent ?? '');
    for (const node of walkJsonLd(data)) if (isArticleNode(node)) return node;
  }
  return null;
}

/** URL tuyệt đối http(s), bỏ giá trị lạ (data:, javascript:) */
function absoluteUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const isUrl = (s: string) => /^https?:\/\//i.test(s);

export function extractSeo(doc: Document, url: string, canonicalUrl: string | null, wordCount: number): ArticleSeo {
  const meta = (selector: string) => doc.querySelector(selector)?.getAttribute('content') ?? null;
  const metaAll = (selector: string) =>
    Array.from(doc.querySelectorAll(selector)).map((m) => squash(m.getAttribute('content'))).filter(Boolean);
  const ld = articleJsonLd(doc);

  // Tác giả: meta author, article:author (bỏ nếu chỉ là link trang tác giả), rồi JSON-LD author
  const authors = [
    ...metaAll('meta[name="author"]'),
    ...metaAll('meta[property="article:author"]').filter((a) => !isUrl(a)),
    ...jsonLdStrings(ld?.author, 'name'),
  ].map(squash);

  const keywordSources = [
    ...metaAll('meta[name="keywords"]'),
    ...metaAll('meta[name="news_keywords"]'),
    ...metaAll('meta[property="article:tag"]'),
    ...jsonLdStrings(ld?.keywords, 'name'),
  ];
  const seen = new Set<string>();
  const keywords = keywordSources
    .flatMap((k) => k.split(/[,;，、]/))
    .map(squash)
    .filter((k) => {
      const key = k.toLowerCase();
      if (!k || k.length > 80 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_KEYWORDS);

  const modifiedRaw = firstNonEmpty(
    meta('meta[property="article:modified_time"]'),
    meta('meta[property="og:updated_time"]'),
    typeof ld?.dateModified === 'string' ? ld.dateModified : null,
  );

  return {
    title: squash(doc.title),
    ogTitle: firstNonEmpty(meta('meta[property="og:title"]'), meta('meta[name="twitter:title"]')),
    description: firstNonEmpty(meta('meta[name="description"]')),
    ogDescription: firstNonEmpty(meta('meta[property="og:description"]'), meta('meta[name="twitter:description"]')),
    image: absoluteUrl(
      firstNonEmpty(
        meta('meta[property="og:image"]'),
        meta('meta[property="og:image:url"]'),
        meta('meta[name="twitter:image"]'),
        jsonLdStrings(ld?.image, 'url')[0],
      ),
      url,
    ),
    author: [...new Set(authors.filter(Boolean))].join(', ') || null,
    section: firstNonEmpty(meta('meta[property="article:section"]'), jsonLdStrings(ld?.articleSection, 'name')[0]),
    keywords,
    canonical: canonicalUrl,
    language: firstNonEmpty(doc.documentElement.getAttribute('lang'), meta('meta[property="og:locale"]')),
    publisher: firstNonEmpty(meta('meta[property="og:site_name"]'), jsonLdStrings(ld?.publisher, 'name')[0]),
    modified: parseDate(modifiedRaw, 'meta')?.date ?? null,
    robots: firstNonEmpty(meta('meta[name="robots"]')),
    wordCount,
  };
}
