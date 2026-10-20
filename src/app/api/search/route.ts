import type { NextRequest } from 'next/server';
import { latestTodayAnywhere } from '@/lib/date-range';
import { loadPage } from '@/lib/page-loader';
import { runPipeline } from '@/lib/pipeline';
import { getSearchProvider } from '@/lib/search';
import { parseSearchParams } from '@/lib/search-params';
import { getTranslator } from '@/lib/translate';
import { lookupWaybackDate } from '@/lib/wayback';

// Route chạy trên Node.js (mặc định; khi bật cacheComponents không được khai báo `runtime`).
/**
 * Một lượt tìm có thể kéo dài vài phút; nền tảng deploy dùng giá trị này làm giới hạn thời gian.
 * 300s là mức tối đa của gói Vercel Hobby (Pro: tối đa 800s).
 */
export const maxDuration = 300;

const HEARTBEAT_MS = 15_000;
/** Tự dừng gọn trước khi hết `maxDuration` (nền tảng sẽ cắt ngang kết nối) để vẫn gửi được sự kiện "done" */
const DEADLINE_MS = (300 - 20) * 1000;

/**
 * GET /api/search?q=…&region=domestic|foreign&from=2026-10-14&to=2026-10-15&pages=3&langs=en,ru,zh-CN
 * (from/to nhận YYYY-MM-DD hoặc chỉ năm YYYY)
 * Trả về Server-Sent Events: start, progress, result, rejected, warning, done, fatal.
 */
export async function GET(request: NextRequest) {
  // Đọc tham số request trước tiên: route chạy theo từng request, không prerender.
  // Khoảng ngày do trình duyệt gửi theo giờ máy người dùng, nên giới hạn trên là ngày muộn nhất ở mọi múi giờ
  const parsed = parseSearchParams(request.nextUrl.searchParams, latestTodayAnywhere());
  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
      const deadline = setTimeout(() => {
        send('warning', {
          type: 'warning',
          message:
            'Đã hết thời gian tối đa của máy chủ (khoảng 5 phút) nên dừng tìm; các bài đã tìm được vẫn được giữ. Hãy bớt ngôn ngữ hoặc giảm số kết quả mỗi ngôn ngữ.',
        });
        abort.abort();
      }, DEADLINE_MS);

      try {
        if (!parsed.ok) {
          send('fatal', { message: parsed.error });
          return;
        }
        await runPipeline(
          parsed.params,
          {
            provider: getSearchProvider(),
            loadPage,
            lookupWayback: lookupWaybackDate,
            translator: parsed.params.languages.length ? getTranslator() : null,
          },
          (event) => send(event.type, event),
          abort.signal,
        );
      } catch (err) {
        if (!abort.signal.aborted) send('fatal', { message: err instanceof Error ? err.message : String(err) });
      } finally {
        clearInterval(heartbeat);
        clearTimeout(deadline);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      // Trình duyệt đóng kết nối (bấm Dừng / đóng tab) → dừng pipeline
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
