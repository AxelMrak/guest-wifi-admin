/**
 * Hook: configuración persistida (GET + PUT).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppSettings, UpdateSettingsPayload } from "@shared/types";

export function useSettings() {
  return useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateSettingsPayload) => api.updateSettings(payload),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      // Refrescar también el status para reflejar el override.
      qc.invalidateQueries({ queryKey: ["status"] });
    },
  });
}
