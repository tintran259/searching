/** Nhãn hiển thị tiếng Việt, dùng chung cho UI, file xuất và thông báo của pipeline. */
import { LOCAL_ENGINES, SEARCH_LANGUAGES } from '@/config/languages';
import type { SearchEngine } from './search/types';
import {
  SOURCE_LANGUAGE,
  type ConditionStatus,
  type DateSource,
  type EvidenceLocation,
  type PublisherProfile,
  type Region,
  type RejectReason,
} from './types';

export function languageLabel(code: string): string {
  if (code === SOURCE_LANGUAGE) return 'Tiếng Việt';
  return SEARCH_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** Bài khớp nhờ từ khoá gốc (kể cả biến thể không dấu / đảo thứ tự) hay nhờ bản dịch */
export function matchSourceLabel(language: string): string {
  return language === SOURCE_LANGUAGE ? 'Từ khoá gốc' : `Bản dịch ${languageLabel(language).replace(/^Tiếng /, 'tiếng ')}`;
}

export const REGION_LABELS: Record<Region, string> = {
  domestic: 'Trong nước',
  foreign: 'Ngoài nước',
};

export type Confidence = 'high' | 'medium' | 'low';

export const DATE_SOURCE_INFO: Record<DateSource, { label: string; confidence: Confidence }> = {
  meta: { label: 'Meta tag', confidence: 'high' },
  jsonld: { label: 'JSON-LD', confidence: 'high' },
  time: { label: 'Thẻ <time>', confidence: 'medium' },
  url: { label: 'URL', confidence: 'medium' },
  wayback: { label: 'Wayback (ước lượng)', confidence: 'low' },
  snippet: { label: 'Snippet tìm kiếm (ước lượng)', confidence: 'low' },
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'Tin cậy cao',
  medium: 'Tin cậy trung bình',
  low: 'Ước lượng',
};

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  region: 'Sai phạm vi',
  non_article: 'Không phải bài viết',
  robots: 'robots.txt chặn',
  fetch_error: 'Tải lỗi',
  no_match: 'Không khớp cụm',
  outside_main: 'Chỉ có ngoài nội dung chính',
  out_of_range: 'Ngoài khoảng ngày',
  no_date: 'Không rõ ngày đăng',
  excluded: 'Có cụm loại trừ',
  denied_domain: 'Domain bị loại',
  source_unverified: 'Chưa rõ quốc gia nguồn',
  republished: 'Đăng lại từ báo VN',
};

export const CONDITION_LABELS: Record<ConditionStatus, string> = {
  matched_exact: 'Có nguyên văn',
  matched_alias: 'Có cách viết khác',
  matched_expansion: 'Khớp theo gợi ý',
  not_matched: 'Không có',
  unverified: 'Chỉ thấy trên Google',
};

export const EVIDENCE_LABELS: Record<EvidenceLocation, string> = {
  title: 'tiêu đề',
  description: 'mô tả',
  main: 'nội dung',
  snippet: 'tiêu đề / đoạn trích Google',
};

export const ORIGIN_LABELS: Record<PublisherProfile['origin'], string> = {
  original: 'Bài gốc',
  republished: 'Đăng lại từ báo Việt Nam',
  unknown: 'Chưa rõ nguồn gốc',
};

/** Tên quốc gia theo mã ISO (Intl), vd "us" → "Hoa Kỳ" */
export function countryLabel(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(['vi'], { type: 'region' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** "2019-05-12" → "12/05/2019" */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/** Tên hiển thị của công cụ tìm kiếm */
export function engineLabel(engine: SearchEngine): string {
  return engine === 'google' ? 'Google' : LOCAL_ENGINES[engine].name;
}
