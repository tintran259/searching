'use client';

import { Select } from 'antd';
import { useState, type FormEvent } from 'react';
import { LOCAL_ENGINES, SEARCH_LANGUAGES } from '@/config/languages';
import { DEFAULT_SOCIAL_PLATFORMS, SOCIAL_SEARCH_PLATFORMS, type SocialPlatformId } from '@/config/sources';
import { SEARCH_LIMITS, defaultFromDate, parseSearchParams } from '@/lib/search-params';
import type { SearchQuota } from '@/lib/search/types';
import type { Region, SearchParams, SourcePolicy, SourceType } from '@/lib/types';
import { ClientOnly } from './ClientOnly';
import { DateRangePicker } from './DateRangePicker';
import { KeywordSuggestions } from './KeywordSuggestions';
import { AlertIcon, CheckIcon, ChevronDownIcon, SearchIcon, StopIcon } from './icons';
import { LanguagePicker } from './LanguagePicker';
import { QueryInput } from './QueryInput';

interface Props {
  /** Hôm nay theo giờ trình duyệt, YYYY-MM-DD */
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

const SOURCE_TYPES: { value: SourceType; label: string; hint: string }[] = [
  { value: 'news', label: 'Báo', hint: 'Chỉ báo, trang tin. Bài mạng xã hội bị loại khỏi kết quả.' },
  {
    value: 'social',
    label: 'Mạng xã hội',
    hint: 'Chỉ bài đăng trên các nền tảng chọn bên dưới, có trên Google. Chỉ kiểm tra được tiêu đề và đoạn trích nên nằm ở tab “Chưa xác minh”.',
  },
  { value: 'both', label: 'Cả hai', hint: 'Mỗi ngôn ngữ một truy vấn báo và một truy vấn mạng xã hội, không chiếm chỗ của nhau (gấp đôi số lượt).' },
];

export function SearchForm({ today, running, quota, onSearch, onStop }: Props) {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<Region>('domestic');
  const [sourceTypes, setSourceTypes] = useState<SourceType>('news');
  const [platforms, setPlatforms] = useState<SocialPlatformId[]>(DEFAULT_SOCIAL_PLATFORMS);
  // Chưa tự chọn ngày thì khoảng ngày mặc định đi theo `today` (hôm qua → hôm nay), sang ngày mới tự cập nhật
  const [pickedRange, setPickedRange] = useState<{ from: string; to: string } | null>(null);
  const fromDate = pickedRange?.from ?? defaultFromDate(today);
  const toDate = pickedRange?.to ?? today;
  const [pages, setPages] = useState<number>(SEARCH_LIMITS.defaultPagesPerSource);
  // Ngoài nước: không chọn sẵn ngôn ngữ nào, người dùng tự chọn
  const [languages, setLanguages] = useState<string[]>([]);
  // Baidu / Yandex / Naver tốn lượt mà kết quả thường kém hơn Google: để người dùng tự bật
  const [localEngines, setLocalEngines] = useState(false);
  const [budget, setBudget] = useState<number>(SEARCH_LIMITS.defaultBudget);
  const [excludeText, setExcludeText] = useState('');
  const [allowText, setAllowText] = useState('');
  const [denyText, setDenyText] = useState('');
  const [sourcePolicy, setSourcePolicy] = useState<SourcePolicy>('labeled');
  const [excludeRepublished, setExcludeRepublished] = useState(true);
  // Cách gọi khác chọn từ gợi ý, theo từ khoá chính
  const [expansionPicks, setExpansionPicks] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  // Ngôn ngữ dịch và công cụ địa phương chỉ dùng khi tìm Ngoài nước; Trong nước chỉ tìm tiếng Việt
  const foreign = region === 'foreign';
  const activeLanguages = foreign ? languages : [];
  const wantNews = sourceTypes !== 'social';
  const wantSocial = sourceTypes !== 'news';
  // Baidu / Yandex / Naver chỉ dùng để tìm báo
  const localTargets = foreign && localEngines && wantNews
    ? SEARCH_LANGUAGES.filter((l) => l.localEngine && languages.includes(l.code)).map((l) => LOCAL_ENGINES[l.localEngine!])
    : [];
  // Mỗi nguồn (tiếng Việt, từng ngôn ngữ, từng công cụ địa phương; tìm cả hai thì thêm một nguồn mạng xã hội cho mỗi
  // ngôn ngữ) lấy tối đa `pages` × 10 kết quả, mỗi lượt 10 kết quả.
  // Trong nước: chỉ tiếng Việt. Ngoài nước: chỉ các ngôn ngữ đã chọn (không tìm bằng tiếng Việt)
  const languageSources = (foreign ? 0 : 1) + activeLanguages.length;
  // Mỗi nền tảng mạng xã hội là một nguồn riêng cho mỗi ngôn ngữ
  const sources = (wantNews ? languageSources + localTargets.length : 0) + (wantSocial ? languageSources * platforms.length : 0);
  const missingPlatforms = wantSocial && platforms.length === 0;
  const missingLanguages = foreign && languages.length === 0;
  // Chưa chọn ngôn ngữ (Ngoài nước) hoặc chưa chọn nền tảng (mạng xã hội): chưa có gì để tìm
  const nothingToSearch = missingLanguages || missingPlatforms;
  // Truy vấn chính cần `sources × pages` lượt. Số lượt tìm tối đa không được thấp hơn mức này (nếu không, số kết quả
  // mỗi ngôn ngữ bị cắt ngầm): thấp hơn thì tự nâng lên mức chọn được gần nhất. Phần dư dành cho truy vấn bổ sung.
  // Chọn thêm ngôn ngữ sau khi đã chọn nhiều kết quả: giảm số trang cho vừa trần lượt tìm của một lượt
  const effectivePages = Math.max(1, Math.min(pages, Math.floor(SEARCH_LIMITS.maxBudget / Math.max(1, sources))));
  const mainCalls = sources * effectivePages;
  const effectiveBudget =
    budget >= mainCalls ? budget : (SEARCH_LIMITS.budgetOptions.find((n) => n >= mainCalls) ?? SEARCH_LIMITS.maxBudget);
  const budgetRaised = effectiveBudget !== budget;
  const extraCalls = Math.max(0, effectiveBudget - mainCalls);
  // Truy vấn bổ sung (tối đa 2 lượt mỗi ngôn ngữ thiếu bài) chỉ dùng để tìm báo
  const maxCalls = Math.min(effectiveBudget, mainCalls + (wantNews ? languageSources * 2 : 0));
  // Nhãn số kết quả: ghi luôn tổng lượt của truy vấn chính để khỏi phải tự nhân (vd "4 ngôn ngữ × 2 lượt = 8 lượt")
  const sourceWord = localTargets.length || sourceTypes === 'both' || (wantSocial && platforms.length > 1) ? 'nguồn' : 'ngôn ngữ';
  const pagesLabel = (n: number) =>
    sources > 1
      ? `${n * 10} kết quả mỗi ${sourceWord} · ${sources} ${sourceWord} × ${n} lượt = ${sources * n} lượt`
      : `${n * 10} kết quả · ${n} lượt`;
  const searchesLeft = quota?.searchesLeft ?? null;
  const sourcesText = [
    ...(foreign ? [] : ['tiếng Việt']),
    ...(activeLanguages.length ? [`${activeLanguages.length} ngôn ngữ`] : []),
    ...(localTargets.length ? [localTargets.map((e) => e.name).join(', ')] : []),
  ].join(' + ') +
    (wantSocial
      ? `, ${sourceTypes === 'both' ? 'báo + ' : ''}${platforms.length} nền tảng mạng xã hội (${SOCIAL_SEARCH_PLATFORMS.filter((p) => platforms.includes(p.id))
          .map((p) => p.name)
          .join(', ')})`
      : '');
  // Mỗi nguồn tốn ít nhất 1 lượt → chắc chắn vượt thì cảnh báo; chỉ mức tối đa vượt thì nhắc nhẹ
  const willExceedQuota = searchesLeft !== null && sources > searchesLeft && !nothingToSearch;
  const mayExceedQuota = searchesLeft !== null && !willExceedQuota && maxCalls > searchesLeft;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseSearchParams(
      new URLSearchParams({
        q: query,
        region,
        from: fromDate,
        to: toDate,
        pages: String(effectivePages),
        langs: activeLanguages.join(','),
        local: localEngines ? '1' : '0',
        budget: String(effectiveBudget),
        exclude: excludeText,
        allow: allowText,
        deny: denyText,
        policy: sourcePolicy,
        republished: excludeRepublished ? '1' : '0',
        sources: sourceTypes,
        platforms: platforms.join(','),
        // Từ khoá không còn trong ô thì bị bỏ khi đọc tham số
        expand: JSON.stringify(
          Object.entries(expansionPicks)
            .filter(([, alternatives]) => alternatives.length)
            .map(([term, alternatives]) => ({ term, alternatives })),
        ),
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
              {!nothingToSearch && (
                <span
                  className="rounded-md bg-accent-fg/15 px-1.5 py-0.5 text-xs font-medium tabular-nums"
                  title={`Tối đa ${maxCalls} lượt tìm SerpApi cho lượt này${searchesLeft !== null ? ` · còn ${searchesLeft} lượt trong tháng` : ''}`}
                >
                  ≤ {maxCalls} lượt
                </span>
              )}
            </button>
          )
        }
      />

      {/* Gợi ý cách gọi khác cho từ khoá chính (chức vụ, tên khác…), theo khoảng ngày đang chọn */}
      <KeywordSuggestions
        query={query}
        fromDate={fromDate}
        toDate={toDate}
        disabled={running}
        selected={expansionPicks}
        onChange={setExpansionPicks}
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

          <div className="mt-4 flex flex-col gap-1.5">
            <span id="source-types-label" className="text-sm font-semibold">
              Loại nguồn
            </span>
            <div
              role="radiogroup"
              aria-labelledby="source-types-label"
              className="inline-flex w-full rounded-xl bg-surface-muted p-1 ring-1 ring-line sm:w-auto"
            >
              {SOURCE_TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg px-4 py-1.5 text-sm font-medium whitespace-nowrap transition has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:ring-3 has-focus-visible:ring-accent/30 sm:flex-none ${
                    sourceTypes === t.value ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg'
                  }`}
                >
                  <input
                    type="radio"
                    name="source-types"
                    value={t.value}
                    checked={sourceTypes === t.value}
                    onChange={() => setSourceTypes(t.value)}
                    className="sr-only"
                  />
                  {t.label}
                </label>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-pretty text-muted">{SOURCE_TYPES.find((t) => t.value === sourceTypes)?.hint}</p>
            {wantSocial && (
              <div className="flex flex-col gap-1.5">
                <span id="platforms-label" className="text-xs font-medium">
                  Nền tảng (mỗi nền tảng 1 lượt cho mỗi ngôn ngữ)
                </span>
                <div role="group" aria-labelledby="platforms-label" className="flex flex-wrap gap-1.5">
                  {SOCIAL_SEARCH_PLATFORMS.map((p) => {
                    const checked = platforms.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:ring-3 has-focus-visible:ring-accent/30 ${
                          checked ? 'bg-accent text-accent-fg ring-accent' : 'bg-surface text-fg ring-line hover:bg-line/60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setPlatforms((prev) => (prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]))
                          }
                          className="sr-only"
                        />
                        {checked ? '✓ ' : ''}
                        {p.name}
                      </label>
                    );
                  })}
                </div>
                {missingPlatforms && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
                    <AlertIcon className="size-4 shrink-0" />
                    Chọn ít nhất một nền tảng để tìm mạng xã hội.
                  </p>
                )}
                <p className="text-xs leading-relaxed text-pretty text-muted">
                  Tìm riêng từng nền tảng vì khi gộp chung, Google ưu tiên Facebook và bỏ sót bài của nền tảng khác.
                </p>
              </div>
            )}
          </div>
        </fieldset>

        <fieldset disabled={running} className="min-w-0">
          <legend className="mb-2 text-sm font-semibold">Thời gian đăng bài</legend>
          <DateRangePicker
            from={fromDate}
            to={toDate}
            today={today}
            disabled={running}
            onChange={(from, to) => setPickedRange({ from, to })}
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
          {wantNews && (
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
                  nhiều bài không có trên Google. Mỗi công cụ được tính như một nguồn riêng, cũng lấy tối đa {effectivePages * 10} kết
                  quả.
                </span>
              </span>
            </label>
          )}

          {/* Chính sách nguồn: mặc định nhận mọi domain có đủ nội dung; báo Việt Nam luôn bị loại khi tìm Ngoài nước */}
          <fieldset disabled={running} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Nguồn nước ngoài</legend>
            {(
              [
                ['labeled', 'Nhận mọi trang có nội dung phù hợp', 'Mọi domain (.com, .org, .de…) có đủ từ khoá đều được nhận, trừ báo Việt Nam. App ghi quốc gia của báo nếu xác định được.'],
                ['verified', 'Chỉ nhận báo xác định được quốc gia', 'Chặt hơn: chỉ nhận báo có trong danh sách báo lớn nước ngoài, có tên miền quốc gia (.de, .co.uk, .jp…) hoặc nằm trong “Domain luôn nhận”.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
                <input
                  type="radio"
                  name="source-policy"
                  value={value}
                  checked={sourcePolicy === value}
                  onChange={() => setSourcePolicy(value)}
                  className="mt-0.5 size-4 shrink-0 accent-accent"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm">{label}</span>
                  <span className="text-xs leading-relaxed text-pretty text-muted">{hint}</span>
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
              <input
                type="checkbox"
                checked={excludeRepublished}
                onChange={(e) => setExcludeRepublished(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm">Loại bài đăng lại / dịch lại từ báo Việt Nam</span>
                <span className="text-xs leading-relaxed text-pretty text-muted">
                  Khi có bằng chứng: dòng ghi nguồn “(VNA)”, “Source: VietnamPlus”…, canonical trỏ về báo Việt Nam, hoặc đơn vị
                  xuất bản là báo Việt Nam. Bài chỉ có nội dung giống nhau thì không bị coi là đăng lại.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
      )}

      {/* Tuỳ chọn nâng cao: số kết quả mỗi ngôn ngữ */}
      <details className="group rounded-xl bg-surface-muted/50 ring-1 ring-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-surface-muted focus-visible:ring-4 focus-visible:ring-accent/20 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="text-sm font-semibold">Tuỳ chọn nâng cao</span>
            <span className="text-xs text-muted">
              {effectivePages * 10} kết quả mỗi ngôn ngữ · tối đa {effectiveBudget} lượt tìm
              {excludeText.trim() ? ' · có loại trừ' : ''}
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-6 border-t border-line px-4 py-5">
          <h3 className="-mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Số kết quả và chi phí</h3>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
            <label htmlFor="max-results" className="shrink-0 pt-2 text-sm font-medium sm:w-48">
              Số kết quả mỗi ngôn ngữ
            </label>
            <ClientOnly
              fallback={
                <span className="flex h-10 w-full shrink-0 items-center truncate rounded-lg border border-line bg-surface px-3 text-sm sm:w-96">
                  {pagesLabel(effectivePages)}
                </span>
              }
            >
              <Select
                id="max-results"
                value={effectivePages}
                onChange={setPages}
                disabled={running}
                popupMatchSelectWidth={false}
                className="w-full shrink-0 sm:w-96"
                options={Array.from({ length: SEARCH_LIMITS.maxPagesPerSource }, (_, i) => i + 1).map((n) => ({
                  value: n,
                  label: pagesLabel(n),
                  // Vượt trần số lượt cho một lượt tìm (vd 10 ngôn ngữ × 100 kết quả = 100 lượt)
                  disabled: Math.max(1, sources) * n > SEARCH_LIMITS.maxBudget,
                }))}
              />
            </ClientOnly>
            <span className="text-xs leading-relaxed text-pretty text-muted">
              Mỗi ngôn ngữ được tìm riêng và lấy tối đa {effectivePages * 10} kết quả trong khoảng ngày đã chọn. Mỗi lượt tìm trả 10
              kết quả và trừ 1 lượt quota SerpApi (gói miễn phí 250 lượt/tháng), nên {effectivePages * 10} kết quả = tối đa {effectivePages}{' '}
              lượt cho mỗi ngôn ngữ. Ngôn ngữ nào hết kết quả sớm thì dừng sớm, không tốn thêm.
            </span>
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
            <label htmlFor="budget" className="shrink-0 pt-2 text-sm font-medium sm:w-48">
              Số lượt tìm tối đa
            </label>
            <ClientOnly
              fallback={
                <span className="flex h-10 w-full shrink-0 items-center rounded-lg border border-line bg-surface px-3 text-sm sm:w-72">
                  Tối đa {effectiveBudget} lượt
                </span>
              }
            >
              <Select
                id="budget"
                value={effectiveBudget}
                onChange={setBudget}
                disabled={running}
                className="w-full shrink-0 sm:w-72"
                options={SEARCH_LIMITS.budgetOptions.map((n) => ({
                  value: n,
                  label: n < mainCalls ? `${n} lượt — ít hơn ${mainCalls} lượt cần cho truy vấn chính` : `Tối đa ${n} lượt cho lượt tìm này`,
                  disabled: n < mainCalls,
                }))}
              />
            </ClientOnly>
            <span className="flex flex-col gap-1 text-xs leading-relaxed text-pretty text-muted">
              <span>
                Trần chi phí SerpApi cho cả lượt tìm. Truy vấn chính cần {mainCalls} lượt ({Math.max(1, sources)} nguồn ×{' '}
                {effectivePages} lượt); {extraCalls > 0 ? `còn ${extraCalls} lượt` : 'không còn lượt'} cho truy vấn bổ sung khi ngôn ngữ nào có ít hơn 3 bài
                (cách diễn đạt khác; Trong nước thêm mục Tin tức của Google).
              </span>
              {budgetRaised && (
                <span className="text-warn">
                  Đã tự nâng lên {effectiveBudget} lượt để đủ {effectivePages * 10} kết quả mỗi ngôn ngữ.
                </span>
              )}
            </span>
          </div>

          <h3 className="-mb-2 border-t border-line pt-5 text-xs font-semibold tracking-wide text-muted uppercase">Lọc kết quả</h3>
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
            <label htmlFor="exclude" className="shrink-0 pt-2 text-sm font-medium sm:w-48">
              Loại trừ cụm từ
            </label>
            <input
              id="exclude"
              value={excludeText}
              onChange={(e) => setExcludeText(e.target.value)}
              disabled={running}
              placeholder="vd: bóng đá, xổ số"
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-60 sm:w-72"
            />
            <span className="text-xs leading-relaxed text-pretty text-muted">
              Cách nhau bằng dấu phẩy. Bài có cụm này trong nội dung bị loại; truy vấn gửi Google kèm -&ldquo;cụm&rdquo;. Tìm
              Ngoài nước thì nhập cả bản tiếng nước đó nếu cần.
            </span>
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
            <label htmlFor="allow-domains" className="shrink-0 pt-2 text-sm font-medium sm:w-48">
              Domain luôn nhận
            </label>
            <input
              id="allow-domains"
              value={allowText}
              onChange={(e) => setAllowText(e.target.value)}
              disabled={running}
              placeholder="vd: miragenews.com"
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-60 sm:w-72"
            />
            <span className="text-xs leading-relaxed text-pretty text-muted">
              Coi là nguồn đã xác minh (bỏ qua bước xác minh quốc gia). Vẫn phải có đủ từ khoá và đúng khoảng ngày.
            </span>
          </div>

          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
            <label htmlFor="deny-domains" className="shrink-0 pt-2 text-sm font-medium sm:w-48">
              Domain luôn loại
            </label>
            <input
              id="deny-domains"
              value={denyText}
              onChange={(e) => setDenyText(e.target.value)}
              disabled={running}
              placeholder="vd: example.com, tintuc.com"
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/20 disabled:opacity-60 sm:w-72"
            />
            <span className="text-xs leading-relaxed text-pretty text-muted">Cách nhau bằng dấu phẩy; khớp cả subdomain.</span>
          </div>
        </div>
      </details>

      {/* Ước tính lượt tìm */}
      <div className="flex flex-col gap-1 text-xs text-muted">
        {nothingToSearch ? (
          <p>{missingLanguages ? 'Chưa chọn ngôn ngữ nào' : 'Chưa chọn nền tảng mạng xã hội nào'} nên chưa có gì để tìm.</p>
        ) : (
          <p>
            Dự kiến: <strong className="font-semibold text-fg">{sources} nguồn</strong> ({sourcesText}) × tối đa{' '}
            {effectivePages * 10} kết quả, cộng truy vấn bổ sung nếu thiếu kết quả ={' '}
            <strong className="font-semibold text-fg tabular-nums">tối đa {maxCalls} lượt tìm</strong>
            {sources > 1 ? ` (ít nhất ${sources} lượt)` : ''}
            {sources * (effectivePages + 2) > effectiveBudget ? `, giới hạn bởi số lượt tìm tối đa (${effectiveBudget})` : ''}. Google
            có thể có ít bài hơn số yêu cầu (nhất là khi khoảng ngày ngắn) — khi đó app dừng sớm. Tìm lại cùng nội dung
            không tốn lượt. Sau khi tìm, bảng &ldquo;Báo cáo theo ngôn ngữ&rdquo; cho biết mỗi nguồn tìm được bao nhiêu bài.
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
