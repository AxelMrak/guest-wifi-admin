import { Toaster } from "@/components/ui/sonner";
import { Home } from "@/pages/Home";

export default function App() {
  return (
    <>
      <Home />
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}
