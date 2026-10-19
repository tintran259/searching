'use client';

import { Select } from 'antd';
import { useState, type FormEvent } from 'react';
import { LOCAL_ENGINES, SEARCH_LANGUAGES } from '@/config/languages';
import { SEARCH_LIMITS, defaultFromDate, parseSearchParams } from '@/lib/search-params';
import type { SearchQuota } from '@/lib/search/types';
import type { Region, SearchParams } from '@/lib/types';
import { ClientOnly } from './ClientOnly';
import { DateRangePicker } from './DateRangePicker';
import { AlertIcon, CheckIcon, ChevronDownIcon, SearchIcon, StopIcon } from './icons';
import { LanguagePicker } from './LanguagePicker';
import { QueryInput } from './QueryInput';

interface Props {
  /** Hôm nay (giờ Việt Nam), YYYY-MM-DD */
  today: string;
  running: boolean;
  quota: SearchQuota | null;
  onSearch: (params: SearchParams) => void;
  onStop: () => void;
}

const REGIONS: { value: Region; label: string; hint: string }[] = [
  { value: 'domestic', label: 'Trong nước', hint: 'Báo Việt Nam: tên miền .vn, VnExpress, Báo Mới…' },
  {
    value: 'foreign',
    label: 'Ngoài nước',
    hint: 'Báo quốc tế, tìm bằng các ngôn ngữ / nước bạn chọn bên dưới (từ khoá được tự dịch).',
  },
];

export function SearchForm({ today, running, quota, onSearch, onStop }: Props) {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<Region>('domestic');
  const [fromDate, setFromDate] = useState(() => defaultFromDate(today));
  const [toDate, setToDate] = useState(today);
  const [pages, setPages] = useState<number>(SEARCH_LIMITS.defaultPagesPerSource);
  // Ngoài nước: không chọn sẵn ngôn ngữ nào, người dùng tự chọn
  const [languages, setLanguages] = useState<string[]>([]);
  const [localEngines, setLocalEngines] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ngôn ngữ dịch và công cụ địa phương chỉ dùng khi tìm Ngoài nước; Trong nước chỉ tìm tiếng Việt
  const foreign = region === 'foreign';
  const activeLanguages = foreign ? languages : [];
  const localTargets = foreign && localEngines
    ? SEARCH_LANGUAGES.filter((l) => l.localEngine && languages.includes(l.code)).map((l) => LOCAL_ENGINES[l.localEngine!])
    : [];
  // Mỗi nguồn (tiếng Việt, từng ngôn ngữ, từng công cụ địa phương) lấy tối đa `pages` × 10 kết quả, mỗi lượt 10 kết quả
  // Trong nước: chỉ tiếng Việt. Ngoài nước: chỉ các ngôn ngữ đã chọn (không tìm bằng tiếng Việt)
  const sources = (foreign ? 0 : 1) + activeLanguages.length + localTargets.length;
  const missingLanguages = foreign && languages.length === 0;
  const maxCalls = sources * pages;
  const searchesLeft = quota?.searchesLeft ?? null;
  const sourcesText = [
    ...(foreign ? [] : ['tiếng Việt']),
    ...(activeLanguages.length ? [`${activeLanguages.length} ngôn ngữ`] : []),
    ...(localTargets.length ? [localTargets.map((e) => e.name).join(', ')] : []),
  ].join(' + ');
  // Mỗi nguồn tốn ít nhất 1 lượt → chắc chắn vượt thì cảnh báo; chỉ mức tối đa vượt thì nhắc nhẹ
  const willExceedQuota = searchesLeft !== null && sources > searchesLeft && !missingLanguages;
  const mayExceedQuota = searchesLeft !== null && !willExceedQuota && maxCalls > searchesLeft;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseSearchParams(
      new URLSearchParams({
        q: query,
        region,
        from: fromDate,
        to: toDate,
        pages: String(pages),
        langs: activeLanguages.join(','),
        local: localEngines ? '1' : '0',
      }),
      today,
    );
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onSearch(parsed.params);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line sm:p-6">
      {/* Từ khoá (đánh dấu phần bắt buộc) + nút tìm */}
      <QueryInput
        value={query}
        onChange={setQuery}
        disabled={running}
        action={
          running ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-surface-muted px-6 text-base font-semibold ring-1 ring-line transition hover:bg-line focus-visible:ring-4 focus-visible:ring-accent/25 focus-visible:outline-none active:scale-[0.98]"
            >
              <StopIcon className="size-5" /> Dừng
            </button>
          ) : (
            <button
              type="submit"
              className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-accent px-7 text-base font-semibold text-accent-fg shadow-card transition hover:bg-accent-hover focus-visible:ring-4 focus-visible:ring-accent/30 focus-visible:outline-none active:scale-[0.98]"
            >
              <SearchIcon className="size-5" /> Tìm bài viết
            </button>
          )
        }
      />

      {/* Phạm vi + thời gian */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <fieldset disabled={running} className="min-w-0">
          <legend className="mb-2 text-sm font-semibold">Phạm vi</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {REGIONS.map((r) => {
              const checked = region === r.value;
              return (
                <label
                  key={r.value}
                  className={`relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 pr-9 transition has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:ring-4 has-focus-visible:ring-accent/20 ${
                    checked ? 'border-accent bg-accent-soft/70' : 'border-line hover:border-muted/40 hover:bg-surface-muted/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="region"
                    value={r.value}
                    checked={checked}
                    onChange={() => setRegion(r.value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-semibold">{r.label}</span>
                  <span className="text-xs leading-relaxed text-pretty text-muted">{r.hint}</span>
                  {checked && <CheckIcon className="absolute top-3 right-3 size-4 text-accent" />}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset disabled={running} className="min-w-0">
          <legend className="mb-2 text-sm font-semibold">Thời gian đăng bài</legend>
          <DateRangePicker
            from={fromDate}
            to={toDate}
            today={today}
            disabled={running}
            onChange={(from, to) => {
              setFromDate(from);
              setToDate(to);
            }}
          />
        </fieldset>
      </div>

      {/* Ngoài nước: chọn ngôn ngữ / nước cần tìm (bắt buộc) và công cụ tìm kiếm địa phương */}
      {foreign && (
        <div className="flex flex-col gap-5 rounded-xl bg-surface-muted/50 p-4 ring-1 ring-line">
          <LanguagePicker value={languages} onChange={setLanguages} disabled={running} />
          {missingLanguages && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
              <AlertIcon className="size-4 shrink-0" />
              Chưa chọn ngôn ngữ nào: hãy chọn ít nhất một ngôn ngữ / nước để tìm báo nước ngoài.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <input
              type="checkbox"
              checked={localEngines}
              onChange={(e) => setLocalEngines(e.target.checked)}
              disabled={running}
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Tìm thêm trên công cụ tìm kiếm của nước đó</span>
              <span className="text-xs leading-relaxed text-pretty text-muted">
                Baidu cho tiếng Trung (giản thể), Yandex cho tiếng Nga, Naver (mục Tin tức) cho tiếng Hàn. Báo các nước này
                nhiều bài không có trên Google. Mỗi công cụ được tính như một nguồn riêng, cũng lấy tối đa {pages * 10} kết
                quả.
              </span>
            </span>
          </label>
        </div>
      )}

      {/* Tuỳ chọn nâng cao: số kết quả mỗi ngôn ngữ */}
      <details className="group rounded-xl bg-surface-muted/50 ring-1 ring-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-surface-muted focus-visible:ring-4 focus-visible:ring-accent/20 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="text-sm font-semibold">Tuỳ chọn nâng cao</span>
            <span className="text-xs text-muted">
              {pages * 10} kết quả mỗi ngôn ngữ
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-6 border-t border-line px-4 py-5">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
            <label htmlFor="max-results" className="shrink-0 pt-2 text-sm font-medium sm:w-48">
              Số kết quả mỗi ngôn ngữ
            </label>
            <ClientOnly
              fallback={
                <span className="flex h-10 w-full shrink-0 items-center rounded-lg border border-line bg-surface px-3 text-sm sm:w-72">
                  Tối đa {pages * 10} kết quả · {pages} lượt tìm
                </span>
              }
            >
              <Select
                id="max-results"
                value={pages}
                onChange={setPages}
                disabled={running}
                className="w-full shrink-0 sm:w-72"
                options={Array.from({ length: SEARCH_LIMITS.maxPagesPerSource }, (_, i) => i + 1).map((n) => ({
                  value: n,
                  label: `Tối đa ${n * 10} kết quả · ${n} lượt tìm`,
                }))}
              />
            </ClientOnly>
            <span className="text-xs leading-relaxed text-pretty text-muted">
              Mỗi ngôn ngữ được tìm riêng và lấy tối đa {pages * 10} kết quả trong khoảng ngày đã chọn. Mỗi lượt tìm trả 10
              kết quả và trừ 1 lượt quota SerpApi (gói miễn phí 250 lượt/tháng), nên {pages * 10} kết quả = tối đa {pages}{' '}
              lượt cho mỗi ngôn ngữ. Ngôn ngữ nào hết kết quả sớm thì dừng sớm, không tốn thêm.
            </span>
          </div>
        </div>
      </details>

      {/* Ước tính lượt tìm */}
      <div className="flex flex-col gap-1 text-xs text-muted">
        {missingLanguages ? (
          <p>Chưa chọn ngôn ngữ nào nên chưa có gì để tìm.</p>
        ) : (
          <p>
            Dự kiến: <strong className="font-semibold text-fg">{sources} nguồn</strong> ({sourcesText}) × tối đa{' '}
            {pages * 10} kết quả ={' '}
            <strong className="font-semibold text-fg tabular-nums">
              tối đa {sources * pages * 10} kết quả, {maxCalls} lượt tìm
            </strong>
            {sources > 1 ? ` (ít nhất ${sources} lượt)` : ''}. Tìm lại cùng nội dung không tốn lượt. Sau khi tìm, bảng
            &ldquo;Báo cáo theo ngôn ngữ&rdquo; cho biết mỗi nguồn tìm được bao nhiêu bài.
          </p>
        )}
        {willExceedQuota && (
          <p className="flex items-center gap-1.5 text-warn">
            <AlertIcon className="size-4 shrink-0" />
            Sẽ vượt số lượt còn lại ({searchesLeft}). Hãy bớt ngôn ngữ hoặc giảm số kết quả mỗi ngôn ngữ.
          </p>
        )}
        {mayExceedQuota && (
          <p>
            Nếu có nhiều kết quả, lượt tìm có thể vượt số lượt còn lại ({searchesLeft}). Bạn có thể bấm Dừng bất cứ lúc
            nào; các bài đã tìm được vẫn được giữ.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad">
          <AlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </form>
  );
}
