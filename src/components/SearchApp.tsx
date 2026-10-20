'use client';

import type { SearchQuota } from '@/lib/search/types';
import { EmptyState } from './EmptyState';
import { LogoMark } from './icons';
import { ProgressPanel } from './ProgressPanel';
import { ResultsSection } from './ResultsSection';
import { SearchForm } from './SearchForm';
import { useBrowserToday } from './useBrowserToday';
import { useSearchQuota } from './useSearchQuota';
import { useSearchStream } from './useSearchStream';

function QuotaBadge({ quota }: { quota: SearchQuota | null }) {
  if (!quota || quota.searchesLeft === null) return null;
  const total = quota.searchesPerMonth;
  const ratio = total ? quota.searchesLeft / total : 1;
  const low = ratio < 0.15;
  return (
    <div
      className="flex items-center gap-2.5 text-xs text-muted"
      title={`Lượt tìm SerpApi còn lại trong tháng${quota.plan ? ` · ${quota.plan}` : ''}`}
    >
      <span className="hidden sm:inline">Còn</span>
      <span className={`font-semibold tabular-nums ${low ? 'text-warn' : 'text-fg'}`}>
        {quota.searchesLeft}
        {total ? <span className="font-normal text-muted">/{total}</span> : null}
      </span>
      <span>lượt tìm</span>
      {total ? (
        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted sm:block" aria-hidden>
          <span
            className={`block h-full w-full origin-left rounded-full ${low ? 'bg-warn' : 'bg-accent'}`}
            style={{ transform: `scaleX(${Math.max(0, Math.min(1, ratio))})` }}
          />
        </span>
      ) : null}
    </div>
  );
}

/** `serverToday`: ngày lúc prerender, chỉ hiện tạm trước khi trình duyệt chạy; sau đó dùng ngày theo giờ trình duyệt */
export default function SearchApp({ today: serverToday }: { today: string }) {
  const today = useBrowserToday(serverToday);
  const { state, start, stop } = useSearchStream();
  // Đọc lại lượt tìm còn lại khi bắt đầu và khi kết thúc mỗi lượt tìm
  const quota = useSearchQuota(state.status);
  const started = state.status !== 'idle';

  return (
    <>
      <a
        href="#ket-qua"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        Bỏ qua tới kết quả
      </a>

      <header className="sticky top-0 z-20 border-b border-line/70 bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-350 items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-7" />
            <span className="font-semibold tracking-tight">Dò bài viết</span>
          </div>
          <QuotaBadge quota={quota} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-350 flex-col gap-6 px-4 pt-8 pb-20 sm:px-6 lg:px-8 lg:pt-10">
        <div className="max-w-3xl">
          <h1 className="text-[1.65rem] leading-tight font-semibold tracking-[-0.02em] text-balance sm:text-[2.1rem]">
            Tìm bài báo nhắc tới một người hoặc sự kiện
          </h1>
          <p className="mt-2.5 max-w-[65ch] text-[15px] leading-relaxed text-pretty text-muted">
            Nhập nội dung cần tìm, bôi đen phần phải có nguyên văn (vd tên người) để đặt làm từ khoá chính, chọn phạm vi và thời gian. App
            tìm trên Google, mở từng bài để kiểm tra lại, rồi xếp các bài hợp lệ từ cũ nhất đến mới nhất.
          </p>
        </div>

        <SearchForm today={today} running={state.status === 'running'} quota={quota} onSearch={start} onStop={stop} />

        {started ? (
          <>
            <ProgressPanel state={state} />
            <ResultsSection state={state} />
          </>
        ) : (
          <EmptyState />
        )}
      </main>
    </>
  );
}
