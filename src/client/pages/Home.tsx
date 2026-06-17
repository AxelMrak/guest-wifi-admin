import { Header } from "@/components/Header";
import { StatusCard } from "@/components/StatusCard";
import { QuickActions } from "@/components/QuickActions";
import { ScheduleCard } from "@/components/ScheduleCard";
import { Footer } from "@/components/Footer";

export function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-muted/40 p-4 py-10">
      <main className="w-full max-w-[700px] space-y-6">
        <Header />
        <StatusCard />
        <QuickActions />
        <ScheduleCard />
        <Footer />
      </main>
    </div>
  );
}
