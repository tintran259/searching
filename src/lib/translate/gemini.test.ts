import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_LANGUAGES } from '@/config/languages';
import { GeminiTranslator } from './gemini';
import { getTranslator } from './index';
import { SYSTEM_PROMPT } from './prompt';
import { TranslationError } from './types';

const langs = (...codes: string[]) => SEARCH_LANGUAGES.filter((l) => codes.includes(l.code));

interface GeminiRequestBody {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: string; parts: { text: string }[] }[];
  generationConfig: {
    responseMimeType: string;
    responseJsonSchema: { properties: { translations: { items: { properties: { language: { enum: string[] } } } } } };
  };
}

function stubFetch(status: number, body: unknown) {
  const requests: { url: string; headers: Headers; body: GeminiRequestBody }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const reply = (text: string, finishReason = 'STOP') => ({
  candidates: [{ content: { role: 'model', parts: [{ text: 'suy nghĩ của model', thought: true }, { text }] }, finishReason }],
});

describe('GeminiTranslator', () => {
  it('gọi generateContent với prompt chung và JSON schema, trả về bản dịch theo thứ tự yêu cầu', async () => {
    const output = { translations: [{ language: 'ru', variants: [' Чан Ван А ', ''] }, { language: 'zh-CN', variants: ['陈文A'] }] };
    const { requests, fetchImpl } = stubFetch(200, reply(JSON.stringify(output)));
    const result = await new GeminiTranslator('KEY', { fetch: fetchImpl }).translate('Trần Văn A', langs('ru', 'zh-CN', 'th'));

    const [{ url, headers, body }] = requests;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(headers.get('x-goog-api-key')).toBe('KEY');
    expect(body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT);
    expect(body.contents[0].parts[0].text).toBe(
      'Keyword: Trần Văn A\nTarget languages:\n- ru: Russian\n- zh-CN: Chinese (Simplified)\n- th: Thai',
    );
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.properties.translations.items.properties.language.enum).toEqual([
      'ru',
      'zh-CN',
      'th',
    ]);
    // bỏ phần "suy nghĩ", bỏ biến thể rỗng; ngôn ngữ thiếu → rỗng
    expect(result).toEqual([
      { language: 'ru', variants: ['Чан Ван А'] },
      { language: 'zh-CN', variants: ['陈文A'] },
      { language: 'th', variants: [] },
    ]);
  });

  it('đổi model qua tuỳ chọn', async () => {
    const { requests, fetchImpl } = stubFetch(200, reply('{"translations":[]}'));
    const translator = new GeminiTranslator('KEY', { model: 'gemini-3.5-flash-lite', fetch: fetchImpl });
    await translator.translate('Trần Văn A', langs('en'));
    expect(translator.id).toBe('gemini:gemini-3.5-flash-lite');
    expect(requests[0].url).toContain('/models/gemini-3.5-flash-lite:generateContent');
  });

  it.each([
    [
      400,
      {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
        },
      },
      'Gemini API: API key không hợp lệ (GEMINI_API_KEY)',
    ],
    [429, { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }, 'Gemini API: đã hết lượt của gói miễn phí (gemini-3.8-flash); Gemini API: đã hết lượt của gói miễn phí (gemini-3.5-flash-lite)'],
    [500, { error: { code: 500, message: 'Internal error', status: 'INTERNAL' } }, 'Gemini API lỗi 500: Internal error'],
  ])('HTTP %i → TranslationError dễ hiểu', async (status, body, message) => {
    const { fetchImpl } = stubFetch(status, body);
    const translator = new GeminiTranslator('KEY', { fetch: fetchImpl, retryDelayMs: 0 });
    await expect(translator.translate('Trần Văn A', langs('en'))).rejects.toThrow(new TranslationError(message));
  });

  describe('máy chủ quá tải (5xx): thử lại rồi chuyển model dự phòng', () => {
    const OVERLOADED = { status: 503, body: { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } } };
    const OK = { status: 200, body: reply(JSON.stringify({ translations: [{ language: 'en', variants: ['Tran Van A'] }] })) };

    function stubSequence(responses: { status: number; body: unknown }[]) {
      const urls: string[] = [];
      const fetchImpl = (async (input: string | URL | Request) => {
        const { status, body } = responses[Math.min(urls.length, responses.length - 1)];
        urls.push(String(input));
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
      return { urls, fetchImpl };
    }
    const model = (url: string) => /models\/([^:]+):/.exec(url)?.[1];

    it('lỗi một lần → thử lại cùng model và thành công', async () => {
      const { urls, fetchImpl } = stubSequence([OVERLOADED, OK]);
      const result = await new GeminiTranslator('KEY', { fetch: fetchImpl, retryDelayMs: 0 }).translate('x', langs('en'));
      expect(urls.map(model)).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash']);
      expect(result).toEqual([{ language: 'en', variants: ['Tran Van A'] }]);
    });

    it('model chính lỗi hai lần → dùng gemini-3.5-flash-lite', async () => {
      const { urls, fetchImpl } = stubSequence([OVERLOADED, OVERLOADED, OK]);
      await new GeminiTranslator('KEY', { fetch: fetchImpl, retryDelayMs: 0 }).translate('x', langs('en'));
      expect(urls.map(model)).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite']);
    });

    it('model chính không phản hồi (treo) → chuyển ngay sang model dự phòng, không chờ thêm', async () => {
      const urls: string[] = [];
      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        urls.push(String(input));
        if (model(String(input)) === 'gemini-3.5-flash-lite') {
          return new Response(JSON.stringify(OK.body), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        // Treo cho tới khi hết thời gian chờ
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
      }) as typeof fetch;
      const started = Date.now();
      const result = await new GeminiTranslator('KEY', { fetch: fetchImpl, retryDelayMs: 0, timeoutMs: 50 }).translate('x', langs('en'));
      expect(urls.map(model)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
      expect(result).toEqual([{ language: 'en', variants: ['Tran Van A'] }]);
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('cả hai model đều không kết nối được → báo lỗi của cả hai', async () => {
      const fetchImpl = (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch;
      await expect(
        new GeminiTranslator('KEY', { fetch: fetchImpl, retryDelayMs: 0 }).translate('x', langs('en')),
      ).rejects.toThrow('Không kết nối được Gemini API (gemini-3.8-flash); Không kết nối được Gemini API (gemini-3.5-flash-lite)');
    });

    it('model Gemini 3 Flash: giảm mức suy nghĩ (thinkingLevel low); model khác không gửi tham số này', async () => {
      const main = stubFetch(200, OK.body);
      await new GeminiTranslator('KEY', { fetch: main.fetchImpl }).translate('x', langs('en'));
      expect(main.requests[0].body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' } });
      const lite = stubFetch(200, OK.body);
      await new GeminiTranslator('KEY', { fetch: lite.fetchImpl, model: 'gemini-3.5-flash-lite' }).translate('x', langs('en'));
      expect(lite.requests[0].body.generationConfig).not.toHaveProperty('thinkingConfig');
    });

    it('lỗi mãi → báo quá tải sau 4 lần thử; lỗi khác (400, 429) không thử lại', async () => {
      const overloaded = stubSequence([OVERLOADED]);
      await expect(
        new GeminiTranslator('KEY', { fetch: overloaded.fetchImpl, retryDelayMs: 0 }).translate('x', langs('en')),
      ).rejects.toThrow('Gemini API đang quá tải (HTTP 503), hãy thử lại sau ít phút');
      expect(overloaded.urls).toHaveLength(4);

      const invalid = stubSequence([{ status: 400, body: { error: { code: 400, message: 'Bad request' } } }]);
      await expect(
        new GeminiTranslator('KEY', { fetch: invalid.fetchImpl, retryDelayMs: 0 }).translate('x', langs('en')),
      ).rejects.toThrow('Gemini API lỗi 400: Bad request');
      expect(invalid.urls).toHaveLength(1);
    });

    it('hết lượt (429) ở model chính → chuyển ngay sang model dự phòng (hạn mức riêng)', async () => {
      const QUOTA = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } } };
      const { urls, fetchImpl } = stubSequence([QUOTA, OK]);
      const result = await new GeminiTranslator('KEY', { fetch: fetchImpl, retryDelayMs: 0 }).translate('x', langs('en'));
      expect(urls.map(model)).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
      expect(result).toEqual([{ language: 'en', variants: ['Tran Van A'] }]);

      const both = stubSequence([QUOTA]);
      await expect(
        new GeminiTranslator('KEY', { fetch: both.fetchImpl, retryDelayMs: 0 }).translate('x', langs('en')),
      ).rejects.toThrow('Gemini API: đã hết lượt của gói miễn phí (gemini-3.8-flash); Gemini API: đã hết lượt của gói miễn phí (gemini-3.5-flash-lite)');
      expect(both.urls).toHaveLength(2);
    });
  });

  it('yêu cầu bị chặn, hoặc kết quả không phải JSON', async () => {
    const blocked = stubFetch(200, { promptFeedback: { blockReason: 'SAFETY' } });
    await expect(new GeminiTranslator('KEY', { fetch: blocked.fetchImpl }).translate('x', langs('en'))).rejects.toThrow(
      'Gemini chặn yêu cầu (SAFETY)',
    );
    const truncated = stubFetch(200, reply('{"translations": [', 'MAX_TOKENS'));
    await expect(new GeminiTranslator('KEY', { fetch: truncated.fetchImpl }).translate('x', langs('en'))).rejects.toThrow(
      'Gemini không trả về JSON hợp lệ (finishReason: MAX_TOKENS)',
    );
  });
});

describe('getTranslator — chọn bộ dịch theo cấu hình', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function env(values: Partial<Record<'TRANSLATOR' | 'GEMINI_API_KEY' | 'GEMINI_MODEL' | 'ANTHROPIC_API_KEY', string>>) {
    for (const name of ['TRANSLATOR', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) {
      vi.stubEnv(name, values[name as keyof typeof values] ?? '');
    }
  }

  it('có GEMINI_API_KEY → Gemini (miễn phí), kể cả khi có cả key Claude', () => {
    env({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' });
    expect(getTranslator()?.id).toBe('gemini:gemini-3.8-flash');
  });

  it('chỉ có key Claude → Claude', () => {
    env({ ANTHROPIC_API_KEY: 'a' });
    expect(getTranslator()?.id).toBe('claude:claude-opus-5-5');
  });

  it('TRANSLATOR ghi đè lựa chọn tự động; GEMINI_MODEL đổi model', () => {
    env({ TRANSLATOR: 'claude', GEMINI_API_KEY: 'g' });
    expect(getTranslator()?.id).toBe('claude:claude-opus-5-5');
    env({ GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-3.5-flash-lite' });
    expect(getTranslator()?.id).toBe('gemini:gemini-3.5-flash-lite');
  });

  it('có AZURE_TRANSLATOR_KEY: làm dự phòng cho Gemini; chỉ có key đó thì dùng Microsoft làm bộ chính', () => {
    vi.stubEnv('TRANSLATOR', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('AZURE_TRANSLATOR_KEY', 'az');
    expect(getTranslator()?.id).toBe('microsoft');
    vi.stubEnv('GEMINI_API_KEY', 'g');
    expect(getTranslator()?.id).toBe('gemini:gemini-3.8-flash');
  });

  it('TRANSLATOR=off → không dịch', () => {
    env({ TRANSLATOR: 'off', GEMINI_API_KEY: 'g' });
    expect(getTranslator()).toBeNull();
  });

  it('chưa có key nào → khi dịch sẽ báo cách cấu hình', async () => {
    env({});
    await expect(getTranslator()!.translate('Trần Văn A', langs('en'))).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('TRANSLATOR không hỗ trợ → lỗi', () => {
    env({ TRANSLATOR: 'bing' });
    expect(() => getTranslator()).toThrow('TRANSLATOR "bing" chưa được hỗ trợ');
  });
});
