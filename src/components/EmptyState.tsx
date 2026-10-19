/** Hướng dẫn nhanh hiển thị trước lượt tìm đầu tiên */
const STEPS = [
  {
    title: 'Nhập nội dung, bôi đen từ khoá chính',
    body: 'Bôi đen phần quan trọng rồi chọn “Đặt làm từ khoá chính” (hoặc gõ trong dấu `…`). Từ khoá chính phải có nguyên văn trong bài: “Trần Văn A” không khớp “Trần Văn An” hay “Trần Văn Anh”. Không đánh dấu gì thì app tìm bài liên quan, chỉ cần có phần lớn các từ đã nhập.',
  },
  {
    title: 'Chọn phạm vi và thời gian',
    body: 'Trong nước là báo Việt Nam (tìm bằng tiếng Việt). Ngoài nước là báo quốc tế: mở “Tuỳ chọn nâng cao” để chọn các ngôn ngữ / nước cần tìm thêm.',
  },
  {
    title: 'Xem, lọc và xuất kết quả',
    body: 'Bài hiện dần trong lúc tìm và xếp từ cũ đến mới. Tab “Bị loại” cho biết vì sao một bài không được nhận. Xuất Excel hoặc CSV bất cứ lúc nào.',
  },
];

const TIPS = [
  'Mỗi lượt tìm lấy 10 kết quả của một ngôn ngữ; tìm lại cùng nội dung lấy từ bộ nhớ đệm, không tốn lượt.',
  'Lần đầu nên thử ít ngôn ngữ và 10 kết quả mỗi ngôn ngữ; xem bảng “Báo cáo theo ngôn ngữ” rồi mới tăng thêm.',
  'Nhãn cạnh ngày đăng cho biết độ tin cậy: xanh là ngày đọc từ trang, xám là ngày ước lượng.',
];

export function EmptyState() {
  return (
    <section aria-label="Hướng dẫn nhanh" className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <ol className="flex flex-col divide-y divide-line rounded-2xl bg-surface shadow-card ring-1 ring-line">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4 p-5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-mono text-xs font-semibold text-accent">
              {i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="font-semibold text-balance">{step.title}</h2>
              <p className="max-w-[65ch] text-sm leading-relaxed text-pretty text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <aside className="flex flex-col gap-3 self-start rounded-2xl bg-surface-muted/60 p-5 ring-1 ring-line">
        <h2 className="text-sm font-semibold">Mẹo dùng tiết kiệm</h2>
        <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-pretty text-muted">
          {TIPS.map((tip) => (
            <li key={tip} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
              {tip}
            </li>
          ))}
        </ul>
      </aside>
    </section>
  );
}
