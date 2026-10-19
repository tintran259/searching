'use client';

import { useMemo, useState } from 'react';
import { REJECT_REASON_LABELS } from '@/lib/labels';
import { sourceLabel } from '@/lib/source-report';
import type { RejectReason, RejectedItem } from '@/lib/types';
import { ExternalIcon } from './icons';

const REASON_ORDER = Object.keys(REJECT_REASON_LABELS) as RejectReason[];

/** Bài bị loại kèm lý do — để kiểm tra lại bộ lọc */
export function RejectedList({ items }: { items: RejectedItem[] }) {
  const [filter, setFilter] = useState<RejectReason | 'all'>('all');
  const counts = useMemo(() => {
    const map = new Map<RejectReason, number>();
    for (const item of items) map.set(item.reason, (map.get(item.reason) ?? 0) + 1);
    return map;
  }, [items]);
  const visible = filter === 'all' ? items : items.filter((i) => i.reason === filter);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
        Chưa có bài nào bị loại.
      </div>
    );
  }

  const chip = (value: RejectReason | 'all', label: string, count: number) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none active:scale-[0.97] ${
        filter === value ? 'bg-accent text-accent-fg' : 'bg-surface-muted text-muted hover:bg-line hover:text-fg'
      }`}
    >
      {label} <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line sm:p-5">
      <p className="text-sm text-pretty text-muted">
        Các bài tìm thấy nhưng không được nhận, kèm lý do. Mở link để tự kiểm tra nếu nghi bị loại nhầm.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {chip('all', 'Tất cả', items.length)}
        {REASON_ORDER.filter((r) => counts.has(r)).map((r) => chip(r, REJECT_REASON_LABELS[r], counts.get(r)!))}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-205 border-collapse text-sm">
          <thead className="text-left text-xs text-muted">
            <tr>
              <th scope="col" className="w-10 py-2 pr-3 font-medium">
                #
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Trang
              </th>
              <th scope="col" className="w-48 py-2 pr-3 font-medium">
                Lý do
              </th>
              <th scope="col" className="w-[38%] py-2 pr-3 font-medium">
                Chi tiết
              </th>
              <th scope="col" className="w-36 py-2 font-medium">
                Tìm qua
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item, i) => (
              <tr key={item.id} className="border-t border-line align-top">
                <td className="py-3 pr-3 text-muted tabular-nums">{i + 1}</td>
                <td className="py-3 pr-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-start gap-1 hover:text-accent hover:underline"
                  >
                    <span className="line-clamp-2">{item.title || item.url}</span>
                    <ExternalIcon className="mt-0.5 size-3.5 shrink-0 text-muted" />
                  </a>
                  <div className="text-xs break-all text-muted">{item.domain}</div>
                </td>
                <td className="py-3 pr-3 font-medium">{REJECT_REASON_LABELS[item.reason]}</td>
                <td className="py-3 pr-3 text-pretty text-muted">{item.detail}</td>
                <td className="py-3 text-xs text-muted">{sourceLabel(item.foundLanguage, item.foundVia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
