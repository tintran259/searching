/**
 * Dịch / phiên âm từ khoá bằng Gemini API — có gói miễn phí (tạo key ở Google AI Studio).
 * Gọi REST models.generateContent, đầu ra JSON theo schema (responseJsonSchema, Gemini 2.5+).
 * Lưu ý: ở gói miễn phí, Google dùng nội dung gửi lên để cải thiện sản phẩm của họ.
 */
import type { SearchLanguage } from '@/config/languages';
import { SYSTEM_PROMPT, pickVariants, userPrompt } from './prompt';
import { TranslationError, type Translation, type Translator } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
/** Model nhẹ hơn, dùng khi model chính đang quá tải */
export const FALLBACK_GEMINI_MODEL = 'gemini-3.5-flash-lite';
/**
 * Thời gian chờ mỗi lần gọi. Model chính lúc quá tải có thể treo cả phút không trả lời (đã gặp: treo 90s
 * trong khi model dự phòng trả lời sau 2–3s), nên chờ ngắn rồi chuyển model thay vì chờ lâu.
 */
const DEFAULT_TIMEOUT_MS = 25_000;
/** Lỗi phía máy chủ Google (vd 503 "high demand") thường chỉ tạm thời: thử lại cùng model rồi đổi model */
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
/** Hết lượt (429): hạn mức miễn phí tính riêng cho từng model → không thử lại cùng model, chuyển ngay model khác */
const QUOTA_STATUS = 429;

/** Lỗi tạm thời. `sameModel`: đáng thử lại cùng model (5xx); hết giờ / lỗi mạng thì chuyển ngay model khác */
class GeminiUnavailableError extends TranslationError {
  constructor(
    message: string,
    readonly sameModel: boolean,
  ) {
    super(message);
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string }[] };
}

function describeError(status: number, data: GeminiResponse): string {
  const { message = '', details = [] } = data.error ?? {};
  if (details.some((d) => d.reason === 'API_KEY_INVALID')) return 'Gemini API: API key không hợp lệ (GEMINI_API_KEY)';
  if (status === 429) return 'Gemini API: đã hết lượt của gói miễn phí';
  if (status === 503) return 'Gemini API đang quá tải (HTTP 503), hãy thử lại sau ít phút';
  if (status === 401 || status === 403) return `Gemini API: key không có quyền dùng model này${message ? ` (${message})` : ''}`;
  return `Gemini API lỗi ${status}${message ? `: ${message}` : ''}`;
}

/** Đọc { translations: [{ language, variants }] } một cách an toàn */
function readTranslations(output: unknown): { language: string; variants: string[] }[] {
  const list = (output as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const { language, variants } = (item ?? {}) as { language?: unknown; variants?: unknown };
    if (typeof language !== 'string' || !Array.isArray(variants)) return [];
    return [{ language, variants: variants.filter((v): v is string => typeof v === 'string') }];
  });
}

export class GeminiTranslator implements Translator {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    options: { model?: string; fetch?: typeof fetch; retryDelayMs?: number; timeoutMs?: number } = {},
  ) {
    this.apiKey = apiKey;
    this.model = options.model || DEFAULT_GEMINI_MODEL;
    this.fetchImpl = options.fetch ?? fetch;
    this.retryDelayMs = options.retryDelayMs ?? 1500;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.id = `gemini:${this.model}`;
  }

  /**
   * Máy chủ quá tải (5xx): mỗi model thử tối đa 2 lần. Không phản hồi kịp hoặc lỗi mạng: chuyển ngay sang
   * model dự phòng. Model dự phòng cũng lỗi thì báo lỗi của cả hai.
   */
  async translate(phrase: string, languages: SearchLanguage[], signal?: AbortSignal): Promise<Translation[]> {
    if (languages.length === 0) return [];
    const models = this.model === FALLBACK_GEMINI_MODEL ? [this.model] : [this.model, FALLBACK_GEMINI_MODEL];
    const errors: GeminiUnavailableError[] = [];
    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (errors.length) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        try {
          return await this.request(model, phrase, languages, signal);
        } catch (err) {
          if (!(err instanceof GeminiUnavailableError) || signal?.aborted) throw err;
          errors.push(err);
          if (!err.sameModel) break;
        }
      }
    }
    const messages = [...new Set(errors.map((e) => e.message))];
    throw new TranslationError(messages.join('; '));
  }

  private async request(
    model: string,
    phrase: string,
    languages: SearchLanguage[],
    signal?: AbortSignal,
  ): Promise<Translation[]> {
    const schema = {
      type: 'object',
      properties: {
        translations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              language: { type: 'string', enum: languages.map((l) => l.code) },
              variants: { type: 'array', items: { type: 'string' } },
            },
            required: ['language', 'variants'],
          },
        },
      },
      required: ['translations'],
    };

    const timeout = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt(phrase, languages) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            // Dịch / phiên âm không cần suy luận dài: giảm mức "suy nghĩ" của Gemini 3 cho nhanh
            // (model 3.x Flash không nhận mức "minimal"; model 2.x không có tham số này)
            ...(/^gemini-3\.\d+-flash$/.test(model) ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
          },
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new GeminiUnavailableError(
        timeout.aborted
          ? `Gemini API (${model}) không phản hồi sau ${this.timeoutMs / 1000}s`
          : `Không kết nối được Gemini API (${model})`,
        false,
      );
    }

    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      if (RETRYABLE_STATUS.has(res.status)) throw new GeminiUnavailableError(describeError(res.status, data), true);
      if (res.status === QUOTA_STATUS) throw new GeminiUnavailableError(`${describeError(res.status, data)} (${model})`, false);
      throw new TranslationError(describeError(res.status, data));
    }
    if (data.promptFeedback?.blockReason) {
      throw new TranslationError(`Gemini chặn yêu cầu (${data.promptFeedback.blockReason})`);
    }
    const candidate = data.candidates?.[0];
    // Bỏ các phần "suy nghĩ" của model, chỉ lấy phần trả lời
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('');
    let output: unknown;
    try {
      output = JSON.parse(text);
    } catch {
      throw new TranslationError(`Gemini không trả về JSON hợp lệ (finishReason: ${candidate?.finishReason ?? 'không rõ'})`);
    }
    return pickVariants(readTranslations(output), languages);
  }
}
