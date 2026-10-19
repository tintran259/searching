import type { Cache } from '../cache';
import type { Translator } from './types';

/**
 * Cache bản dịch theo từng ngôn ngữ: đổi danh sách ngôn ngữ thì chỉ dịch những ngôn ngữ chưa có.
 * Lỗi không được cache.
 */
export function withTranslationCache(translator: Translator, cache: Cache<Record<string, string[]>>): Translator {
  return {
    id: translator.id,
    async translate(phrase, languages, signal) {
      const key = `${translator.id}|${phrase}`;
      const known = { ...((await cache.get(key)) ?? {}) };
      const missing = languages.filter((l) => !(l.code in known));
      if (missing.length) {
        const fresh = await translator.translate(phrase, missing, signal);
        // Bản dịch của bộ dự phòng không lưu cache: lần sau thử lại bộ dịch chính
        if (fresh.some((t) => t.fallbackNote)) {
          return languages.map(({ code }) =>
            code in known
              ? { language: code, variants: known[code] }
              : (fresh.find((t) => t.language === code) ?? { language: code, variants: [] }),
          );
        }
        for (const { code } of missing) known[code] = fresh.find((t) => t.language === code)?.variants ?? [];
        await cache.set(key, known);
      }
      return languages.map(({ code }) => ({ language: code, variants: known[code] }));
    },
  };
}
