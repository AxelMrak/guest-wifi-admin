/**
 * Hook: estado actual de la red + conexión con el router.
 *
 * Polling cada 30s para reflejar cambios del scheduler en background.
 * (El nuevo requisito del usuario: "Polling de estado cada 30 segundos".)
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { NetworkStatus } from "@shared/types";

const POLL_INTERVAL_MS = 30_000;

export function useStatus() {
  return useQuery<NetworkStatus>({
    queryKey: ["status"],
    queryFn: () => api.status(),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
}
