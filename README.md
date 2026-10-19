# Dò bài viết theo cụm từ

Web app (MVP) tìm và thu thập link bài viết, bài báo nhắc tới một người hoặc một sự kiện, xếp từ bài **cũ nhất** đến mới nhất.

- Tìm qua SerpApi (Google; thêm Baidu / Yandex / Naver khi tìm báo nước ngoài). Mỗi **nguồn** (tiếng Việt, từng ngôn ngữ dịch, từng công cụ địa phương) lấy tối đa N kết quả trên cả khoảng ngày đã chọn, và có **báo cáo theo ngôn ngữ** cho biết mỗi nguồn tìm được bao nhiêu bài, vì sao thiếu.
- **Ô tìm kiếm có từ khoá chính:** bôi đen một phần (vd tên người), popup hiện ra ngay dưới chỗ bôi đen, bấm **"Đặt làm từ khoá chính"**. Từ khoá chính phải có **nguyên văn, liền nhau** trong bài: "Trần Văn A" không khớp "Trần Văn An" hay "Trần Văn Anh". Bài còn phải có **ít nhất một nửa số từ còn lại** (nội dung liên quan, không cần đúng thứ tự). Không có từ khoá chính thì app **tìm bài liên quan** (bài có phần lớn các từ đã nhập). Từ khoá chính hiển thị **đậm, màu nhấn** ngay trong ô nhập. Gõ tay thì đặt từ khoá chính giữa hai dấu huyền `` ` `` (dấu này không hiện trong ô, phần giữa hai dấu tự đậm lên).
- Tải từng trang về server để xác minh lại theo đúng quy tắc trên, chỉ xét nội dung chính của bài.
- Phạm vi **Trong nước / Ngoài nước** phân loại theo `src/config/sources.ts`.
- Trích ngày đăng theo 6 bước và ghi rõ **nguồn ngày** để biết độ tin cậy.
- **Tìm thêm bằng ngôn ngữ khác:** chỉ cần nhập từ khoá tiếng Việt, app tự dịch hoặc phiên âm sang tiếng Anh, Đức, Nga, Trung, Thái, Lào, các nước Đông Nam Á… rồi tìm theo từng thứ tiếng, bằng Google của nước đó (và Baidu / Yandex / Naver cho tiếng Trung / Nga / Hàn khi tìm Ngoài nước).
- Tiến trình hiển thị trực tiếp (Server-Sent Events). Xuất **Excel** (2 sheet: kết quả và bị loại) và **CSV**. Có danh sách **bị loại kèm lý do** để kiểm tra.

## Yêu cầu

- Node.js `^20.19`, `^22.12` hoặc `>=24` (đã chạy thử trên Node 22.22)
- API key [SerpApi](https://serpapi.com/manage-api-key)
- (Tuỳ chọn, để tìm bằng ngôn ngữ khác) API key [Gemini](https://aistudio.google.com/apikey) (có gói miễn phí) **hoặc** [Anthropic](https://console.anthropic.com/) (trả theo lượng dùng)

## Cài đặt và chạy

```bash
npm install
cp .env.example .env.local   # điền SERPAPI_KEY (và GEMINI_API_KEY nếu muốn dịch, miễn phí)
npm run dev                  # mở http://localhost:3000
```

Chạy bản production: `npm run build && npm start`.

### SEO của trang

`metadata` trong `src/app/layout.tsx` (tiêu đề, mô tả, Open Graph, Twitter card, canonical, theme color), ảnh xem trước `src/app/opengraph-image.png` / `twitter-image.png` (1200×630), `robots.ts` (chặn `/api/`), `sitemap.ts`, `manifest.ts` và JSON-LD `WebApplication` trong `page.tsx`. URL tuyệt đối lấy từ `SITE_URL` nếu đặt (tên miền riêng), không thì tên miền production của Vercel (`src/lib/site.ts`).

### Deploy

1. Node `^20.19`, `^22.12` hoặc `>=24`. Cài bằng `npm ci` (theo `package-lock.json`).
2. Đặt biến môi trường trên máy chủ (không đưa `.env.local` lên): bắt buộc `SERPAPI_KEY`; nên có `GEMINI_API_KEY` (hoặc `ANTHROPIC_API_KEY`) để tìm Ngoài nước; tuỳ chọn `AZURE_TRANSLATOR_KEY` / `AZURE_TRANSLATOR_REGION` làm bộ dịch dự phòng.
3. Kiểm tra trước khi build: `npm run typecheck && npm run lint && npm test` (`typecheck` chạy `next typegen` trước `tsc` nên chạy được trên bản checkout sạch).
4. `npm run build && npm start` (mặc định cổng 3000, đổi bằng `-p`).
5. Cache mặc định ghi file vào `./.cache` — máy chủ phải ghi được thư mục này. Trên nền tảng serverless (ổ đĩa chỉ đọc / không giữ giữa các lần chạy) đặt `CACHE_DIR=/tmp/...` hoặc `CACHE_MODE=memory`.
6. `/api/search` trả Server-Sent Events, một lượt tìm có thể kéo dài 1–2 phút: proxy / nền tảng phía trước phải cho phép response dài và không gom (buffer) SSE.
7. **Vercel:** `vercel.json` chọn vùng `sin1` (Singapore, gần báo Việt Nam / Đông Nam Á). Route `/api/search` đặt `maxDuration = 300` (tối đa của gói Hobby; gói Pro cho tới 800s) và tự dừng gọn ở giây thứ 280, giữ các bài đã tìm được và báo cho người dùng. Cache tự đặt trong `/tmp` (chỉ còn trong lúc instance còn sống, không chia sẻ giữa các instance). Đặt biến môi trường trong Project Settings → Environment Variables.
8. Font (Be Vietnam Pro, JetBrains Mono) được tải từ Google Fonts lúc build; máy build không vào được fonts.googleapis.com thì Next dùng font dự phòng (chỉ cảnh báo, không lỗi).

| Lệnh | Việc |
| --- | --- |
| `npm test` | Unit test (Vitest) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run lint` | ESLint |

### Biến môi trường

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| `SERPAPI_KEY` | có | — | Key SerpApi |
| `GEMINI_API_KEY` | khi dịch | — | Key Gemini API (gói miễn phí) để dịch từ khoá. Tạo ở [Google AI Studio](https://aistudio.google.com/apikey). |
| `AZURE_TRANSLATOR_KEY` | không | — | Key Microsoft Azure Translator (gói F0 miễn phí ~2 triệu ký tự/tháng). Có key này thì Microsoft là **bộ dịch dự phòng** khi Gemini / Claude lỗi hoặc hết lượt; chỉ có key này thì dùng làm bộ dịch chính. |
| `AZURE_TRANSLATOR_REGION` | khi cần | — | Vùng của tài nguyên Translator (vd `southeastasia`); bỏ trống nếu tài nguyên là Global |
| `ANTHROPIC_API_KEY` | khi dịch | — | Thay cho Gemini: key Claude API (trả theo lượng dùng). SDK cũng nhận `ANTHROPIC_AUTH_TOKEN`; nếu dùng profile `ant auth login` thì đặt `TRANSLATOR=claude`. |
| `SITE_URL` | không | tên miền production của Vercel | Địa chỉ gốc của trang dùng cho canonical, og:image, sitemap (vd `https://dobaiviet.vn` khi gắn tên miền riêng) |
| `SEARCH_PROVIDER` | không | `serpapi` | Nhà cung cấp tìm kiếm |
| `TRANSLATOR` | không | tự chọn | `gemini`, `claude`, `microsoft` hoặc `off`. Không đặt thì tự chọn theo key có sẵn: Gemini trước, rồi Claude; không có key nào thì app cảnh báo và chỉ tìm bằng tiếng Việt |
| `GEMINI_MODEL` | không | `gemini-3.8-flash` | Model Gemini dùng để dịch (vd `gemini-3.5-flash-lite` nhanh hơn) |
| `CACHE_MODE` | không | `file` | `file`, `memory` hoặc `off` |
| `CACHE_DIR` | không | `./.cache` | Thư mục cache khi `CACHE_MODE=file` |
| `FETCH_USER_AGENT` | không | `Mozilla/5.0 (compatible; ArticleFinderBot/0.1)` | User-Agent khi tải trang |

## Cách dùng

1. Nhập nội dung cần tìm vào ô tìm kiếm lớn, vd `Chuyến thăm ABC của thủ tướng`. Bôi đen phần bắt buộc phải có nguyên văn (vd `ABC`): popup hiện ngay dưới chỗ bôi đen, bấm **Đặt làm từ khoá chính** (bôi đen lại phần đã là từ khoá chính thì popup đổi thành **Bỏ từ khoá chính**). Trên điện thoại (hoặc không muốn bôi đen): ở dòng "Chạm từ để đặt làm từ khoá chính", mỗi từ là một nút — **chạm một từ** để đặt làm từ khoá chính, **chạm tiếp từ liền kề** để nối thành cụm (chạm "Trần", "Thanh", "Mẫn" → "Trần Thanh Mẫn"); chạm thẻ có ổ khoá để bỏ. Nhập tên người mà chưa đánh dấu thì app gợi ý **"Đây là tên người? Đặt cả tên làm từ khoá chính"**. Xem chi tiết ở [Ô tìm kiếm](#ô-tìm-kiếm-từ-khoá-chính-và-tìm-liên-quan-srclibquery-syntaxts).
2. Chọn **Phạm vi**: Trong nước (báo Việt Nam, chỉ tìm bằng tiếng Việt) hoặc Ngoài nước (báo quốc tế). Chọn Ngoài nước thì hiện ngay phần **chọn ngôn ngữ / nước cần tìm** — không chọn sẵn ngôn ngữ nào, phải chọn ít nhất một (có nút "Gợi ý", "Tất cả", "Bỏ chọn hết") — và tuỳ chọn Baidu/Yandex/Naver. Ngoài nước **không tìm bằng tiếng Việt**.
3. Chọn **Thời gian đăng bài** bằng hai ô lịch *Từ ngày* / *Đến ngày* (antd DatePicker, gõ được `dd/mm/yyyy`). Mặc định **từ hôm qua đến hôm nay** (giờ Việt Nam) để tìm bài mới nhất; API không truyền `from` cũng dùng mặc định này.
4. (Tuỳ chọn) Mở **Tuỳ chọn nâng cao** để đổi **số kết quả mỗi ngôn ngữ** (mặc định 10). Mỗi ngôn ngữ được tìm riêng; mỗi lượt tìm trả 10 kết quả và trừ 1 lượt quota SerpApi. Ví dụ Ngoài nước, chọn 6 ngôn ngữ, 10 kết quả mỗi ngôn ngữ: 6 nguồn × 1 lượt = **tối đa 6 lượt, 60 kết quả** (cộng thêm 1 nguồn cho mỗi công cụ Baidu/Yandex/Naver nếu bật và có chọn tiếng Trung/Nga/Hàn). Dưới form có phép tính này cho đúng lựa chọn hiện tại, kèm cảnh báo nếu có thể vượt số lượt còn lại (hiện ở góc phải thanh tiêu đề).
5. Bấm **Tìm bài viết**. Tiến trình hiện trực tiếp ("Đang tìm tiếng nga trên Google (kết quả 1–10 / tối đa 10) · đã kiểm tra Y/Z bài"); bấm **Dừng** để huỷ, các bài đã tìm được vẫn được giữ. Bảng **Báo cáo theo ngôn ngữ** cho từng nguồn: tối đa bao nhiêu, công cụ trả về bao nhiêu, hợp lệ / bị loại / trùng, và ghi chú khi không đủ (vd "Chỉ có 3/10 kết quả: Google không còn kết quả nào khác", "Google không có kết quả nào…", "Có 10 kết quả nhưng không bài nào hợp lệ", "Không dịch được từ khoá sang ngôn ngữ này").
6. Tab **Kết quả** xếp cũ → mới; bấm "Cũ → mới" để đổi chiều. Trong đoạn trích, phần bắt buộc được **tô nền vàng**, các từ còn lại được **gạch chân**; dưới đoạn trích ghi bài có bao nhiêu từ phụ (vd "Có 3/4 từ phụ: chuyến, thăm, thủ"). Bài không xác định được ngày luôn nằm cuối. Ô **Lọc** tìm trong tiêu đề, tên báo và đoạn trích, gõ không dấu cũng được. Trên điện thoại kết quả hiển thị dạng thẻ.
7. Mỗi kết quả có nút **Chi tiết SEO**: tiêu đề SEO (số ký tự, nhắc khi dài hơn 60), tiêu đề chia sẻ (og:title), mô tả (số ký tự, nhắc khi dài hơn 160), ảnh đại diện, tác giả, chuyên mục, từ khoá, canonical, nhà xuất bản, ngôn ngữ, ngày cập nhật, meta robots, số từ — đọc từ thẻ meta, Open Graph / Twitter và JSON-LD của trang (`src/lib/seo-extractor.ts`). Các trường này cũng có trong file Excel / CSV.
8. **Xuất Excel / CSV** theo đúng thứ tự và bộ lọc đang xem. Tab **Bị loại** cho biết bài nào bị loại và vì sao.

## Cách hoạt động

```
từ khoá ─► (Ngoài nước: dịch sang các ngôn ngữ đã chọn)
        ─► tìm lần lượt từng nguồn (tiếng Việt, từng ngôn ngữ, Baidu/Yandex/Naver), tối đa N × 10 kết quả mỗi nguồn
        ─► lọc lần 1 theo URL kết quả: mạng xã hội, phạm vi Trong/Ngoài nước
        ─► tải trang (5 luồng, timeout 10s, robots.txt) ─► jsdom + Readability
        ─► lọc lần 2 theo URL thật sau chuyển hướng
        ─► xác minh trong nội dung chính: có đủ phần bắt buộc (hoặc đủ 60% số từ khi tìm liên quan)
        ─► trích ngày đăng ─► gộp trùng ─► stream SSE về trình duyệt
```

### Ô tìm kiếm: từ khoá chính và tìm liên quan (`src/lib/query-syntax.ts`)

**Phần trong dấu huyền `` ` `` là từ khoá chính** (bắt buộc). Nút "Đặt làm từ khoá chính" trong popup thực chất chỉ thêm dấu `` ` `` quanh phần đã bôi đen (nới ra cho đủ từ, gộp với từ khoá chính đang chạm vào), nên có thể gõ tay trực tiếp. **Ngoặc kép không còn ý nghĩa cú pháp** (được bỏ qua), vì ngoặc kép hay nằm ngay trong nội dung cần tìm (tên sự kiện, trích dẫn). Khi gửi lên Google, app mới bọc từ khoá chính trong ngoặc kép theo cú pháp của Google.

| Nhập | Truy vấn gửi Google | Bài được nhận khi |
| --- | --- | --- |
| `Chuyến thăm ABC của thủ tướng` (không đánh dấu) | `Chuyến thăm ABC của thủ tướng` | có ít nhất **60%** số từ đã nhập, không cần đúng thứ tự, không cần liền nhau |
| ``Chuyến thăm `ABC` của thủ tướng`` | `"ABC" Chuyến thăm của thủ tướng` | có nguyên văn `ABC` **và** ít nhất 50% số từ còn lại (chuyến, thăm, thủ, tướng → cần 2); ghi "Có x/y từ phụ" |
| `` `ABC` `Thủ tướng` `` | `"ABC" "Thủ tướng"` | có đủ **cả hai** cụm |
| `` `Trần Văn A` `` | `"Trần Văn A"` | có đúng cả tên, như bản MVP đầu tiên |

- Từ được tách theo khoảng trắng, nên tiếng Việt tính theo **âm tiết** ("thủ tướng" là 2 từ). Bỏ hư từ ("của", "và", "các"…; danh sách riêng cho từng ngôn ngữ dịch) và chữ cái thường đứng riêng; chữ cái **in hoa** đứng riêng vẫn tính (chữ `A` trong `Trần Văn A`). Chữ viết liền (Trung, Nhật, Thái, Lào, Khmer, Myanmar) được tách từ bằng `Intl.Segmenter` (từ điển ICU).
- Ngưỡng 60% làm tròn lên: 5 từ cần 3, 3 từ cần 2. Đổi ở `LOOSE_MIN_RATIO`.
- Khi tìm bằng ngôn ngữ khác, **mỗi phần bắt buộc được dịch riêng** (giữ nguyên cụm, phiên âm tên), phần còn lại được dịch theo nghĩa thành từ phụ của ngôn ngữ đó.
- Kết quả và file xuất có cột "Từ phụ khớp" (vd `3/4: chuyến, thăm, thủ`). Khi tìm liên quan, đó là số từ đã nhập có trong bài.

### Khớp chính xác phần bắt buộc (`src/lib/matcher.ts`)

- Chuẩn hoá Unicode **NFC** cho cả cụm và nội dung trang (trang có thể dùng dạng NFD).
- Không phân biệt hoa thường, ranh giới từ Unicode: `(?<![\p{L}\p{N}\p{M}])<cụm>(?![\p{L}\p{N}\p{M}])` với cờ `iu`. Giữa các từ chấp nhận mọi khoảng trắng (dấu cách, NBSP, xuống dòng).
- Khi gọi search, mỗi phần bắt buộc được bọc trong ngoặc kép (nhiều biến thể thì nối `OR`).
- Ưu tiên nội dung chính do `@mozilla/readability` lấy ra (cộng tiêu đề và mô tả og). Readability thất bại thì dùng toàn văn. Nếu cụm chỉ có ở menu/sidebar/footer thì bài bị loại với lý do riêng.
- Đoạn trích khoảng 200 ký tự quanh vị trí khớp, không cắt giữa từ. Khi có nhiều chỗ khớp, chọn đoạn chứa nhiều từ khoá nhất (ưu tiên phần bắt buộc). Phần bắt buộc được tô nền, từ phụ được gạch chân; các từ phụ liền nhau gộp thành một vùng.

### Phạm vi Trong nước / Ngoài nước (`src/config/sources.ts`, `src/lib/region.ts`)

`classifyRegion(url)` được dùng cho cả hai bước lọc (URL trên kết quả tìm kiếm và URL thật sau chuyển hướng):

1. Nằm trong `FOREIGN_VIETNAMESE_SOURCES` (bbc.com/vietnamese, voatiengviet.com, rfa.org/vietnamese, sputniknews.vn…): **Ngoài nước**, kể cả khi dùng đuôi .vn.
2. Đuôi `.vn` hoặc có trong `DOMESTIC_SOURCES` (vnexpress.net, baomoi.com…): **Trong nước**.
3. Còn lại: **Ngoài nước**.

| | Trong nước | Ngoài nước |
| --- | --- | --- |
| Tham số Google | `gl=vn`, `hl=vi`, `google.com.vn` | `gl=us`, `hl=en` (nhóm tiếng Việt), hoặc quốc gia + tên miền Google của ngôn ngữ dịch |
| Truy vấn (`` `Trần Văn A` ``) | `"Trần Văn A"` | `"Trần Văn A" OR "Tran Van A" OR "A Tran Van" OR "Van A Tran" -site:vn -site:vnexpress.net …` |
| Xác minh | khớp cụm gốc | mỗi phần bắt buộc khớp **bất kỳ** biến thể nào (có dấu, bỏ dấu, đảo thứ tự); từ phụ khớp cả bản bỏ dấu |

Muốn thêm hay bớt báo, chỉ cần sửa `src/config/sources.ts`.

### Tìm thêm bằng ngôn ngữ khác (`src/config/languages.ts`, `src/lib/translate/`)

1. Từ khoá được dịch một lần cho mọi ngôn ngữ đã chọn bằng một model ngôn ngữ, kết quả JSON theo schema: **Gemini** (`gemini-3.8-flash`, có gói miễn phí) hoặc **Claude** (`claude-opus-5-5`, trả phí). Hai bộ dịch dùng chung một prompt (`src/lib/translate/prompt.ts`). Tên người được **phiên âm theo cách báo chí từng nước hay viết**: chữ Hán Việt cho tiếng Trung, Kirin cho tiếng Nga, chữ Thái/Lào/Khmer/Miến, tên không dấu cho các ngôn ngữ chữ Latin. Cụm từ thường thì được dịch nghĩa. Bản dịch được cache 30 ngày theo từng ngôn ngữ.
2. **Mỗi ngôn ngữ tìm riêng**, kể cả khi cách viết trùng nhau (vd "Tran Van A" ở tiếng Anh, Đức, Indonesia): mỗi nước tìm bằng Google của nước đó và chỉ lấy trang viết bằng ngôn ngữ đó nên kết quả khác nhau.
3. **Số kết quả tính theo ngôn ngữ:** mỗi nguồn lấy tối đa N kết quả (N ÷ 10 lượt) trên cả khoảng ngày; hết kết quả thì dừng sớm. Bài đã được nguồn trước tìm ra thì nguồn sau ghi là "Trùng".
4. Khi xác minh, trang được chấp nhận nếu khớp nhóm từ khoá của **bất kỳ** ngôn ngữ nào (đủ mọi phần bắt buộc của ngôn ngữ đó, hoặc đủ 60% số từ khi tìm liên quan). Cột Phạm vi ghi "Bản dịch tiếng …" cho bài khớp nhờ bản dịch; file xuất có thêm cột "Khớp theo" và "Biến thể khớp".
5. **Mỗi bản dịch tìm như người ở nước đó:** SerpApi chạy truy vấn qua máy chủ của họ và giả lập quốc gia bằng `gl`, nên IP của máy chạy app không ảnh hưởng tới kết quả. Ngoài `gl`/`hl`, app dùng tên miền Google của nước đó (`google.ru`, `google.co.th`, `google.com.hk` cho tiếng Trung giản thể…) và chỉ lấy trang viết bằng đúng ngôn ngữ đó (`lr=lang_ru`…). Google chỉ hỗ trợ `lr` cho một số ngôn ngữ: có Thái, Indonesia, Philippines; **không** có Lào, Khmer, Myanmar, Mã Lai (với các ngôn ngữ này chữ viết riêng hoặc tên phiên âm đã đủ phân biệt). Nhóm tiếng Việt không lọc ngôn ngữ vì phạm vi Ngoài nước cần cả bài tiếng Anh viết tên không dấu. Cả 7 ngôn ngữ Đông Nam Á đều có trong danh sách quốc gia / ngôn ngữ / tên miền Google mà SerpApi hỗ trợ (đã đối chiếu `google-countries.json`, `google-languages.json`, `google-domains.json`, `google-lr-languages.json`).
6. **Công cụ tìm kiếm của nước đó** (tuỳ chọn "Tìm thêm trên công cụ tìm kiếm của nước đó", bật sẵn, chỉ dùng khi tìm **Ngoài nước**): Google bị chặn ở Trung Quốc nên nhiều báo Trung Quốc chỉ có trên Baidu; ở Nga Yandex, ở Hàn Quốc Naver phổ biến hơn Google. Bản dịch tiếng Trung giản thể được tìm thêm trên **Baidu** (lọc theo khoảng ngày và chỉ lấy chữ giản thể), tiếng Nga trên **Yandex**, tiếng Hàn trên mục Tin tức của **Naver** (lọc theo khoảng ngày). Mỗi lượt tốn quota như Google. Yandex không lọc được theo khoảng ngày tuỳ ý (chỉ có ngày / 2 tuần / tháng gần nhất) nên chỉ tìm trên cả khoảng ngày rồi lấy thêm trang nếu còn; bài có ngày đăng nằm ngoài khoảng bị loại như thường. Baidu dùng `|` thay cho OR, nên khi có nhiều từ khoá bắt buộc mỗi từ khoá chỉ lấy biến thể đầu. Kết quả ghi rõ "qua Baidu / Yandex / Naver"; file xuất có cột "Tìm qua". Ngày trên snippet của Baidu / Naver ("2025年3月7日", "6天前", "2026.09.08.", "3일 전") được đọc làm ngày ước lượng.
7. **Tiếng Nga biến cách:** báo Nga đổi đuôi tên theo ngữ pháp ("То Лам" → "То Лама", "То Ламу", "То Ламом"), nên với nhóm tiếng Nga, từ cuối của từ khoá chính được phép mang đuôi biến cách (-а, -у, -ом, -е sau phụ âm; đổi đuôi -а/-я) khi từ đó dài từ 3 chữ cái — "Чан Ван А" vẫn không khớp "Чан Ван Ань". Từ liên quan tiếng Nga được so theo gốc từ (Данию ~ Дании, визит ~ визиту). Các ngôn ngữ khác vẫn so khớp chặt.
8. Với hệ chữ không có dấu cách giữa các từ (Hán, Nhật, Thái, Lào, Khmer, Myanmar, Hàn), không thể xét ranh giới từ nên chỉ cần chuỗi xuất hiện liền nhau. Chữ Latin và Kirin vẫn giữ quy tắc chặt.
9. **Bộ dịch dự phòng:** Gemini hết lượt (429) ở model chính thì chuyển sang `gemini-3.5-flash-lite` (hạn mức miễn phí tính riêng từng model). Cả hai đều lỗi mà có `AZURE_TRANSLATOR_KEY` thì dùng **Microsoft Translator** (dịch máy, REST v3; `zh-CN`→`zh-Hans`, `tl`→`fil`) và cảnh báo người dùng: bản dịch máy chỉ có 1 cách viết, có thể chưa phiên âm tên đúng cách báo chí nước đó viết. Bản dịch dự phòng không lưu cache, lần sau thử lại bộ chính.
10. **Gemini chậm hoặc treo:** model chính `gemini-3.8-flash` lúc quá tải có thể treo cả phút không trả lời (đã đo: treo 90s trong khi `gemini-3.5-flash-lite` trả lời sau 2,6s). App chờ model chính tối đa **25 giây**; quá thời gian hoặc lỗi mạng thì chuyển ngay sang `gemini-3.5-flash-lite`; lỗi 5xx thì thử lại cùng model một lần trước khi chuyển. Model Gemini 3 Flash được đặt `thinkingLevel: "low"` để dịch nhanh hơn (mức `minimal` không được hỗ trợ). Từ khoá chính và phần từ phụ được dịch riêng: phần nào lỗi thì chỉ mất phần đó, kèm cảnh báo rõ. Trong lúc dịch, thanh trạng thái đếm số giây đã chờ.
11. Không dịch được (thiếu key, hết lượt miễn phí, lỗi mạng, model từ chối…) thì app hiện cảnh báo và vẫn tìm bằng tiếng Việt. Với Claude, yêu cầu dịch bật `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): nếu bộ lọc an toàn từ chối, máy chủ tự chạy lại bằng model dự phòng phù hợp.
12. **Về dữ liệu:** ở gói miễn phí của Gemini, Google dùng nội dung gửi lên (tức từ khoá / tên người cần tìm) để cải thiện sản phẩm của họ. Nếu từ khoá nhạy cảm, hãy dùng gói trả phí của Gemini, dùng Claude, hoặc chỉ tìm Trong nước (không dịch). Gói Google AI Pro (dùng cho app Gemini) không kèm quyền dùng Gemini API, nhưng cùng tài khoản Google vẫn tạo được key miễn phí.

### Ngày đăng (`src/lib/date-extractor.ts`)

| Thứ tự | Nguồn | Độ tin cậy |
| --- | --- | --- |
| 1 | meta `article:published_time`, `og:published_time`, `datePublished`, `pubdate` (và các biến thể thường gặp) | cao |
| 2 | JSON-LD `NewsArticle` / `Article` / `BlogPosting` → `datePublished` | cao |
| 3 | thẻ `<time datetime>` (ưu tiên thẻ trong `<article>`) | trung bình |
| 4 | ngày trong URL: `/2019/05/12/`, `-20190512…` (Dân trí, NLĐ, Tuổi Trẻ), mã VCCorp / Thanh Niên `-188190512…` | trung bình |
| 5 | Wayback Machine CDX: lần lưu trữ đầu tiên | **ước lượng** |
| 6 | ngày trên snippet của Google ("12 thg 5, 2019", "3 ngày trước"…) | **ước lượng** |

Đọc được các định dạng ISO, `dd/MM/yyyy` kiểu Việt Nam, "Chủ nhật, 12/5/2019, 10:30 (GMT+7)", "12 tháng 5, 2019", RFC 2822, Unix time. Không ghi múi giờ thì coi là GMT+7. Ngày hiển thị theo lịch nơi đăng.

### Lý do bị loại

| Lý do | Khi nào |
| --- | --- |
| Sai phạm vi | Domain không thuộc phạm vi đã chọn (xét cả URL sau chuyển hướng) |
| Không phải bài viết | Mạng xã hội / video (`NON_ARTICLE_DOMAINS`) |
| robots.txt chặn | robots.txt của trang không cho phép bot |
| Tải lỗi | HTTP lỗi, quá 10s, lỗi mạng, không phải HTML, trang chặn bot / cần JavaScript |
| Không khớp cụm | Thiếu phần bắt buộc (ghi rõ thiếu phần nào, hoặc tên dài hơn tìm thấy, vd "Trần Văn Anh"); khi tìm liên quan: "Chỉ có 2/5 từ (cần ít nhất 3)" |
| Chỉ có ngoài nội dung chính | Từ khoá chỉ nằm ở menu, sidebar, footer, tin liên quan |
| Ngoài khoảng ngày | Ngày đăng đọc từ trang nằm ngoài khoảng; hoặc trang đã có trên Wayback Machine từ trước ngày bắt đầu; hoặc ngày Google ghi trên kết quả nằm ngoài khoảng |
| Không rõ ngày đăng | Không đọc được ngày từ trang, Wayback hay Google nên không xác nhận được bài nằm trong khoảng ngày |

### Cache và quota

- Cache 2 tầng (bộ nhớ + file JSON trong `.cache/`): kết quả SerpApi 7 ngày, trang đã phân tích 30 ngày, lỗi ổn định (4xx, robots, không phải HTML) 1 ngày, robots.txt 1 ngày, Wayback 30 ngày, bản dịch 30 ngày. Chạy lại cùng truy vấn **không tốn quota**. Xoá cache: `rm -rf .cache`.
- Số lượt gọi SerpApi tối đa = `số nguồn × (số kết quả mỗi ngôn ngữ ÷ 10)`, ít nhất 1 lượt mỗi nguồn; nguồn nào hết kết quả thì dừng sớm. Form hiện phép tính trước khi tìm.

## Cấu trúc thư mục

```
src/
├── app/
│   ├── page.tsx, layout.tsx, globals.css
│   └── api/search/route.ts      # GET → Server-Sent Events
├── components/                  # SearchApp, SearchForm, QueryInput (popup từ khoá chính), DateRangePicker,
│                                # LanguagePicker, ProgressPanel, ResultsTable, RejectedList, ExportButtons…
├── config/
│   ├── sources.ts               # báo VN, báo nước ngoài tiếng Việt, MXH bị loại
│   └── languages.ts             # ngôn ngữ tìm thêm, ngôn ngữ chọn sẵn
└── lib/
    ├── search/                  # SearchProvider (interface), SerpApi, lớp cache
    ├── translate/               # Translator (interface), Gemini, Claude, prompt chung, lớp cache
    ├── query-syntax.ts          # cú pháp ô tìm kiếm: từ khoá chính (dấu `) / từ phụ
    ├── query-builder.ts         # truy vấn, biến thể tên, từ phụ, nhóm ngôn ngữ
    ├── date-range.ts            # khoảng ngày, hôm nay theo giờ VN
    ├── source-report.ts         # ghi chú cho từng dòng "Báo cáo theo ngôn ngữ"
    ├── matcher.ts               # khớp chính xác cụm + đoạn trích + vùng tô sáng
    ├── date-extractor.ts        # trích ngày đăng
    ├── url-normalize.ts         # gộp trùng URL
    ├── region.ts                # classifyRegion
    ├── fetcher.ts               # tải HTML: robots.txt, timeout, UA, charset
    ├── page-parser.ts           # jsdom + Readability
    ├── page-loader.ts, wayback.ts, cache.ts
    ├── pipeline.ts              # ghép mọi bước, phát sự kiện tiến trình
    └── export.ts, labels.ts, sort.ts, search-params.ts, types.ts
```

Unit test nằm cạnh mã nguồn (`*.test.ts`), gồm: cú pháp ô tìm kiếm (tách phần bắt buộc, đánh dấu / bỏ đánh dấu vùng bôi đen), matcher ("Trần Văn A" so với "Trần Văn An" / "Anh" / "TRẦN VĂN A" / dạng NFD, chữ Hán/Thái/Kirin), date-extractor (các định dạng ngày của báo VN), url-normalize, query-builder, region, SerpApi, bộ dịch Gemini và Claude (fetch giả lập), cách tự chọn bộ dịch, và pipeline (chạy end-to-end với HTML thật qua jsdom + Readability, search engine giả lập; gồm cả tìm liên quan, một và nhiều phần bắt buộc, dịch riêng từng phần).

## Mở rộng

- **Đổi nhà cung cấp tìm kiếm** (Serper, DataForSEO, Brave…): viết lớp implement `SearchProvider` (`src/lib/search/types.ts`), đăng ký trong `getSearchProvider()` (`src/lib/search/index.ts`), rồi đặt `SEARCH_PROVIDER`. Phần cache và pipeline giữ nguyên.
- **Đổi bộ dịch** (Google Cloud Translation, DeepL…): implement `Translator` (`src/lib/translate/types.ts`) và đăng ký trong `getTranslator()`.
- **Thêm ngôn ngữ:** thêm một dòng vào `SEARCH_LANGUAGES` (`src/config/languages.ts`), khai báo `gl`/`hl` của Google; nếu cần `google_domain` riêng thì thêm vào `GOOGLE_DOMAINS` trong `src/lib/search/serpapi.ts`.

## Các điểm đặc tả chưa rõ và lựa chọn đã dùng

- **Ngoài nước không tìm bằng tiếng Việt, không chọn sẵn ngôn ngữ:** theo góp ý, phạm vi Ngoài nước chỉ tìm bằng các ngôn ngữ người dùng tự chọn (bắt buộc ít nhất một); nhóm tiếng Việt vẫn dùng để xác minh (vd tên không dấu, đảo thứ tự trong bài tiếng Anh) nhưng không gửi truy vấn tiếng Việt. Đánh đổi: báo tiếng Việt ở nước ngoài (BBC Tiếng Việt, VOA…) không còn được tìm. Không dịch được thì không có gì để tìm và app báo rõ.
- **Trong nước chỉ tìm tiếng Việt:** trước đây phạm vi Trong nước cũng dịch từ khoá (để tìm bản tiếng Anh, Trung… của báo Việt Nam), nhưng dễ gây hiểu nhầm là đang tìm báo nước khác, nên phần chọn ngôn ngữ chỉ hiện khi tìm Ngoài nước. API vẫn nhận `langs` với `region=domestic` nếu cần.
- **Xác nhận ngày đăng chặt:** bộ lọc ngày của Google (`tbs=cdr`) không chặt — Google lọc theo ngày nó tự ước lượng (thường là ngày cập nhật / thu thập lại trang), nên tìm 18–19/10/2026 vẫn ra bài 2024 (đã gặp thực tế). Vì vậy mọi bài phải xác nhận được ngày đăng nằm trong khoảng: ngày đọc từ trang; nếu trang không ghi ngày thì ngày lưu đầu tiên trên Wayback (trang đã có trên Wayback trước ngày bắt đầu thì chắc chắn đăng trước đó → loại; lưu sau ngày kết thúc thì chưa kết luận được) và ngày Google ghi trên kết quả (nằm ngoài khoảng → loại). Không có ngày nào → loại với lý do "Không rõ ngày đăng" (vẫn xem được ở tab Bị loại). Đánh đổi: bài mới của trang nhỏ không ghi ngày, chưa có trên Wayback và Google không ghi ngày sẽ bị loại.
- **Nội dung liên quan bắt buộc một phần:** ban đầu phần ngoài từ khoá chính "có hay không đều được"; thực tế khiến mọi bài chỉ nhắc tới tên người (vd bài cũ về Tô Lâm) đều được nhận. Nay bài phải có thêm ít nhất 50% số từ còn lại (`RELATED_MIN_RATIO`), lý do loại ghi rõ "Có “Tô Lâm” nhưng không liên quan tới nội dung đã nhập: chỉ có 1/4 từ liên quan (cần ít nhất 2)". Từ được đếm theo âm tiết, nên gõ sai chính tả (vd "công đu" thay vì "công du") sẽ làm mất một từ.
- **Ô tìm kiếm động:** đặc tả gốc yêu cầu khớp chính xác cả cụm; theo góp ý sau đó, chỉ **phần được đánh dấu** mới phải khớp chính xác, phần còn lại không bắt buộc, và **không đánh dấu gì thì tìm liên quan** (về sau phần còn lại được yêu cầu một phần, xem mục trên). Đánh dấu được lưu bằng dấu `` ` `` ngay trong ô nhập (thay vì tô màu bên trong ô) để: người dùng thấy rõ phần nào là từ khoá chính, dán/sửa tay được, gửi qua URL/API được (``q=Chuyến thăm `ABC`…``). Dùng dấu `` ` `` thay ngoặc kép kiểu Google theo yêu cầu, vì ngoặc kép hay có trong chính nội dung cần tìm. Dòng "Cách hiểu" bên dưới hiển thị lại dạng thẻ để không phải đọc dấu. Trong ô nhập, dấu `` ` `` **không hiển thị**: một lớp chữ nằm dưới tô đậm + đổi màu từ khoá chính, ô `<input>` thật nằm trên với chữ trong suốt (vẫn thấy con trỏ, bôi đen, gõ dấu tiếng Việt bình thường); chữ đậm được làm bằng viền chữ (`-webkit-text-stroke`) để không đổi độ rộng, nên con trỏ luôn khớp chữ. Mỗi lần sửa trong ô được chuyển ngược vào giá trị có dấu (`applyPlainEdit`): gõ ngay trước / sau từ khoá chính thì nằm ngoài, gõ ở giữa thì nằm trong. Popup đặt **dưới** ô nhập vì trên điện thoại menu Sao chép/Dán của hệ thống nằm phía trên vùng bôi đen; vị trí ngang được tính bằng cách đo độ rộng chữ (canvas `measureText`), vì ô `<input>` không cho biết toạ độ vùng bôi đen.
- **Tên người không đánh dấu** cũng chỉ là tìm liên quan, nên `Trần Văn A` có thể khớp bài nói về "Trần Văn Anh". Để tránh nhầm, khi nội dung trông giống tên người (2–5 từ, từ nào cũng viết hoa chữ đầu) app hiện gợi ý "Đặt cả tên làm từ khoá chính" để đánh dấu cả cụm bằng một lần bấm.
- **Ngưỡng tìm liên quan 60%** và tách từ theo âm tiết là cách đơn giản, dễ giải thích. Tiếng Việt đặt dấu cách giữa các âm tiết chứ không phải giữa các từ, nên muốn tách đúng từ ghép ("thủ tướng" là một từ) cần bộ tách từ riêng, chưa làm trong MVP.

- **Ranh giới từ** thêm `\p{M}` (dấu kết hợp) ngoài `\p{L}\p{N}`, để chữ còn dấu rời sau NFC (vd `A` + U+0331) không bị coi là hết từ.
- **Chuẩn hoá thêm:** hai kiểu đặt dấu thanh (hoà/hòa, thuỷ/thủy, khoẻ/khỏe) được coi là một; bỏ ký tự vô hình (zero-width space, soft hyphen); `Ð` (U+00D0, hay bị gõ nhầm) được coi là `Đ`.
- **Biến thể "Ngoài nước"** đúng như đặc tả: bỏ dấu, `A Tran Van`, `Van A Tran`. Chỉ đảo thứ tự khi cụm có 2–5 từ (coi là tên người); cụm dài hơn chỉ thêm bản bỏ dấu.
- **Truy vấn "Ngoài nước"** thêm `-site:vn` và `-site:` cho báo VN không đuôi .vn để không phí suất ~30 kết quả/năm. Truy vấn giữ dưới 32 từ (giới hạn của Google). Kết quả vẫn được lọc lại bằng `classifyRegion`.
- **"Ngoài nước"** dùng `gl=us, hl=en` cho nhóm tiếng Việt. Mọi truy vấn có `nfpr=1` để Google không tự sửa chính tả. Phân trang 10 kết quả/trang bằng `start` (Google đã bỏ `num=100`).
- **Mạng xã hội / video** (Facebook, YouTube, TikTok, X…) bị loại ngay vì không phải bài viết và thường cần đăng nhập.
- **Khoảng ngày và số kết quả:** đặc tả gốc chia truy vấn theo từng năm (N trang mỗi năm, từ năm xa nhất). Theo góp ý sau đó, số kết quả được tính **theo ngôn ngữ** (mỗi nguồn N kết quả trên cả khoảng ngày, `cd_min`/`cd_max` đúng ngày) cho dễ hiểu, nhất là khi mặc định chỉ tìm từ hôm qua đến hôm nay. Đánh đổi: với khoảng ngày dài nhiều năm, N kết quả là N kết quả Google xếp hạng cao nhất của cả khoảng, không chia đều cho từng năm — muốn lấy nhiều bài cũ hơn thì tăng số kết quả hoặc thu hẹp khoảng ngày. Bài có ngày chắc chắn (meta/JSON-LD/`<time>`/URL) nằm ngoài khoảng thì bị loại; ngày ước lượng (Wayback, snippet) thì giữ lại. API vẫn nhận kiểu cũ chỉ có năm (`from=2010&to=2015`). "Hôm nay" tính theo giờ Việt Nam; ngày kết thúc trong tương lai được tính đến hôm nay.
- **Ngày từ snippet** cũng được đánh dấu "ước lượng" như Wayback, vì không đọc từ chính trang.
- **Wayback:** dùng `https://web.archive.org/cdx/search/cdx?url=…&limit=5&output=json&fl=timestamp,statuscode` rồi tự chọn bản lưu 200 sớm nhất. Không dùng `filter=statuscode:200` của CDX vì chậm hơn nhiều. Timeout riêng 20s, tối đa 2 truy vấn cùng lúc, chạy ngoài 5 luồng tải trang.
- **robots.txt:** chỉ áp dụng khi tải được (2xx); 4xx/5xx/lỗi mạng coi như không có luật (giống đa số crawler). Chỉ kiểm tra robots.txt của URL ban đầu, không kiểm tra lại sau chuyển hướng.
- **Trang chống bot / cần JavaScript** (vd laodong.vn đặt cookie bằng JS rồi tải lại): app **không** vượt qua cơ chế này mà xếp vào "Tải lỗi" để người dùng tự mở link kiểm tra.
- Chỉ xác minh trang HTML; PDF và các loại khác xếp vào "Tải lỗi".
- **Gộp trùng:** theo URL chuẩn hoá (bỏ http/https, www/m/amp, tham số theo dõi, `/` cuối, bản AMP kể cả Google AMP cache) và theo URL canonical của trang. Canonical trỏ về trang chủ (cấu hình sai) bị bỏ qua.
- **Dịch từ khoá** dùng model ngôn ngữ (Gemini miễn phí hoặc Claude) thay vì dịch máy thông thường, vì cần phiên âm tên người theo cách báo chí từng nước viết; dịch máy dễ dịch tên theo nghĩa của chữ. Gemini được chọn trước vì có gói miễn phí. Mặc định chọn sẵn đúng các ngôn ngữ được yêu cầu (Anh, Đức, Nga, Trung, Thái, Lào và các nước Đông Nam Á); có thể bỏ chọn.
- Next.js 16 bật sẵn `cacheComponents`. Trang chủ được prerender, ngày hôm nay lấy qua `"use cache"` (làm mới mỗi giờ). Route `/api/search` và `/api/quota` luôn chạy theo request.
- **Ô chọn ngày và ô chọn số kết quả** dùng [antd](https://ant.design) 6 (DatePicker, Select; tiếng Việt, màu và font theo app, tự đổi sáng/tối). Dùng hai ô DatePicker thay cho RangePicker vì lịch hai tháng của RangePicker tràn màn hình điện thoại. Next.js 16 bật `cacheComponents` nên không cho gọi `Math.random()` / `Date.now()` khi prerender trang tĩnh: (1) registry CSS của antd tự viết (`src/components/AntdRegistry.tsx`), tạo cache bằng `useId()` thay vì `createCache()` (hàm này gọi `Math.random()`); (2) DatePicker và Select đọc giờ hiện tại khi render nên chỉ được dựng trên trình duyệt (`ClientOnly`), lúc prerender hiện ô tĩnh cùng kích thước. Đã bỏ các nút chọn nhanh khoảng ngày vì trùng chức năng với hai ô lịch.
- **Giao diện** được làm lại theo skill `redesign-existing-projects`: font Be Vietnam Pro (thiết kế cho tiếng Việt) cho chữ, JetBrains Mono cho truy vấn; một màu nhấn duy nhất; tuỳ chọn ít dùng gom vào "Tuỳ chọn nâng cao"; kết quả và bài bị loại tách thành hai tab; thẻ kết quả trên điện thoại; khung chờ khi đang tìm; hướng dẫn nhanh khi chưa tìm; link "Bỏ qua tới kết quả" cho người dùng bàn phím. Số lượt còn lại lấy từ Account API của SerpApi (`/api/quota`, không tính vào lượt tìm).

## Giới hạn đã biết

- Mỗi nguồn chỉ lấy tối đa N kết quả (tối đa 100) cho cả khoảng ngày, nên không đảm bảo thu được 100% bài. Tăng "Số kết quả mỗi ngôn ngữ" hoặc chia nhỏ khoảng ngày để lấy thêm (tốn quota hơn).
- Bước **tìm kiếm** chạy qua SerpApi (giả lập quốc gia), nhưng bước **tải trang để xác minh** chạy từ máy của bạn, tức IP Việt Nam. Một số báo nước ngoài (BBC, RFA…) bị chặn tại Việt Nam nên rơi vào "Tải lỗi: ECONNREFUSED". Có thể cho Node đi qua proxy: `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://host:port npm run dev` (Node ≥ 22.21 / 24).
- Trang render hoàn toàn bằng JavaScript hoặc có chống bot thì không đọc được.
- Tìm liên quan chỉ đếm từ (âm tiết) chứ không hiểu nghĩa: bài có đủ các âm tiết rời rạc ở nhiều đoạn khác nhau vẫn được nhận, còn bài dùng từ đồng nghĩa ("chuyến công du" thay cho "chuyến thăm") thì có thể bị loại. Muốn chặt hơn thì đánh dấu phần quan trọng là bắt buộc.
- Readability đôi khi chọn sai khối nội dung, khiến bài bị loại nhầm "chỉ có ngoài nội dung chính". Hãy xem danh sách bị loại.
- Với chữ Hán/Thái/Lào/Khmer/Myanmar/Hàn không xét được ranh giới từ, nên một tên ngắn có thể khớp bên trong tên dài hơn. Bản phiên âm do model đề xuất cũng có thể chưa đúng cách báo nước đó viết; xem danh sách bản dịch ở bảng tiến trình.
- Wayback Machine thường mất 5–15 giây mỗi truy vấn và đôi khi quá thời gian. Khi đó bài không có ngày ước lượng từ Wayback.
- Cache dạng file cần thư mục ghi được. Trên nền tảng serverless, đặt `CACHE_DIR=/tmp/...` hoặc `CACHE_MODE=memory`.
