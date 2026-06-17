import { QueryClient } from "@tanstack/react-query";

/**
 * Cliente de React Query compartido.
 *
 * - `staleTime: 10s` → evita refetchs innecesarios en interacciones rápidas.
 * - `refetchOnWindowFocus: true` → refleja cambios hechos por el scheduler
 *   en background o por otro tab.
 * - `retry: 1` → un solo reintento; fallos de red se reflejan al usuario rápido.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});
