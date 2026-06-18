import { Header } from "@/components/Header";
import { StatusCard } from "@/components/StatusCard";
import { QuickActions } from "@/components/QuickActions";
import { ScheduleCard } from "@/components/ScheduleCard";
import { Footer } from "@/components/Footer";

export function Home() {
  return (
    <div className="relative flex min-h-screen items-start justify-center overflow-x-hidden bg-background px-4 py-10 sm:py-16">
      {/* Ambient halos (Apple 2026 dark) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(900px 600px at 18% 8%, hsla(211,100%,50%,0.12), transparent 60%), radial-gradient(700px 500px at 88% 92%, hsla(280,80%,55%,0.08), transparent 65%)",
        }}
      />

      <main className="relative w-full max-w-[640px] space-y-5">
        <Header />
        <StatusCard />
        <QuickActions />
        <ScheduleCard />
        <Footer />
      </main>
    </div>
  );
}
