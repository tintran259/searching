import { describe, expect, it } from 'vitest';
import { PhraseMatcher, buildPhraseRegex, containsPhrase, makeSnippet, normalizeText } from './matcher';

const NAME = 'Trần Văn A';
const nfd = (s: string) => s.normalize('NFD');

describe('containsPhrase — khớp chính xác cả cụm', () => {
  it.each([
    'Trần Văn A',
    'Hôm qua, ông Trần Văn A cho biết dự án đã hoàn thành.',
    'Ảnh: (Trần Văn A)',
    'Trần Văn A, giám đốc sở, phát biểu.',
    '…theo phát biểu của Trần Văn A.',
    '"Trần Văn A" là ai?',
    'Ông Trần Văn A-người được giải',
  ])('khớp: %s', (text) => {
    expect(containsPhrase(text, NAME)).toBe(true);
  });

  it.each([
    'Trần Văn An',
    'Trần Văn Anh',
    'ông Trần Văn Anh cho biết',
    'TRẦN VĂN ANH',
    'Trần Văn A1',
    'Trần Văn Á',
    'Trần Văn Ân',
    'XTrần Văn A',
  ])('không khớp tên dài hơn / tên khác: %s', (text) => {
    expect(containsPhrase(text, NAME)).toBe(false);
  });

  it.each([
    'Trần Văn',
    'Trần, Văn A',
    'Trần Thị Văn A',
    'Văn A Trần',
    'A Trần Văn',
    'Ông Trần đi cùng anh Văn A',
  ])('không khớp khi từ rời rạc / sai thứ tự: %s', (text) => {
    expect(containsPhrase(text, NAME)).toBe(false);
  });

  it('không phân biệt hoa thường', () => {
    expect(containsPhrase('ÔNG TRẦN VĂN A PHÁT BIỂU', NAME)).toBe(true);
    expect(containsPhrase('ông trần văn a phát biểu', NAME)).toBe(true);
    expect(containsPhrase('Ông Trần Văn A', 'TRẦN VĂN A')).toBe(true);
  });

  it('văn bản dạng NFD vẫn khớp, NFD "Trần Văn Anh" vẫn không khớp', () => {
    const text = nfd('Ông Trần Văn A nói');
    expect(text).not.toBe(text.normalize('NFC'));
    expect(containsPhrase(text, NAME)).toBe(true);
    expect(containsPhrase(nfd('Ông Trần Văn Anh nói'), NAME)).toBe(false);
    expect(containsPhrase(nfd('TRẦN VĂN A'), NAME)).toBe(true);
  });

  it('cụm từ người dùng nhập ở dạng NFD vẫn khớp văn bản NFC', () => {
    expect(containsPhrase('Ông Trần Văn A nói', nfd(NAME))).toBe(true);
  });

  it('NFD "Trần Văn Á" (A + dấu sắc rời) không bị coi là "Trần Văn A"', () => {
    expect(containsPhrase(nfd('Trần Văn Á'), NAME)).toBe(false);
  });

  it('dấu kết hợp không gộp được sau NFC cũng chặn ranh giới từ', () => {
    // U+0331 (gạch dưới) không có dạng dựng sẵn với "A" nên vẫn rời sau NFC
    expect(containsPhrase('Trần Văn A̱', NAME)).toBe(false);
  });

  it('chấp nhận mọi khoảng trắng giữa các từ: nhiều dấu cách, NBSP, xuống dòng', () => {
    expect(containsPhrase('Trần  Văn   A', NAME)).toBe(true);
    expect(containsPhrase('Trần Văn A', NAME)).toBe(true);
    expect(containsPhrase('Trần Văn\nA', NAME)).toBe(true);
  });

  it('bỏ qua ký tự vô hình chèn giữa chữ', () => {
    expect(containsPhrase('Tr­ần Văn​ A', NAME)).toBe(true);
  });

  it('chấp nhận "Ð" (U+00D0) bị gõ nhầm thay cho "Đ"', () => {
    expect(containsPhrase('Ông Ðặng Văn B', 'Đặng Văn B')).toBe(true);
  });

  it('coi hai kiểu đặt dấu thanh là một (Thuý/Thúy, Hoà/Hòa, Khoẻ/Khỏe)', () => {
    expect(containsPhrase('Bà Nguyễn Thị Thúy cho biết', 'Nguyễn Thị Thuý')).toBe(true);
    expect(containsPhrase('Bà Nguyễn Thị Thuý cho biết', 'Nguyễn Thị Thúy')).toBe(true);
    expect(containsPhrase('Lê Văn Hoà', 'Lê Văn Hòa')).toBe(true);
    expect(containsPhrase('Đỗ Khỏe', 'Đỗ Khoẻ')).toBe(true);
    // âm tiết có phụ âm cuối không bị đổi → vẫn phân biệt Hoà / Hoàng
    expect(containsPhrase('Lê Văn Hoàng', 'Lê Văn Hoà')).toBe(false);
  });

  it('escape ký tự đặc biệt của regex trong cụm', () => {
    expect(containsPhrase('Ngôn ngữ C++ rất nhanh', 'C++')).toBe(true);
    expect(containsPhrase('Ngôn ngữ C+++', 'C++')).toBe(true);
    expect(containsPhrase('Công ty A.B', 'A.B')).toBe(true);
    // "." phải được escape, không được khớp ký tự bất kỳ
    expect(containsPhrase('Công ty AxB', 'A.B')).toBe(false);
  });
});

describe('containsPhrase — bản dịch / phiên âm sang ngôn ngữ khác', () => {
  it('hệ chữ không có dấu cách (Hán, Kana, Thái, Lào, Khmer, Hangul): khớp cả khi dính liền chữ khác', () => {
    expect(containsPhrase('记者陈文安表示，项目已经完成', '陈文安')).toBe(true);
    expect(containsPhrase('ベトナムのグエン・ヴァン・アン氏は', 'グエン・ヴァン・アン')).toBe(true);
    expect(containsPhrase('นายตรัน วัน อา กล่าวว่า', 'ตรัน วัน อา')).toBe(true);
    expect(containsPhrase('쩐반아가 말했다', '쩐반아')).toBe(true);
    expect(containsPhrase('ທ່ານ ເຈີ່ນ ວັນ ອາ ກ່າວວ່າ', 'ເຈີ່ນ ວັນ ອາ')).toBe(true);
  });

  it('chữ Latin đứng cạnh chữ Hán vẫn được coi là hết từ', () => {
    expect(containsPhrase('记者陈文A表示', '陈文A')).toBe(true);
  });

  it('chữ Kirin: không phân biệt hoa thường, vẫn chặn tên dài hơn', () => {
    expect(containsPhrase('ЧАН ВАН А заявил', 'Чан Ван А')).toBe(true);
    expect(containsPhrase('Чан Ван Ань заявил', 'Чан Ван А')).toBe(false);
  });
});

describe('buildPhraseRegex', () => {
  it('dùng ranh giới từ Unicode và cờ iu', () => {
    const re = buildPhraseRegex(NAME);
    expect(re.flags).toBe('iu');
    expect(re.test(normalizeText('Ông TRẦN VĂN A'))).toBe(true);
    expect(re.test(normalizeText('Ông Trần Văn An'))).toBe(false);
  });

  it('báo lỗi với cụm rỗng', () => {
    expect(() => buildPhraseRegex('   ')).toThrow();
    expect(() => new PhraseMatcher(['', ' '])).toThrow();
  });
});

describe('PhraseMatcher', () => {
  it('trả về biến thể, đoạn khớp gốc và vị trí', () => {
    const m = new PhraseMatcher([NAME]).find('Hôm nay TRẦN VĂN A đã đến.');
    expect(m).not.toBeNull();
    expect(m!.variant).toBe(NAME);
    expect(m!.matchedText).toBe('TRẦN VĂN A');
    expect(m!.index).toBe(8);
  });

  it('khớp bất kỳ biến thể nào (phạm vi Ngoài nước)', () => {
    const matcher = new PhraseMatcher(['Trần Văn A', 'Tran Van A', 'A Tran Van', 'Van A Tran']);
    expect(matcher.find('Mr. A Tran Van, a Vietnamese engineer')?.variant).toBe('A Tran Van');
    expect(matcher.find('said Van A Tran.')?.variant).toBe('Van A Tran');
    expect(matcher.find('TRAN VAN A spoke')?.variant).toBe('Tran Van A');
    expect(matcher.find('Mr. Tran Van Anh and Van A Tranh')).toBeNull();
  });

  it('chọn lần xuất hiện sớm nhất giữa các biến thể', () => {
    const matcher = new PhraseMatcher(['Trần Văn A', 'Tran Van A']);
    expect(matcher.find('Tran Van A (Trần Văn A)')?.variant).toBe('Tran Van A');
  });

  it('findAll trả mọi vị trí khớp của mọi biến thể (để tô sáng), đã gộp chồng lấn', () => {
    const matcher = new PhraseMatcher(['Trần Văn A', 'Tran Van A', 'Văn A']);
    const text = 'TRẦN VĂN A gặp Tran Van A, không phải Trần Văn An.';
    expect(matcher.findAll(text).map((r) => text.slice(r.start, r.end))).toEqual(['TRẦN VĂN A', 'Tran Van A']);
    expect(matcher.findAll('')).toEqual([]);
  });

  it('tiếng Nga: chấp nhận đuôi biến cách ở từ cuối, vẫn phân biệt tên dài hơn', () => {
    const name = new PhraseMatcher(['То Лам'], { inflection: 'ru' });
    for (const text of ['визит То Лама в Москву', 'встреча с То Ламом', 'передал То Ламу', 'о То Ламе', 'То Лам заявил']) {
      expect(name.find(text), text).not.toBeNull();
    }
    expect(name.find('То Ламберт')).toBeNull();
    expect(new PhraseMatcher(['То Лам']).find('визит То Лама')).toBeNull(); // không bật biến cách → khớp chặt như cũ
    // Từ cuối quá ngắn (1–2 chữ cái) thì không biến cách: "Чан Ван А" ≠ "Чан Ван Ань"
    expect(new PhraseMatcher(['Чан Ван А'], { inflection: 'ru' }).find('Чан Ван Ань сказал')).toBeNull();
    // Từ kết thúc bằng -а / -я đổi đuôi
    const denmark = new PhraseMatcher(['Дания'], { inflection: 'ru' });
    expect(denmark.find('визит в Данию')?.matchedText).toBe('Данию');
    expect(denmark.find('в Дании')?.matchedText).toBe('Дании');
    expect(name.findAll('То Лама и То Ламу').length).toBe(2);
    // Từ liên quan so theo gốc từ: Данию ~ Дании, визит ~ визиту; gốc quá ngắn thì giữ nguyên
    const related = (w: string) => new PhraseMatcher([w], { inflection: 'ru-stem' });
    expect(related('Данию').find('в Дании')?.matchedText).toBe('Дании');
    expect(related('визит').find('к визиту')?.matchedText).toBe('визиту');
    expect(related('мир').find('мировой')).toBeNull();
  });

  it('findLongerName chỉ ra tên dài hơn để giải thích lý do loại', () => {
    const matcher = new PhraseMatcher([NAME]);
    expect(matcher.findLongerName('Ông Trần Văn Anh, giám đốc')).toBe('Trần Văn Anh');
    expect(matcher.findLongerName('Không có gì')).toBeNull();
  });
});

describe('makeSnippet', () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `từ${i}`).join(' ');

  it('cắt khoảng 200 ký tự quanh vị trí khớp và đánh dấu đúng vị trí', () => {
    const text = `${filler(80)} Trần Văn A ${filler(80)}`;
    const m = new PhraseMatcher([NAME]).find(text)!;
    const { text: snippet, highlightStart, highlightEnd } = m.snippet;
    expect(snippet.slice(highlightStart, highlightEnd)).toBe(NAME);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeGreaterThan(150);
    expect(snippet.length).toBeLessThanOrEqual(202);
    // không cắt giữa từ
    expect(snippet).toMatch(/^…từ\d+ /);
    expect(snippet).toMatch(/ từ\d+…$/);
  });

  it('không thêm "…" khi văn bản ngắn, gộp khoảng trắng và xuống dòng', () => {
    const text = 'Ông\n\nTrần Văn A   phát biểu';
    const s = makeSnippet(text, 5, 10);
    expect(s.text).toBe('Ông Trần Văn A phát biểu');
    expect(s.text.slice(s.highlightStart, s.highlightEnd)).toBe('Trần Văn A');
  });

  it('cụm khớp ở đầu hoặc cuối văn bản', () => {
    const head = makeSnippet(`Trần Văn A ${filler(100)}`, 0, 10);
    expect(head.highlightStart).toBe(0);
    expect(head.text.endsWith('…')).toBe(true);
    const text = `${filler(100)} Trần Văn A`;
    const tail = makeSnippet(text, text.length - 10, 10);
    expect(tail.text.slice(tail.highlightStart, tail.highlightEnd)).toBe('Trần Văn A');
    expect(tail.text.endsWith('Trần Văn A')).toBe(true);
  });
});
