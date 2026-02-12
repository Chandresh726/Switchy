import { HistoryLayoutClient } from "@/components/history/history-layout-client";

export default function HistoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <HistoryLayoutClient>{children}</HistoryLayoutClient>;
}
