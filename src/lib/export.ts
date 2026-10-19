/** Xuất kết quả ra CSV và Excel (.xlsx) ở phía trình duyệt. */
import {
  CONFIDENCE_LABELS,
  DATE_SOURCE_INFO,
  REGION_LABELS,
  REJECT_REASON_LABELS,
  matchSourceLabel,
} from './labels';
import { removeDiacritics } from './query-builder';
import { sourceLabel } from './source-report';
import type { ArticleResult, RejectedItem } from './types';

const ARTICLE_HEADERS = [
  'STT', 'Ngày đăng', 'Nguồn ngày', 'Độ tin cậy', 'Tiêu đề', 'Báo', 'Domain', 'Phạm vi',
  'Khớp theo', 'Biến thể khớp', 'Từ phụ khớp', 'Tìm qua', 'Đoạn trích', 'Link',
  // Chi tiết SEO của bài
  'Tiêu đề SEO', 'Mô tả (meta description)', 'Ảnh đại diện', 'Tác giả', 'Chuyên mục', 'Từ khoá SEO', 'Canonical',
  'Ngày cập nhật', 'Số từ',
];

/** Các cột SEO, cùng thứ tự với ARTICLE_HEADERS */
function seoCells(a: ArticleResult): (string | number)[] {
  const seo = a.seo;
  if (!seo) return ['', '', '', '', '', '', '', '', ''];
  return [
    seo.title,
    seo.description ?? seo.ogDescription ?? '',
    seo.image ?? '',
    seo.author ?? '',
    seo.section ?? '',
    seo.keywords.join(', '),
    seo.canonical ?? '',
    seo.modified ?? '',
    seo.wordCount,
  ];
}

/** "3/5: chuyến, thăm, ABC" — số từ phụ (hoặc từ đã nhập, khi tìm liên quan) có trong bài */
function optionalSummary(a: ArticleResult): string {
  if (!a.optionalMatch) return '';
  const { found, total } = a.optionalMatch;
  return `${found.length}/${total}${found.length ? `: ${found.join(', ')}` : ''}`;
}

function dateInfo(a: ArticleResult) {
  if (!a.date) return { source: 'Không xác định', confidence: '' };
  const info = DATE_SOURCE_INFO[a.date.source];
  return { source: info.label, confidence: CONFIDENCE_LABELS[info.confidence] };
}

/** Chặn chèn công thức khi mở CSV bằng Excel (ô bắt đầu bằng = + - @) */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(articles: ArticleResult[]): string {
  const rows = articles.map((a, i) => {
    const { source, confidence } = dateInfo(a);
    // Ngày dạng ISO (YYYY-MM-DD) để Excel ở mọi locale đều hiểu đúng
    return [
      i + 1, a.date?.date ?? '', source, confidence, a.title, a.sourceName ?? '', a.domain,
      REGION_LABELS[a.region], matchSourceLabel(a.matchedLanguage), a.matchedVariant, optionalSummary(a),
      sourceLabel(a.foundLanguage, a.foundVia), a.snippet, a.url, ...seoCells(a),
    ];
  });
  // BOM để Excel nhận đúng UTF-8 tiếng Việt
  return `﻿${[ARTICLE_HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

export async function toXlsx(articles: ArticleResult[], rejected: RejectedItem[]): Promise<Blob> {
  // Nạp exceljs (~1 MB) chỉ khi người dùng bấm xuất
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();

  const wrap = { wrapText: true, vertical: 'top' } as const;
  const sheet = workbook.addWorksheet('Kết quả', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Ngày đăng', key: 'date', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Nguồn ngày', key: 'dateSource', width: 24 },
    { header: 'Độ tin cậy', key: 'confidence', width: 18 },
    { header: 'Tiêu đề', key: 'title', width: 60, style: { alignment: wrap } },
    { header: 'Báo', key: 'source', width: 20 },
    { header: 'Domain', key: 'domain', width: 24 },
    { header: 'Phạm vi', key: 'region', width: 12 },
    { header: 'Khớp theo', key: 'matchSource', width: 24 },
    { header: 'Biến thể khớp', key: 'variant', width: 24 },
    { header: 'Từ phụ khớp', key: 'optional', width: 28, style: { alignment: wrap } },
    { header: 'Tìm qua', key: 'engine', width: 22 },
    { header: 'Đoạn trích', key: 'snippet', width: 80, style: { alignment: wrap } },
    { header: 'Link', key: 'url', width: 50 },
    { header: 'Tiêu đề SEO', key: 'seoTitle', width: 50, style: { alignment: wrap } },
    { header: 'Mô tả (meta description)', key: 'seoDescription', width: 60, style: { alignment: wrap } },
    { header: 'Ảnh đại diện', key: 'seoImage', width: 40 },
    { header: 'Tác giả', key: 'seoAuthor', width: 22 },
    { header: 'Chuyên mục', key: 'seoSection', width: 18 },
    { header: 'Từ khoá SEO', key: 'seoKeywords', width: 40, style: { alignment: wrap } },
    { header: 'Canonical', key: 'seoCanonical', width: 50 },
    { header: 'Ngày cập nhật', key: 'seoModified', width: 14 },
    { header: 'Số từ', key: 'seoWords', width: 8 },
  ];
  articles.forEach((a, i) => {
    const { source, confidence } = dateInfo(a);
    sheet.addRow({
      stt: i + 1,
      date: a.date ? new Date(`${a.date.date}T00:00:00Z`) : 'Không rõ',
      dateSource: source,
      confidence,
      title: a.title,
      source: a.sourceName ?? '',
      domain: a.domain,
      region: REGION_LABELS[a.region],
      matchSource: matchSourceLabel(a.matchedLanguage),
      variant: a.matchedVariant,
      optional: optionalSummary(a),
      engine: sourceLabel(a.foundLanguage, a.foundVia),
      snippet: a.snippet,
      url: { text: a.url, hyperlink: a.url },
      ...Object.fromEntries(
        ['seoTitle', 'seoDescription', 'seoImage', 'seoAuthor', 'seoSection', 'seoKeywords', 'seoCanonical', 'seoModified', 'seoWords'].map(
          (key, i) => [key, seoCells(a)[i]],
        ),
      ),
    });
  });
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: 'W1' };

  const rejectedSheet = workbook.addWorksheet('Bị loại', { views: [{ state: 'frozen', ySplit: 1 }] });
  rejectedSheet.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Lý do', key: 'reason', width: 26 },
    { header: 'Chi tiết', key: 'detail', width: 60, style: { alignment: wrap } },
    { header: 'Tiêu đề', key: 'title', width: 50, style: { alignment: wrap } },
    { header: 'Domain', key: 'domain', width: 24 },
    { header: 'Tìm qua', key: 'source', width: 22 },
    { header: 'Link', key: 'url', width: 50 },
  ];
  rejected.forEach((r, i) =>
    rejectedSheet.addRow({
      stt: i + 1,
      reason: REJECT_REASON_LABELS[r.reason],
      detail: r.detail,
      title: r.title,
      domain: r.domain,
      source: sourceLabel(r.foundLanguage, r.foundVia),
      url: { text: r.url, hyperlink: r.url },
    }),
  );
  rejectedSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportFileName(query: string, extension: 'csv' | 'xlsx', now = new Date()): string {
  const slug = removeDiacritics(query).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ket-qua';
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `bai-viet-${slug}-${stamp}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
