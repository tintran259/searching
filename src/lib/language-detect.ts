/**
 * Nhận biết văn bản viết bằng tiếng Việt (để "Ngoài nước" không nhận bài tiếng Việt của báo Việt Nam
 * đặt trên tên miền nước ngoài, và để xếp bài đăng mạng xã hội vào đúng phạm vi).
 *
 * Chỉ đếm các chữ có dấu riêng của tiếng Việt (ă, đ, ơ, ư và nguyên âm mang dấu thanh như ạ, ế, ổ…).
 * Không đếm â, ê, ô, à, é… vì tiếng Pháp, Bồ Đào Nha… cũng có. Văn bản tiếng Việt thường có khoảng
 * một nửa số từ chứa các chữ này; bài tiếng Anh chỉ nhắc vài tên riêng (Tô Lâm, Nguyễn Văn A) thì rất ít.
 */

const VIETNAMESE_ONLY = /[ăđơưĩũạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/iu;
/** Tỉ lệ từ (chữ Latin) có chữ riêng của tiếng Việt để coi là văn bản tiếng Việt */
const MIN_RATIO = 0.2;
/** Chỉ xét chừng này từ đầu tiên là đủ */
const MAX_WORDS = 3000;

export function isVietnameseText(text: string): boolean {
  const words = (text.normalize('NFC').match(/[\p{Script=Latin}\p{M}]+/gu) ?? []).slice(0, MAX_WORDS);
  if (words.length === 0) return false;
  const vietnamese = words.filter((w) => VIETNAMESE_ONLY.test(w)).length;
  return vietnamese / words.length >= MIN_RATIO;
}
