'use client';

import { DatePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { formatDate } from '@/lib/labels';
import { SEARCH_LIMITS } from '@/lib/search-params';
import { ClientOnly } from './ClientOnly';

interface Props {
  from: string;
  to: string;
  /** Hôm nay theo giờ trình duyệt, YYYY-MM-DD */
  today: string;
  disabled?: boolean;
  onChange: (from: string, to: string) => void;
}

const ISO = 'YYYY-MM-DD';
const DISPLAY = 'DD/MM/YYYY';
const toIso = (d: Dayjs | null) => (d ? d.format(ISO) : '');

/** Ô ngày tĩnh hiển thị khi prerender, thay cho DatePicker của antd (xem ClientOnly) */
function StaticDateBox({ value }: { value: string }) {
  return (
    <span className="flex h-10 items-center rounded-lg border border-line bg-surface px-3 text-sm tabular-nums">
      {value ? formatDate(value) : 'dd/mm/yyyy'}
    </span>
  );
}

/** Hai ô chọn ngày (lịch một tháng, vừa màn hình điện thoại) thay cho ô chọn khoảng hai tháng của antd */
export function DateRangePicker({ from, to, today, disabled, onChange }: Props) {
  const min = dayjs(SEARCH_LIMITS.minDate);
  const max = dayjs(today);
  const valid = Boolean(from && to && from <= to);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Enter trong ô ngày chỉ để xác nhận ngày, không gửi form tìm kiếm */}
      <div className="flex items-center gap-2" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Từ ngày</span>
          <ClientOnly fallback={<StaticDateBox value={from} />}>
            <DatePicker
              value={from ? dayjs(from) : null}
              format={DISPLAY}
              placeholder="dd/mm/yyyy"
              allowClear={false}
              disabled={disabled}
              disabledDate={(d) => d.isBefore(min, 'day') || d.isAfter(to ? dayjs(to) : max, 'day')}
              onChange={(d) => onChange(toIso(d), to)}
              className="w-full"
            />
          </ClientOnly>
        </label>
        <span className="mt-5 text-muted" aria-hidden>
          →
        </span>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Đến ngày</span>
          <ClientOnly fallback={<StaticDateBox value={to} />}>
            <DatePicker
              value={to ? dayjs(to) : null}
              format={DISPLAY}
              placeholder="dd/mm/yyyy"
              allowClear={false}
              disabled={disabled}
              disabledDate={(d) => d.isAfter(max, 'day') || d.isBefore(from ? dayjs(from) : min, 'day')}
              onChange={(d) => onChange(from, toIso(d))}
              className="w-full"
            />
          </ClientOnly>
        </label>
      </div>

      <p className={`text-xs ${valid ? 'text-muted' : 'text-bad'}`} aria-live="polite">
        {valid
          ? `Tìm bài đăng từ ${formatDate(from)} đến ${formatDate(to)}`
          : 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.'}
      </p>
    </div>
  );
}
