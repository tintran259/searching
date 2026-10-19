import type { Metadata } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { AntdProvider } from "@/components/AntdProvider";
import { AntdRegistry } from "@/components/AntdRegistry";
import "./globals.css";

// Be Vietnam Pro được thiết kế cho tiếng Việt: dấu thanh rõ, không chồng nhau
const sans = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dò bài viết theo cụm từ",
  description: "Tìm link bài viết, bài báo nhắc tới một người hoặc nội dung (bắt buộc đúng nguyên văn phần được đánh dấu), xếp từ bài cũ nhất đến mới nhất.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-dvh font-sans">
        {/* Thu CSS của antd khi render trên server để không bị nháy giao diện */}
        <AntdRegistry>
          <AntdProvider>{children}</AntdProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
