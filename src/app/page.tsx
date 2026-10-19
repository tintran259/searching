import { cacheLife } from "next/cache";
import SearchApp from "@/components/SearchApp";
import { todayInVietnam } from "@/lib/date-range";

/** Hôm nay (giờ Việt Nam) cho giá trị mặc định "đến ngày"; trang vẫn được prerender, làm mới mỗi giờ. */
async function getToday() {
  "use cache";
  cacheLife("hours");
  return todayInVietnam();
}

export default async function Home() {
  return <SearchApp today={await getToday()} />;
}
