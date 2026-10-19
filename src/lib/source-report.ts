/** Câu giải thích cho từng dòng báo cáo nguồn (dùng chung cho bảng tiến trình và file xuất) */
import { engineLabel, languageLabel } from './labels';
import type { SearchEngine } from './search/types';
import type { SourceReport } from './types';

export type NoteTone = 'ok' | 'warn' | 'bad' | 'muted';

/** "Tiếng Nga · Yandex" */
export function sourceLabel(language: string, engine: SearchEngine): string {
  return `${languageLabel(language)} · ${engineLabel(engine)}`;
}

/** Số bài của nguồn còn đang chờ kiểm tra */
export function pendingCount(r: SourceReport): number {
  return Math.max(0, r.returned - r.accepted - r.rejected - r.duplicates);
}

/**
 * Ghi chú cho người dùng: đủ số kết quả chưa, nếu thiếu thì vì sao.
 * `finished`: cả lượt tìm đã xong (không còn bài nào đang kiểm tra).
 */
export function sourceNote(r: SourceReport, finished: boolean): { tone: NoteTone; text: string } {
  const engine = engineLabel(r.engine);
  switch (r.status) {
    case 'untranslated':
      return { tone: 'warn', text: 'Không dịch được từ khoá sang ngôn ngữ này nên không tìm.' };
    case 'waiting':
      return { tone: 'muted', text: 'Chờ tới lượt.' };
    case 'searching':
      return { tone: 'muted', text: 'Đang tìm…' };
    case 'stopped':
      if (r.returned === 0) return { tone: 'muted', text: 'Đã dừng trước khi tìm nguồn này.' };
      break;
    case 'failed':
      return { tone: 'bad', text: `Lỗi khi tìm${r.returned ? ` (đã lấy ${r.returned} kết quả)` : ''}: ${r.error ?? 'không rõ'}` };
  }
  if (r.returned === 0) {
    return { tone: 'warn', text: `${engine} không có kết quả nào cho truy vấn này trong khoảng ngày đã chọn.` };
  }
  const pending = pendingCount(r);
  if (pending > 0 && !finished) return { tone: 'muted', text: `Đang kiểm tra ${pending} bài…` };
  const valid = r.accepted ? `${r.accepted} bài hợp lệ` : 'không bài nào hợp lệ (xem lý do ở tab Bị loại)';
  if (r.status === 'stopped') return { tone: 'warn', text: `Đã dừng giữa chừng sau ${r.returned} kết quả; ${valid}.` };
  if (r.returned < r.requested) {
    const why = r.exhausted ? `${engine} không còn kết quả nào khác` : `${engine} trả ít hơn số yêu cầu`;
    return { tone: 'warn', text: `Chỉ có ${r.returned}/${r.requested} kết quả: ${why}; ${valid}.` };
  }
  return { tone: r.accepted ? 'ok' : 'warn', text: `Đủ ${r.requested} kết quả; ${valid}.` };
}
