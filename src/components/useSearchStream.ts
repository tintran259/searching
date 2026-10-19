'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toQueryString } from '@/lib/search-params';
import type { ArticleResult, PipelineEvent, ProgressState, QueryPlan, RejectedItem, SearchParams } from '@/lib/types';

export type SearchStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error';

export interface SearchState {
  status: SearchStatus;
  params: SearchParams | null;
  plan: QueryPlan | null;
  progress: ProgressState | null;
  results: ArticleResult[];
  rejected: RejectedItem[];
  warnings: string[];
  error: string | null;
  durationMs: number | null;
}

const INITIAL_STATE: SearchState = {
  status: 'idle',
  params: null,
  plan: null,
  progress: null,
  results: [],
  rejected: [],
  warnings: [],
  error: null,
  durationMs: null,
};

/** Gộp các sự kiện đến dồn dập rồi cập nhật giao diện tối đa ~4 lần/giây */
const FLUSH_INTERVAL_MS = 250;

type EventOf<T extends PipelineEvent['type']> = Extract<PipelineEvent, { type: T }>;

function listen<T extends PipelineEvent['type']>(source: EventSource, type: T, handler: (event: EventOf<T>) => void) {
  source.addEventListener(type, (e) => handler(JSON.parse((e as MessageEvent<string>).data) as EventOf<T>));
}

interface Buffer {
  results: ArticleResult[];
  rejected: RejectedItem[];
  progress: ProgressState | null;
}

const emptyBuffer = (): Buffer => ({ results: [], rejected: [], progress: null });

/** Mở kết nối SSE tới /api/search và gom sự kiện thành state cho giao diện. */
export function useSearchStream() {
  const [state, setState] = useState<SearchState>(INITIAL_STATE);
  const sourceRef = useRef<EventSource | null>(null);
  const bufferRef = useRef<Buffer>(emptyBuffer());
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const buffer = bufferRef.current;
    if (!buffer.results.length && !buffer.rejected.length && !buffer.progress) return;
    bufferRef.current = emptyBuffer();
    setState((s) => ({
      ...s,
      results: buffer.results.length ? [...s.results, ...buffer.results] : s.results,
      rejected: buffer.rejected.length ? [...s.rejected, ...buffer.rejected] : s.rejected,
      progress: buffer.progress ?? s.progress,
    }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current === null) timerRef.current = window.setTimeout(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    flush();
  }, [flush]);

  const start = useCallback(
    (params: SearchParams) => {
      close();
      bufferRef.current = emptyBuffer();
      setState({ ...INITIAL_STATE, status: 'running', params });

      const source = new EventSource(`/api/search?${toQueryString(params)}`);
      sourceRef.current = source;

      listen(source, 'start', (e) => setState((s) => ({ ...s, plan: e.plan })));
      listen(source, 'progress', (e) => {
        bufferRef.current.progress = e.progress;
        scheduleFlush();
      });
      listen(source, 'result', (e) => {
        bufferRef.current.results.push(e.item);
        scheduleFlush();
      });
      listen(source, 'rejected', (e) => {
        bufferRef.current.rejected.push(e.item);
        scheduleFlush();
      });
      listen(source, 'warning', (e) => setState((s) => ({ ...s, warnings: [...s.warnings, e.message] })));
      listen(source, 'done', (e) => {
        close();
        setState((s) => ({ ...s, status: e.aborted ? 'stopped' : 'done', progress: e.progress, durationMs: e.durationMs }));
      });
      source.addEventListener('fatal', (e) => {
        const { message } = JSON.parse((e as MessageEvent<string>).data) as { message: string };
        close();
        setState((s) => ({ ...s, status: 'error', error: message }));
      });
      source.onerror = () => {
        // Server đóng kết nối bất thường; không để EventSource tự kết nối lại và chạy lại từ đầu
        if (sourceRef.current !== source) return;
        close();
        setState((s) => (s.status === 'running' ? { ...s, status: 'error', error: 'Mất kết nối tới máy chủ.' } : s));
      };
    },
    [close, scheduleFlush],
  );

  const stop = useCallback(() => {
    if (!sourceRef.current) return;
    close();
    setState((s) => ({ ...s, status: 'stopped' }));
  }, [close]);

  useEffect(() => close, [close]);

  return { state, start, stop };
}
