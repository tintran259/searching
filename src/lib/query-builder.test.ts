import { describe, expect, it } from 'vitest';
import {
  buildExpansionQuery,
  buildLocalQuery,
  buildNameVariants,
  buildQueryPlan,
  buildSearchQuery,
  cleanPhrase,
  hasMeaningfulOptional,
  optionalWords,
  removeDiacritics,
  searchLocaleFor,
  withTranslations,
} from './query-builder';

describe('removeDiacritics', () => {
  it.each([
    ['Trần Văn A', 'Tran Van A'],
    ['Đặng Thị Đào', 'Dang Thi Dao'],
    ['Nguyễn Ánh Dương', 'Nguyen Anh Duong'],
    ['Lê Thị Thuỷ', 'Le Thi Thuy'],
    ['Trần Văn A'.normalize('NFD'), 'Tran Van A'],
  ])('%s → %s', (input, expected) => {
    expect(removeDiacritics(input)).toBe(expected);
  });
});

describe('cleanPhrase', () => {
  it('bỏ ngoặc kép (cả ngoặc cong), gộp khoảng trắng, chuyển NFC', () => {
    expect(cleanPhrase('  "Trần   Văn A"  ')).toBe('Trần Văn A');
    expect(cleanPhrase('“Trần Văn A”')).toBe('Trần Văn A');
    expect(cleanPhrase('Trần Văn A'.normalize('NFD'))).toBe('Trần Văn A'.normalize('NFC'));
  });
});

describe('buildNameVariants', () => {
  it('tên 3 chữ: cụm gốc, bỏ dấu, hai kiểu đảo thứ tự', () => {
    expect(buildNameVariants('Trần Văn A')).toEqual(['Trần Văn A', 'Tran Van A', 'A Tran Van', 'Van A Tran']);
  });

  it('tên 4 chữ', () => {
    expect(buildNameVariants('Nguyễn Thị Minh Khai')).toEqual([
      'Nguyễn Thị Minh Khai',
      'Nguyen Thi Minh Khai',
      'Khai Nguyen Thi Minh',
      'Thi Minh Khai Nguyen',
    ]);
  });

  it('tên 2 chữ: hai kiểu đảo trùng nhau thì chỉ giữ một', () => {
    expect(buildNameVariants('Nguyễn Du')).toEqual(['Nguyễn Du', 'Nguyen Du', 'Du Nguyen']);
  });

  it('một từ: không đảo; cụm đã không dấu: không lặp', () => {
    expect(buildNameVariants('Vingroup')).toEqual(['Vingroup']);
    expect(buildNameVariants('Tran Van A')).toEqual(['Tran Van A', 'A Tran Van', 'Van A Tran']);
  });

  it('cụm dài hơn 5 từ: chỉ thêm bản bỏ dấu', () => {
    expect(buildNameVariants('biến đổi khí hậu ở đồng bằng sông Cửu Long')).toEqual([
      'biến đổi khí hậu ở đồng bằng sông Cửu Long',
      'bien doi khi hau o dong bang song Cuu Long',
    ]);
  });
});

describe('optionalWords', () => {
  it('tách theo từ, bỏ hư từ tiếng Việt, giữ chữ cái viết hoa đứng riêng', () => {
    expect(optionalWords(['Chuyến thăm ABC của thủ tướng'])).toEqual(['Chuyến', 'thăm', 'ABC', 'thủ', 'tướng']);
    expect(optionalWords(['Trần Văn A'])).toEqual(['Trần', 'Văn', 'A']);
    expect(optionalWords(['(ABC), abc! của'])).toEqual(['ABC']);
  });

  it('hư từ theo ngôn ngữ của nhóm: "an", "to" là từ có nghĩa trong tiếng Việt', () => {
    expect(optionalWords(['an toàn giao thông'])).toEqual(['an', 'toàn', 'giao', 'thông']);
    expect(optionalWords(['the visit of an ABC delegation to Hanoi'], 'en')).toEqual(['visit', 'ABC', 'delegation', 'Hanoi']);
  });

  it('chữ viết liền (Trung, Thái…) được tách từ bằng từ điển', () => {
    expect(optionalWords(['总理访问老挝'], 'zh-CN')).toEqual(['总理', '访问', '老挝']);
    expect(optionalWords(['การเยือนลาวของนายกรัฐมนตรี'], 'th')).toEqual(['เยือน', 'ลาว', 'นายก', 'รัฐมนตรี']);
  });
});

const term = (text: string, variants = [text]) => ({ text, variants });

describe('buildQueryPlan / buildSearchQuery', () => {
  it('cụm trong dấu ` là từ khoá chính (bắt buộc); lên Google thì bọc ngoặc kép', () => {
    expect(buildQueryPlan('`Trần Văn A`', 'domestic')).toEqual({
      phrase: '`Trần Văn A`',
      groups: [{ language: 'vi', terms: [term('Trần Văn A')], optional: [], searchQuery: '"Trần Văn A"' }],
    });
  });

  it('không đánh dấu gì: tìm liên quan, không có từ khoá bắt buộc, truy vấn không ngoặc kép', () => {
    expect(buildQueryPlan('Chuyến thăm ABC của thủ tướng', 'domestic')).toEqual({
      phrase: 'Chuyến thăm ABC của thủ tướng',
      groups: [
        {
          language: 'vi',
          terms: [],
          optional: ['Chuyến thăm ABC của thủ tướng'],
          searchQuery: 'Chuyến thăm ABC của thủ tướng',
        },
      ],
    });
  });

  it('đánh dấu một phần: phần đó bắt buộc, phần còn lại là từ phụ', () => {
    const plan = buildQueryPlan('Chuyến thăm `ABC` của thủ tướng', 'domestic');
    expect(plan.phrase).toBe('Chuyến thăm `ABC` của thủ tướng');
    expect(plan.groups[0]).toEqual({
      language: 'vi',
      terms: [term('ABC')],
      optional: ['Chuyến thăm', 'của thủ tướng'],
      searchQuery: '"ABC" Chuyến thăm của thủ tướng',
    });
  });

  it('Ngoài nước: OR các biến thể và loại báo trong nước ngay trong truy vấn', () => {
    const plan = buildQueryPlan('`Trần Văn A`', 'foreign');
    const { searchQuery, terms } = plan.groups[0];
    expect(terms[0].variants).toHaveLength(4);
    expect(searchQuery.startsWith('"Trần Văn A" OR "Tran Van A" OR "A Tran Van" OR "Van A Tran" -site:vn')).toBe(true);
    expect(searchQuery).toContain('-site:vnexpress.net');
    expect(searchQuery).toContain('-site:baomoi.com');
    expect(searchQuery).not.toMatch(/-site:\S+\.vn\b/);
  });

  it('nhiều từ khoá bắt buộc: mỗi từ khoá một nhóm OR trong ngoặc', () => {
    const plan = buildQueryPlan('`Trần Văn A` thăm `Nguyễn Du`', 'foreign');
    expect(plan.groups[0].searchQuery).toMatch(
      /^\("Trần Văn A" OR "Tran Van A" OR "A Tran Van" OR "Van A Tran"\) \("Nguyễn Du" OR "Nguyen Du" OR "Du Nguyen"\) thăm -site:vn /,
    );
  });

  it('truy vấn không vượt quá 32 từ', () => {
    const query = buildSearchQuery([term('x', buildNameVariants('Nguyễn Hoàng Minh Thanh Tâm'))], [], 'foreign');
    expect(query.split(/\s+/).length).toBeLessThanOrEqual(32);
    expect(query).toContain('-site:vn');
    const long = buildSearchQuery([], ['một hai ba bốn năm sáu bảy tám chín mười '.repeat(5)], 'domestic');
    expect(long.split(/\s+/)).toHaveLength(32);
  });

  it('báo lỗi khi từ khoá trống', () => {
    expect(() => buildQueryPlan(' `` ', 'domestic')).toThrow();
  });

  it('locale theo phạm vi và ngôn ngữ', () => {
    expect(searchLocaleFor('domestic')).toEqual({ country: 'vn', language: 'vi' });
    expect(searchLocaleFor('foreign').country).not.toBe('vn');
    expect(searchLocaleFor('foreign', 'ru')).toEqual({ country: 'ru', language: 'ru', onlyLanguage: 'ru' });
    expect(searchLocaleFor('foreign', 'my')).toEqual({ country: 'mm', language: 'my', onlyLanguage: 'my' });
    expect(searchLocaleFor('foreign', 'zh-CN')).toEqual({ country: 'cn', language: 'zh-cn', onlyLanguage: 'zh-CN' });
    // Trong nước vẫn gl=vn để tìm bản tiếng nước ngoài của báo Việt Nam
    expect(searchLocaleFor('domestic', 'en')).toEqual({ country: 'vn', language: 'en', onlyLanguage: 'en' });
  });
});

describe('buildLocalQuery', () => {
  const group = (terms: string[][], optional: string[] = []) => ({
    language: 'ru',
    terms: terms.map((variants) => term(variants[0], variants)),
    optional,
    searchQuery: '',
  });

  it('một từ khoá: nối các biến thể bằng OR của từng engine, không có -site:', () => {
    expect(buildLocalQuery(group([['Чан Ван А', 'Чан Ван Ань']]), 'yandex')).toBe('"Чан Ван А" | "Чан Ван Ань"');
    expect(buildLocalQuery(group([['진반아', '쩐반아']]), 'naver')).toBe('"진반아" OR "쩐반아"');
  });

  it('nhiều từ khoá hoặc có từ phụ: mỗi từ khoá lấy biến thể đầu; tìm liên quan chỉ có từ phụ', () => {
    expect(buildLocalQuery(group([['陈文A', '陈文阿'], ['ABC']], ['访问']), 'baidu')).toBe('"陈文A" "ABC" 访问');
    expect(buildLocalQuery(group([], ['总理访问老挝']), 'baidu')).toBe('总理访问老挝');
  });
});

describe('withTranslations', () => {
  const translations = [
    { language: 'en', terms: [['Tran Van A', 'A Tran Van']], optional: [] },
    { language: 'ru', terms: [['Чан Ван А', ' "Чан  Ван А" ']], optional: [] },
    { language: 'zh-CN', terms: [['陈文A']], optional: [] },
    { language: 'th', terms: [[]], optional: [] },
  ];

  it('thêm một nhóm truy vấn cho mỗi ngôn ngữ; bản dịch thiếu từ khoá bắt buộc thì bỏ', () => {
    const plan = withTranslations(buildQueryPlan('`Trần Văn A`', 'domestic'), translations, 'domestic');
    expect(plan.groups.map((g) => [g.language, g.terms.map((t) => t.variants), g.searchQuery])).toEqual([
      ['vi', [['Trần Văn A']], '"Trần Văn A"'],
      ['en', [['Tran Van A', 'A Tran Van']], '"Tran Van A" OR "A Tran Van"'],
      ['ru', [['Чан Ван А']], '"Чан Ван А"'],
      ['zh-CN', [['陈文A']], '"陈文A"'],
    ]);
  });

  it('Ngoài nước: vẫn loại báo trong nước ngay trong truy vấn của bản dịch', () => {
    const plan = withTranslations(buildQueryPlan('`Trần Văn A`', 'foreign'), translations, 'foreign');
    expect(plan.groups.map((g) => g.language)).toEqual(['vi', 'en', 'ru', 'zh-CN']);
    expect(plan.groups[2].searchQuery).toMatch(/^"Чан Ван А" -site:vn -site:vnexpress\.net/);
  });

  it('nhiều ngôn ngữ cùng một cách viết vẫn tìm riêng (mỗi nước một Google, một bộ lọc ngôn ngữ)', () => {
    const same = [
      { language: 'en', terms: [['Tran Van A']], optional: [] },
      { language: 'de', terms: [['Tran Van A']], optional: [] },
    ];
    const plan = withTranslations(buildQueryPlan('`Trần Văn A`', 'foreign'), same, 'foreign');
    expect(plan.groups.map((g) => g.language)).toEqual(['vi', 'en', 'de']);
  });

  it('từ khoá bắt buộc và từ phụ được dịch riêng; tìm liên quan thì nhóm dịch chỉ có từ phụ', () => {
    const mixed = withTranslations(
      buildQueryPlan('Chuyến thăm `ABC` của thủ tướng', 'domestic'),
      [
        { language: 'en', terms: [['ABC']], optional: ["Prime Minister's visit"] },
        { language: 'ru', terms: [['ABC'], ['thừa']], optional: [] },
      ],
      'domestic',
    );
    expect(mixed.groups[1]).toEqual({
      language: 'en',
      terms: [term('ABC')],
      optional: ["Prime Minister's visit"],
      searchQuery: '"ABC" Prime Minister\'s visit',
    });
    expect(mixed.groups).toHaveLength(2); // bản tiếng Nga sai số từ khoá → bỏ

    const loose = withTranslations(
      buildQueryPlan('Chuyến thăm ABC của thủ tướng', 'domestic'),
      [
        { language: 'en', terms: [], optional: ["Prime Minister's visit to ABC"] },
        { language: 'de', terms: [], optional: [] },
      ],
      'domestic',
    );
    expect(loose.groups.map((g) => [g.language, g.terms, g.searchQuery])).toEqual([
      ['vi', [], 'Chuyến thăm ABC của thủ tướng'],
      ['en', [], "Prime Minister's visit to ABC"],
    ]);
  });
});

describe('nhóm OR, cụm loại trừ, mục Tin tức, từ phụ quá chung', () => {
  it('`Bỉ | Brussels`: mỗi lựa chọn là một biến thể của cùng từ khoá', () => {
    const plan = buildQueryPlan('`Tô Lâm` `Bỉ | Brussels`', 'domestic', { exclude: ['bóng đá'] });
    expect(plan.groups[0].terms).toEqual([term('Tô Lâm'), { text: 'Bỉ | Brussels', variants: ['Bỉ', 'Brussels'] }]);
    expect(plan.groups[0].searchQuery).toBe('"Tô Lâm" ("Bỉ" OR "Brussels") -"bóng đá"');
  });

  it('mục Tin tức của Google không dùng được site: → không thêm -site:', () => {
    const terms = [term('To Lam')];
    expect(buildSearchQuery(terms, [], 'foreign')).toMatch(/^"To Lam" -site:vn /);
    expect(buildSearchQuery(terms, [], 'foreign', { vertical: 'news' })).toBe('"To Lam"');
  });

  it('từ phụ chỉ gồm từ quá chung ("đi", "về") thì không đáng dịch', () => {
    expect(hasMeaningfulOptional(['đi'])).toBe(false);
    expect(hasMeaningfulOptional(['đi về'])).toBe(false);
    expect(hasMeaningfulOptional(['thăm chính thức'])).toBe(true);
  });
});

describe('cách gọi khác (gợi ý)', () => {
  const expansions = [{ term: 'Tô Lâm', alternatives: ['Chủ tịch nước Việt Nam'] }];

  it('gộp vào truy vấn chính bằng OR (không tốn thêm lượt); có truy vấn riêng chỉ bằng cách gọi khác', () => {
    const plan = buildQueryPlan('`Tô Lâm` `Bỉ`', 'domestic', { expansions });
    const [tolam] = plan.groups[0].terms;
    expect(tolam).toEqual({ text: 'Tô Lâm', variants: ['Tô Lâm', 'Chủ tịch nước Việt Nam'], expansions: ['Chủ tịch nước Việt Nam'] });
    expect(plan.groups[0].searchQuery).toBe('("Tô Lâm" OR "Chủ tịch nước Việt Nam") "Bỉ"');
    expect(buildExpansionQuery(plan.groups[0].terms, [], 'domestic')).toBe('"Chủ tịch nước Việt Nam" "Bỉ"');
    expect(buildExpansionQuery(buildQueryPlan('`Tô Lâm`', 'domestic').groups[0].terms, [], 'domestic')).toBeNull();
  });

  it('Ngoài nước: thêm bản không dấu, không đảo thứ tự chức danh như tên người', () => {
    const [tolam] = buildQueryPlan('`Tô Lâm`', 'foreign', { expansions }).groups[0].terms;
    expect(tolam.expansions).toEqual(['Chủ tịch nước Việt Nam', 'Chu tich nuoc Viet Nam']);
  });

  it('truy vấn quá dài thì không gộp cách gọi khác vào truy vấn chính', () => {
    const many = [{ term: 'Tô Lâm', alternatives: ['Tổng Bí thư Đảng Cộng sản Việt Nam', 'Chủ tịch nước Cộng hòa xã hội chủ nghĩa Việt Nam', 'Bí thư Quân ủy Trung ương', 'Chủ tịch nước Việt Nam'] }];
    const plan = buildQueryPlan('`Tô Lâm` `Bỉ`', 'domestic', { expansions: many });
    expect(plan.groups[0].searchQuery).toBe('"Tô Lâm" "Bỉ"');
  });

  it('bản dịch của cách gọi khác được đánh dấu riêng trong nhóm ngôn ngữ', () => {
    const plan = withTranslations(
      buildQueryPlan('`Tô Lâm`', 'foreign', { expansions }),
      [{ language: 'en', terms: [['To Lam']], termExpansions: [['President of Vietnam']], optional: [] }],
      'foreign',
    );
    expect(plan.groups[1].terms[0]).toEqual({
      text: 'To Lam',
      variants: ['To Lam', 'President of Vietnam'],
      expansions: ['President of Vietnam'],
    });
    expect(plan.groups[1].searchQuery).toMatch(/^"To Lam" OR "President of Vietnam" -site:vn/);
  });
});
