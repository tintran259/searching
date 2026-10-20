/**
 * Khoảng ngày tìm kiếm (YYYY-MM-DD). Search engine chỉ trả khoảng N×10 kết quả mỗi truy vấn,
 * nên khoảng ngày được chia theo từng năm dương lịch và tìm từ năm xa nhất.
 * Dùng được ở cả server và client.
 */

export interface YearChunk {
  year: number;
  /** YYYY-MM-DD */
  start: string;
  end: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Chia [from, to] thành từng đoạn theo năm; năm đầu/cuối giữ đúng ngày bắt đầu/kết thúc */
export function splitByYear(from: string, to: string): YearChunk[] {
  const firstYear = Number(from.slice(0, 4));
  const lastYear = Number(to.slice(0, 4));
  const chunks: YearChunk[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    chunks.push({
      year,
      start: year === firstYear ? from : `${year}-01-01`,
      end: year === lastYear ? to : `${year}-12-31`,
    });
  }
  return chunks;
}

/** Hôm nay theo múi giờ `timeZone` (bỏ trống: múi giờ của máy đang chạy, vd trình duyệt), dạng YYYY-MM-DD */
export function todayInTimeZone(timeZone?: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD */
export function todayInVietnam(now = new Date()): string {
  return todayInTimeZone('Asia/Ho_Chi_Minh', now);
}

/**
 * Ngày "muộn nhất" đang có trên Trái Đất (UTC+14), dạng YYYY-MM-DD.
 * Server dùng làm giới hạn trên để không từ chối "hôm nay" theo giờ trình duyệt ở bất kỳ múi giờ nào.
 */
export function latestTodayAnywhere(now = new Date()): string {
  return todayInTimeZone('Etc/GMT-14', now);
}

/** Lùi/tiến một ngày YYYY-MM-DD theo năm, tháng, ngày (ngày 31 không có trong tháng đích thì lấy ngày cuối tháng) */
export function shiftDate(iso: string, { years = 0, months = 0, days = 0 }: { years?: number; months?: number; days?: number }): string {
  const [y, m, d] = iso.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) + years * 12 + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month, Math.min(d, lastDay) + days));
  return date.toISOString().slice(0, 10);
}
