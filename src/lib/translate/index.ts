import { createCache } from '../cache';
import { withTranslationCache } from './cached';
import { ClaudeTranslator } from './claude';
import { withFallback } from './fallback';
import { GeminiTranslator } from './gemini';
import { MicrosoftTranslator } from './microsoft';
import { TranslationError, type Translator } from './types';

const TRANSLATION_CACHE_TTL_MS = 30 * 24 * 3_600_000;

/** Không có key nào: vẫn trả về bộ dịch để pipeline cảnh báo rõ cách cấu hình rồi tìm bằng tiếng Việt */
const unconfiguredTranslator: Translator = {
  id: 'none',
  async translate() {
    throw new TranslationError(
      'chưa có API key cho bộ dịch — thêm GEMINI_API_KEY (miễn phí, tạo ở Google AI Studio), ANTHROPIC_API_KEY hoặc AZURE_TRANSLATOR_KEY vào .env.local',
    );
  },
};

/**
 * Chọn bộ dịch theo TRANSLATOR (gemini | claude | microsoft | off). Không đặt TRANSLATOR thì tự chọn theo key
 * có trong môi trường: GEMINI_API_KEY (miễn phí) trước, rồi ANTHROPIC_API_KEY, rồi AZURE_TRANSLATOR_KEY.
 * Có AZURE_TRANSLATOR_KEY mà bộ chính là Gemini / Claude thì Microsoft Translator làm bộ dự phòng.
 */
export function getTranslator(): Translator | null {
  const env = (name: string) => process.env[name]?.trim() || '';
  const name = (
    env('TRANSLATOR') ||
    (env('GEMINI_API_KEY')
      ? 'gemini'
      : env('ANTHROPIC_API_KEY') || env('ANTHROPIC_AUTH_TOKEN')
        ? 'claude'
        : env('AZURE_TRANSLATOR_KEY')
          ? 'microsoft'
          : '')
  ).toLowerCase();

  let translator: Translator;
  switch (name) {
    case 'off':
      return null;
    case '':
      return unconfiguredTranslator;
    case 'gemini':
      if (!env('GEMINI_API_KEY')) return unconfiguredTranslator;
      translator = new GeminiTranslator(env('GEMINI_API_KEY'), { model: env('GEMINI_MODEL') });
      break;
    case 'claude':
      translator = new ClaudeTranslator();
      break;
    case 'microsoft':
      if (!env('AZURE_TRANSLATOR_KEY')) return unconfiguredTranslator;
      translator = new MicrosoftTranslator(env('AZURE_TRANSLATOR_KEY'), env('AZURE_TRANSLATOR_REGION'));
      break;
    default:
      throw new Error(`TRANSLATOR "${name}" chưa được hỗ trợ (dùng "gemini", "claude", "microsoft" hoặc "off").`);
  }
  if (name !== 'microsoft' && env('AZURE_TRANSLATOR_KEY')) {
    const backup = new MicrosoftTranslator(env('AZURE_TRANSLATOR_KEY'), env('AZURE_TRANSLATOR_REGION'));
    translator = withFallback(translator, backup, 'bản dịch máy Microsoft Translator');
  }
  return withTranslationCache(
    translator,
    createCache<Record<string, string[]>>('translations', { ttlMs: TRANSLATION_CACHE_TTL_MS }),
  );
}

export * from './types';
