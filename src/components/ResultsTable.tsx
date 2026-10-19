import {
  CONFIDENCE_LABELS,
  DATE_SOURCE_INFO,
  REGION_LABELS,
  engineLabel,
  formatDate,
  matchSourceLabel,
  type Confidence,
} from '@/lib/labels';
import type { SortDirection } from '@/lib/sort';
import { SOURCE_LANGUAGE, type ArticleResult, type HighlightRange } from '@/lib/types';
import { Fragment, useState } from 'react';
import { ExternalIcon, SortIcon } from './icons';
import { SeoDetails, SeoToggle } from './SeoDetails';

/** Các kết quả đang mở "Chi tiết SEO" */
export function useOpenSet() {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return [open, toggle] as const;
}

/** id phần tử HTML an toàn cho một kết quả (id gốc là URL) */
export const seoPanelId = (index: number) => `seo-${index}`;

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'bg-ok-soft text-ok',
  medium: 'bg-warn-soft text-warn',
  low: 'bg-surface-muted text-muted',
};

/** Đoạn trích có tô sáng: từ khoá bắt buộc màu đậm, từ phụ màu nhạt */
export function Highlighted({ text, ranges }: { text: string; ranges: HighlightRange[] }) {
  const parts: { text: string; kind: HighlightRange['kind'] | null }[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor || r.end > text.length) continue;
    parts.push({ text: text.slice(cursor, r.start), kind: null }, { text: text.slice(r.start, r.end), kind: r.kind });
    cursor = r.end;
  }
  parts.push({ text: text.slice(cursor), kind: null });
  return (
    <>
      {parts.map((part, i) =>
        part.kind ? (
          <mark key={i} className={part.kind === 'optional' ? 'optional' : undefined}>
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** Số từ đã nhập có trong bài: tìm liên quan thì là mức liên quan, có từ khoá bắt buộc thì là từ phụ */
export function MatchInfo({ item }: { item: ArticleResult }) {
  const match = item.optionalMatch;
  if (!match) return null;
  const words = match.found.length ? `: ${match.found.join(', ')}` : '';
  return (
    <p className="mt-1.5 text-xs text-muted">
      <span className="font-medium text-fg tabular-nums">
        Có {match.found.length}/{match.total} {item.loose ? 'từ đã nhập' : 'từ phụ'}
      </span>
      {words}
    </p>
  );
}

/** Ngày đăng + nhãn nguồn ngày (màu theo độ tin cậy) */
export function DateInfo({ item }: { item: ArticleResult }) {
  if (!item.date) return <span className="text-sm text-muted">Không rõ ngày</span>;
  const info = DATE_SOURCE_INFO[item.date.source];
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="font-semibold tabular-nums">{formatDate(item.date.date)}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[11px] leading-4 font-medium ${CONFIDENCE_STYLES[info.confidence]}`}
        title={`${CONFIDENCE_LABELS[info.confidence]} · giá trị gốc: ${item.date.raw}`}
      >
        {info.label}
      </span>
    </div>
  );
}

interface Props {
  items: ArticleResult[];
  sortDir: SortDirection;
  onToggleSort: () => void;
}

export function ResultsTable({ items, sortDir, onToggleSort }: Props) {
  const [openSeo, toggleSeo] = useOpenSet();
  return (
    <div className="overflow-x-auto rounded-2xl bg-surface shadow-card ring-1 ring-line">
      <table className="w-full min-w-250 border-collapse text-sm">
        <thead className="bg-surface-muted/60 text-left text-xs text-muted">
          <tr>
            <th scope="col" className="w-12 px-4 py-3 font-medium">
              STT
            </th>
            <th scope="col" className="w-40 px-3 py-3 font-medium" aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}>
              <button
                type="button"
                onClick={onToggleSort}
                className="inline-flex items-center gap-1 rounded transition hover:text-fg focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none"
                title="Đổi chiều sắp xếp"
              >
                Ngày đăng <SortIcon direction={sortDir} className="size-3.5" />
                <span className="sr-only">{sortDir === 'asc' ? '(cũ → mới)' : '(mới → cũ)'}</span>
              </button>
            </th>
            <th scope="col" className="w-[24%] px-3 py-3 font-medium">
              Tiêu đề
            </th>
            <th scope="col" className="w-36 px-3 py-3 font-medium">
              Báo / domain
            </th>
            <th scope="col" className="w-40 px-3 py-3 font-medium">
              Phạm vi
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Đoạn trích
            </th>
            <th scope="col" className="w-16 px-3 py-3 font-medium">
              Link
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <Fragment key={item.id}>
              <tr className="border-t border-line align-top transition-colors hover:bg-surface-muted/40">
                <td className="px-4 py-3.5 text-muted tabular-nums">{i + 1}</td>
                <td className="px-3 py-3.5">
                  <DateInfo item={item} />
                </td>
                <td className="px-3 py-3.5 font-medium text-pretty">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
                    {item.title || item.url}
                  </a>
                  <div>
                    <SeoToggle open={openSeo.has(item.id)} onToggle={() => toggleSeo(item.id)} controls={seoPanelId(i)} />
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  <div>{item.sourceName ?? item.domain}</div>
                  {item.sourceName && <div className="text-xs break-all text-muted">{item.domain}</div>}
                </td>
                <td className="px-3 py-3.5">
                  <div className="whitespace-nowrap">{REGION_LABELS[item.region]}</div>
                  {item.matchedLanguage !== SOURCE_LANGUAGE && (
                    <div className="text-xs text-muted" title={`Khớp “${item.matchedVariant}”`}>
                      {matchSourceLabel(item.matchedLanguage)}
                    </div>
                  )}
                  {item.foundVia !== 'google' && <div className="text-xs text-muted">qua {engineLabel(item.foundVia)}</div>}
                </td>
                <td className="px-3 py-3.5 leading-relaxed text-muted">
                  <Highlighted text={item.snippet} ranges={item.highlights} />
                  <MatchInfo item={item} />
                </td>
                <td className="px-3 py-3.5">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded whitespace-nowrap text-accent hover:underline focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none"
                    title={item.url}
                  >
                    Mở <ExternalIcon className="size-3.5" />
                  </a>
                </td>
              </tr>
              {openSeo.has(item.id) && (
                <tr className="align-top">
                  <td />
                  <td colSpan={6} className="px-3 pb-4">
                    <SeoDetails seo={item.seo} id={seoPanelId(i)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
