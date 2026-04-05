import { Sidebar } from "@/components/dashboard/sidebar";
import { QueryProvider } from "@/components/providers/query-provider";
import { SchedulerRecoveryListener } from "@/components/scheduler/scheduler-recovery-listener";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/toaster";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <SchedulerRecoveryListener />
        <div className="flex h-screen bg-background">
          <Sidebar />
          <main id="main-content" className="relative flex-1 overflow-auto">
            <div className="min-h-full p-6">{children}</div>
          </main>
        </div>
        <Toaster />
      </QueryProvider>
    </ThemeProvider>
  );
}
