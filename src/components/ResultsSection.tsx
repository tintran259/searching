'use client';

import { useMemo, useState } from 'react';
import { removeDiacritics } from '@/lib/query-builder';
import { sortArticles, type SortDirection } from '@/lib/sort';
import type { ArticleResult } from '@/lib/types';
import { ExportButtons } from './ExportButtons';
import { SearchIcon, SortIcon } from './icons';
import { RejectedList } from './RejectedList';
import { ResultCards } from './ResultCards';
import { ResultsTable } from './ResultsTable';
import type { SearchState } from './useSearchStream';

type Tab = 'results' | 'rejected';

const fold = (text: string) => removeDiacritics(text).toLowerCase();

/** Lọc không phân biệt dấu: gõ "tuoi tre" vẫn ra "Tuổi Trẻ" */
function filterArticles(items: ArticleResult[], query: string): ArticleResult[] {
  const needle = fold(query.trim());
  if (!needle) return items;
  return items.filter((a) => fold(`${a.title} ${a.sourceName ?? ''} ${a.domain} ${a.snippet}`).includes(needle));
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse gap-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
          <div className="h-10 w-20 rounded-md bg-surface-muted" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-4 w-2/3 rounded bg-surface-muted" />
            <div className="h-3 w-full rounded bg-surface-muted" />
            <div className="h-3 w-5/6 rounded bg-surface-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultsSection({ state }: { state: SearchState }) {
  const [tab, setTab] = useState<Tab>('results');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [filter, setFilter] = useState('');
  const sorted = useMemo(() => sortArticles(state.results, sortDir), [state.results, sortDir]);
  const visible = useMemo(() => filterArticles(sorted, filter), [sorted, filter]);
  const toggleSort = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  const running = state.status === 'running';

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'results', label: 'Kết quả', count: state.results.length },
    { id: 'rejected', label: 'Bị loại', count: state.rejected.length },
  ];

  let resultsBody;
  if (visible.length) {
    resultsBody = (
      <>
        <div className="hidden md:block">
          <ResultsTable items={visible} sortDir={sortDir} onToggleSort={toggleSort} />
        </div>
        <div className="md:hidden">
          <ResultCards items={visible} />
        </div>
      </>
    );
  } else if (running && state.results.length === 0) {
    resultsBody = <ResultsSkeleton />;
  } else {
    resultsBody = (
      <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-pretty text-muted">
        {state.results.length > 0
          ? `Không có bài nào khớp bộ lọc “${filter}”.`
          : 'Không có bài nào khớp từ khoá đã nhập. Xem tab “Bị loại” để biết lý do từng bài.'}
      </div>
    );
  }

  return (
    <section id="ket-qua" aria-label="Kết quả tìm kiếm" className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Danh sách" className="inline-flex rounded-xl bg-surface-muted p-1 ring-1 ring-line">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none ${
                tab === t.id ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg'
              }`}
            >
              {t.label}
              <span
                className={`rounded-md px-1.5 text-xs tabular-nums ${
                  tab === t.id ? (t.id === 'results' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad') : 'bg-line/70'
                }`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {tab === 'results' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Lọc kết quả</span>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Lọc theo tiêu đề, báo…"
                className="h-9 w-52 rounded-lg border border-line bg-surface pr-3 pl-9 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/20"
              />
            </label>
            <button
              type="button"
              onClick={toggleSort}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface px-3 text-sm font-medium ring-1 ring-line transition hover:bg-surface-muted focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none active:scale-[0.98]"
              title="Đổi chiều sắp xếp theo ngày đăng"
            >
              <SortIcon direction={sortDir} className="size-4" />
              {sortDir === 'asc' ? 'Cũ → mới' : 'Mới → cũ'}
            </button>
            <ExportButtons articles={visible} rejected={state.rejected} query={state.plan?.phrase ?? state.params?.query ?? ''} />
          </div>
        )}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'results' ? resultsBody : <RejectedList items={state.rejected} />}
      </div>
    </section>
  );
}
