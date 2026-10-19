/**
 * Cache hai tầng: bộ nhớ (trong tiến trình) + file JSON (mỗi khoá một file) để chạy lại
 * không tốn quota search và không tải lại trang.
 * Cấu hình: CACHE_MODE=file|memory|off (mặc định file), CACHE_DIR (mặc định ./.cache; trên Vercel là thư mục tạm /tmp).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type CacheMode = 'file' | 'memory' | 'off';

export interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  /** ttlMs mặc định lấy theo lúc tạo cache */
  set(key: string, value: T, ttlMs?: number): Promise<void>;
}

interface Entry<T> {
  key: string;
  expiresAt: number;
  value: T;
}

// Giữ qua các lần `next dev` nạp lại module
const globalStore = globalThis as typeof globalThis & {
  __articleFinderCache?: Map<string, Map<string, Entry<unknown>>>;
};
const memory = (globalStore.__articleFinderCache ??= new Map());

function memoryStore<T>(namespace: string): Map<string, Entry<T>> {
  let store = memory.get(namespace);
  if (!store) {
    store = new Map();
    memory.set(namespace, store);
  }
  return store as Map<string, Entry<T>>;
}

function defaultMode(): CacheMode {
  const mode = process.env.CACHE_MODE;
  return mode === 'memory' || mode === 'off' ? mode : 'file';
}

export function createCache<T>(
  namespace: string,
  options: { ttlMs: number; maxMemoryEntries?: number; mode?: CacheMode },
): Cache<T> {
  const mode = options.mode ?? defaultMode();
  const maxEntries = options.maxMemoryEntries ?? 1000;
  // Thư mục cache chỉ đọc/ghi lúc chạy, không cần Next đóng gói vào bản build
  // Trên Vercel chỉ ghi được vào thư mục tạm (/tmp): mặc định đặt cache ở đó
  const defaultDir = process.env.VERCEL
    ? path.join(os.tmpdir(), 'searching-cache')
    : path.join(/*turbopackIgnore: true*/ process.cwd(), '.cache');
  const dir = path.join(/*turbopackIgnore: true*/ process.env.CACHE_DIR || defaultDir, namespace);
  const store = memoryStore<T>(namespace);
  const fileOf = (key: string) => path.join(dir, `${createHash('sha1').update(key).digest('hex')}.json`);

  const remember = (entry: Entry<T>) => {
    store.delete(entry.key);
    store.set(entry.key, entry);
    if (store.size > maxEntries) store.delete(store.keys().next().value!);
  };

  return {
    async get(key) {
      if (mode === 'off') return undefined;
      const now = Date.now();
      const hit = store.get(key);
      if (hit) {
        if (hit.expiresAt > now) return hit.value;
        store.delete(key);
      }
      if (mode !== 'file') return undefined;
      try {
        const entry = JSON.parse(await readFile(fileOf(key), 'utf8')) as Entry<T>;
        if (entry.key !== key || entry.expiresAt <= now) return undefined;
        remember(entry);
        return entry.value;
      } catch {
        return undefined;
      }
    },

    async set(key, value, ttlMs = options.ttlMs) {
      if (mode === 'off') return;
      const entry: Entry<T> = { key, expiresAt: Date.now() + ttlMs, value };
      remember(entry);
      if (mode !== 'file') return;
      try {
        await mkdir(dir, { recursive: true });
        const file = fileOf(key);
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(entry));
        await rename(tmp, file);
      } catch (err) {
        console.warn(`[cache:${namespace}] không ghi được file cache:`, err);
      }
    },
  };
}
