/**
 * Dịch / phiên âm từ khoá tiếng Việt sang nhiều ngôn ngữ bằng Claude, một lần gọi cho mọi ngôn ngữ.
 * Dùng LLM vì tên người cần phiên âm theo cách báo chí từng nước hay viết (chữ Hán Việt, Kirin,
 * Thái, Lào, Khmer…), việc mà dịch máy thông thường làm kém. Kết quả trả về dạng JSON theo schema.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { SearchLanguage } from '@/config/languages';
import { SYSTEM_PROMPT, pickVariants, userPrompt } from './prompt';
import { TranslationError, type Translation, type Translator } from './types';

const MODEL = 'claude-opus-5-5';

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API: API key không hợp lệ (ANTHROPIC_API_KEY)';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Claude API: key không có quyền dùng model này';
  if (err instanceof Anthropic.RateLimitError) return 'Claude API: vượt giới hạn tần suất, hãy thử lại sau';
  if (err instanceof Anthropic.APIError) return `Claude API lỗi ${err.status ?? 'kết nối'}: ${err.message}`;
  return `Không gọi được Claude API (kiểm tra ANTHROPIC_API_KEY): ${err instanceof Error ? err.message : String(err)}`;
}

type ClientOptions = NonNullable<ConstructorParameters<typeof Anthropic>[0]>;

export class ClaudeTranslator implements Translator {
  readonly id = `claude:${MODEL}`;
  private readonly clientOptions: ClientOptions;
  private client: Anthropic | null = null;

  constructor(clientOptions: ClientOptions = {}) {
    this.clientOptions = clientOptions;
  }

  async translate(phrase: string, languages: SearchLanguage[], signal?: AbortSignal): Promise<Translation[]> {
    if (languages.length === 0) return [];
    const codes = languages.map((l) => l.code) as [string, ...string[]];
    const schema = z.object({
      translations: z.array(z.object({ language: z.enum(codes), variants: z.array(z.string()) })),
    });
    // Tạo client ở lần dịch đầu tiên: thiếu key thì chỉ báo lỗi khi thật sự cần dịch
    this.client ??= new Anthropic({ timeout: 90_000, ...this.clientOptions });

    const response = await this.client.beta.messages
      .parse(
        {
          model: MODEL,
          max_tokens: 16000,
          // Nếu bộ lọc an toàn từ chối, máy chủ tự chạy lại yêu cầu bằng model dự phòng phù hợp
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt(phrase, languages) }],
        },
        { signal },
      )
      .catch((err: unknown) => {
        throw new TranslationError(describeError(err));
      });

    if (response.stop_reason === 'refusal') throw new TranslationError('Claude từ chối dịch từ khoá này');
    const output = response.parsed_output;
    if (!output) throw new TranslationError(`Claude không trả về kết quả hợp lệ (stop_reason: ${response.stop_reason})`);
    return pickVariants(output.translations, languages);
  }
}
