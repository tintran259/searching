import { TranslationError, type Translator } from './types';

/**
 * Bộ dịch chính lỗi (hết lượt, treo, quá tải…) thì dùng bộ dịch dự phòng. Kết quả từ bộ dự phòng được
 * gắn `fallbackNote` (lý do) để pipeline báo cho người dùng, và không được lưu cache (lần sau thử lại bộ chính).
 */
export function withFallback(primary: Translator, backup: Translator, backupName: string): Translator {
  return {
    id: primary.id,
    async translate(phrase, languages, signal) {
      try {
        return await primary.translate(phrase, languages, signal);
      } catch (err) {
        if (signal?.aborted || !(err instanceof TranslationError)) throw err;
        const reason = err.message.replace(/[.\s]+$/, '');
        try {
          const result = await backup.translate(phrase, languages, signal);
          return result.map((t) => ({ ...t, fallbackNote: `${reason} → đã dùng ${backupName}` }));
        } catch (backupErr) {
          if (signal?.aborted) throw backupErr;
          const backupReason = backupErr instanceof Error ? backupErr.message : String(backupErr);
          throw new TranslationError(`${reason}; ${backupName} cũng lỗi: ${backupReason}`);
        }
      }
    },
  };
}
