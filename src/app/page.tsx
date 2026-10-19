import { cacheLife } from "next/cache";
import SearchApp from "@/components/SearchApp";
import { todayInVietnam } from "@/lib/date-range";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";

/** Dữ liệu cấu trúc cho công cụ tìm kiếm: đây là một ứng dụng web miễn phí */
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: siteUrl(),
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any",
  inLanguage: "vi",
  offers: { "@type": "Offer", price: "0", priceCurrency: "VND" },
};

/** Hôm nay (giờ Việt Nam) cho giá trị mặc định "đến ngày"; trang vẫn được prerender, làm mới mỗi giờ. */
async function getToday() {
  "use cache";
  cacheLife("hours");
  return todayInVietnam();
}

export default async function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // Chuỗi JSON tự tạo từ hằng số trong mã, không có dữ liệu người dùng
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }}
      />
      <SearchApp today={await getToday()} />
    </>
  );
}
