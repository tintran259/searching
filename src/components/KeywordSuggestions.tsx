'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseQuery } from '@/lib/query-syntax';
import type { KeywordSuggestion, TermSuggestions } from '@/lib/types';
import { ExternalIcon } from './icons';

interface Props {
  /** Giá trị ô tìm kiếm (có dấu ` quanh từ khoá chính) */
  query: string;
  fromDate: string;
  toDate: string;
  disabled?: boolean;
  /** Cách gọi khác đã chọn, theo từ khoá chính */
  selected: Record<string, string[]>;
  onChange: (selected: Record<string, string[]>) => void;
}

/** Chờ người dùng ngừng gõ rồi mới hỏi gợi ý */
const DEBOUNCE_MS = 700;

type Loaded = Record<string, TermSuggestions | 'error'>;
const keyOf = (term: string, from: string, to: string) => `${term}|${from}|${to}`;

/**
 * Gợi ý cách gọi khác cho từng từ khoá chính (chức vụ đang giữ trong khoảng ngày, tên khác, thủ đô…) từ Wikidata.
 * Người dùng chọn gợi ý nào thì bài chỉ ghi cách gọi đó (vd "Chủ tịch nước Việt Nam" thay cho "Tô Lâm") cũng được nhận.
 * Gợi ý không tốn lượt SerpApi; cách gọi đã chọn được gộp vào cùng truy vấn bằng OR.
 */
export function KeywordSuggestions({ query, fromDate, toDate, disabled, selected, onChange }: Props) {
  const terms = useMemo(() => parseQuery(query).required, [query]);
  // Chỉ hỏi lại khi danh sách từ khoá chính đổi (gõ thêm từ phụ thì không)
  const termsKey = terms.join('\n');
  const [loaded, setLoaded] = useState<Loaded>({});
  /** Khoá đã gửi yêu cầu (đang chờ hoặc đã có kết quả) — để không hỏi lại */
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const requestedKeys = requested.current;
    if (!fromDate || !toDate || !termsKey) return;
    const missing = termsKey.split('\n').filter((t) => !requestedKeys.has(keyOf(t, fromDate, toDate)));
    if (!missing.length) return;
    const controller = new AbortController();
    const pending: string[] = [];
    const timer = window.setTimeout(() => {
      for (const term of missing) {
        const key = keyOf(term, fromDate, toDate);
        requestedKeys.add(key);
        pending.push(key);
        const qs = new URLSearchParams({ term, from: fromDate, to: toDate });
        fetch(`/api/suggest?${qs}`, { signal: controller.signal })
          .then((res) => (res.ok ? (res.json() as Promise<TermSuggestions>) : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((data) => setLoaded((prev) => ({ ...prev, [key]: data })))
          .catch(() => {
            if (!controller.signal.aborted) setLoaded((prev) => ({ ...prev, [key]: 'error' }));
          })
          .finally(() => pending.splice(pending.indexOf(key), 1));
      }
    }, DEBOUNCE_MS);
    return () => {
      // Đổi từ khoá / khoảng ngày giữa chừng: huỷ yêu cầu đang chờ, lần sau hỏi lại
      window.clearTimeout(timer);
      controller.abort();
      for (const key of pending) requestedKeys.delete(key);
    };
  }, [termsKey, fromDate, toDate]);

  if (!terms.length) return null;

  const toggle = (term: string, text: string) => {
    const current = selected[term] ?? [];
    const next = current.includes(text) ? current.filter((t) => t !== text) : [...current, text];
    onChange({ ...selected, [term]: next });
  };
  const chosenCount = terms.reduce((n, t) => n + (selected[t]?.length ?? 0), 0);

  return (
    <section aria-label="Gợi ý cách gọi khác cho từ khoá chính" className="-mt-3 flex flex-col gap-2.5 rounded-xl bg-surface-muted/50 p-3 ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-semibold">Gợi ý cách gọi khác</h3>
        <p className="text-xs text-muted">Bài chỉ ghi cách gọi đã chọn (vd chức danh) cũng được nhận · nguồn: Wikidata</p>
      </div>

      {terms.map((term) => {
        const state = loaded[keyOf(term, fromDate, toDate)];
        return (
          <div key={term} className="flex flex-col gap-1.5">
            <p className="text-xs text-muted">
              <span className="font-semibold text-fg">{term}</span>
              {state && typeof state === 'object' && state.entity && (
                <>
                  {' — '}
                  {state.entity.description ?? state.entity.label}{' '}
                  <a
                    href={state.entity.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-accent hover:underline"
                    title="Xem trên Wikidata để chắc đúng người / nơi"
                  >
                    Wikidata
                    <ExternalIcon className="size-3" />
                  </a>
                </>
              )}
            </p>
            {state === undefined ? (
              <p className="text-xs text-muted">Đang tìm gợi ý…</p>
            ) : state === 'error' ? (
              <p className="text-xs text-muted">Không lấy được gợi ý lúc này.</p>
            ) : state.suggestions.length === 0 ? (
              <p className="text-xs text-muted">Không có gợi ý cho từ khoá này.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {state.suggestions.map((s) => (
                  <li key={s.text}>
                    <SuggestionChip
                      suggestion={s}
                      checked={selected[term]?.includes(s.text) ?? false}
                      disabled={disabled}
                      onToggle={() => toggle(term, s.text)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {chosenCount > 0 && (
        <p className="text-xs text-pretty text-muted">
          Đã chọn {chosenCount} cách gọi: gộp vào cùng truy vấn bằng OR nên không tốn thêm lượt. Nếu trang kết quả đầu đã đầy hoặc
          còn thiếu bài, app tìm riêng bằng cách gọi khác (+1 lượt, trong số lượt tìm tối đa).
        </p>
      )}
    </section>
  );
}

function SuggestionChip({
  suggestion: s,
  checked,
  disabled,
  onToggle,
}: {
  suggestion: KeywordSuggestion;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  let tone = 'bg-surface text-fg ring-line hover:bg-line/60';
  if (checked) tone = 'bg-accent text-accent-fg ring-accent';
  else if (!s.current) tone = 'bg-surface text-muted ring-line/70 hover:bg-line/60';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      title={s.current ? undefined : 'Chức vụ không trùng khoảng ngày đang tìm — dễ ra bài về người khác giữ chức này'}
      className={`inline-flex items-baseline gap-1.5 rounded-lg px-2.5 py-1 text-left text-xs ring-1 transition focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 ${tone}`}
    >
      <span className="font-medium">
        {checked ? '✓ ' : ''}
        {s.text}
      </span>
      {s.note && <span className={checked ? 'opacity-80' : 'text-muted'}>{s.note}</span>}
    </button>
  );
}
