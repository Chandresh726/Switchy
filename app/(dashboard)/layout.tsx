import { Sidebar } from "@/components/dashboard/sidebar";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/toaster";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <div className="flex h-screen bg-zinc-950">
        <Sidebar />
        <main id="main-content" className="flex-1 overflow-auto relative">
          <div className="min-h-full p-6">{children}</div>
        </main>
      </div>
      <Toaster />
    </QueryProvider>
  );
}
