/**
 * Giao diện bộ dịch từ khoá. Muốn đổi sang Google Cloud Translation / DeepL…
 * chỉ cần viết một lớp mới implement `Translator` và đăng ký trong ./index.ts.
 */
import type { SearchLanguage } from '@/config/languages';

export interface Translation {
  language: string;
  /** 1–3 cách viết, phổ biến nhất trước */
  variants: string[];
  /** Có khi bản dịch đến từ bộ dịch dự phòng: lý do bộ chính lỗi (để báo người dùng; không lưu cache) */
  fallbackNote?: string;
}

export interface Translator {
  readonly id: string;
  translate(phrase: string, languages: SearchLanguage[], signal?: AbortSignal): Promise<Translation[]>;
}

export class TranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslationError';
  }
}
