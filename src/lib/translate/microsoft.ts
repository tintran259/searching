/**
 * Dịch máy bằng Microsoft Azure Translator (REST v3) — có gói miễn phí F0 (~2 triệu ký tự/tháng).
 * Dùng làm bộ dịch DỰ PHÒNG khi bộ dịch LLM (Gemini / Claude) lỗi hoặc hết lượt: dịch theo nghĩa,
 * chỉ trả 1 cách viết và không phiên âm tên theo cách báo chí từng nước, nên kém hơn LLM với tên người.
 * https://learn.microsoft.com/azure/ai-services/translator/text-translation/reference/v3/translate
 */
import type { SearchLanguage } from '@/config/languages';
import { SOURCE_LANGUAGE } from '../types';
import { TranslationError, type Translation, type Translator } from './types';

const ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate';
const TIMEOUT_MS = 15_000;

/** Mã ngôn ngữ của Microsoft khác mã trong app */
const MICROSOFT_CODES: Record<string, string> = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant', tl: 'fil' };

interface MicrosoftResponseItem {
  translations?: { text?: string; to?: string }[];
}

export class MicrosoftTranslator implements Translator {
  readonly id = 'microsoft';
  private readonly key: string;
  private readonly region: string;
  private readonly fetchImpl: typeof fetch;

  constructor(key: string, region = '', options: { fetch?: typeof fetch } = {}) {
    this.key = key;
    this.region = region;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async translate(phrase: string, languages: SearchLanguage[], signal?: AbortSignal): Promise<Translation[]> {
    if (languages.length === 0) return [];
    const codeOf = (code: string) => MICROSOFT_CODES[code] ?? code;
    const params = new URLSearchParams({ 'api-version': '3.0', from: SOURCE_LANGUAGE });
    for (const l of languages) params.append('to', codeOf(l.code));

    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${ENDPOINT}?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': this.key,
          // Tài nguyên tạo theo vùng (vd southeastasia) bắt buộc gửi vùng; tài nguyên Global thì không
          ...(this.region ? { 'Ocp-Apim-Subscription-Region': this.region } : {}),
        },
        body: JSON.stringify([{ Text: phrase }]),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new TranslationError(
        timeout.aborted ? `Microsoft Translator không phản hồi sau ${TIMEOUT_MS / 1000}s` : 'Không kết nối được Microsoft Translator',
      );
    }

    const data = (await res.json().catch(() => null)) as MicrosoftResponseItem[] | { error?: { message?: string } } | null;
    if (!res.ok || !Array.isArray(data)) {
      const message = (data && !Array.isArray(data) && data.error?.message) || `HTTP ${res.status}`;
      if (res.status === 401) throw new TranslationError('Microsoft Translator: key hoặc vùng (region) không hợp lệ (AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION)');
      if (res.status === 403 || res.status === 429) throw new TranslationError(`Microsoft Translator: đã hết hạn mức (${message})`);
      throw new TranslationError(`Microsoft Translator lỗi: ${message}`);
    }
    const translations = data[0]?.translations ?? [];
    return languages.map((l) => {
      const text = translations.find((t) => t.to === codeOf(l.code))?.text?.trim();
      return { language: l.code, variants: text ? [text] : [] };
    });
  }
}
