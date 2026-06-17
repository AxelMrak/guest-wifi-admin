/**
 * Hook: acciones manuales (enable, disable, resume).
 *
 * Cada acción invalida las queries relevantes para que la UI se sincronice
 * con la respuesta del backend.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { NetworkStatus } from "@shared/types";

function applyResponse(qc: ReturnType<typeof useQueryClient>, data: NetworkStatus) {
  qc.setQueryData(["status"], data);
  qc.setQueryData(["settings"], data.settings);
}

export function useEnableGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.enableGuest(),
    onSuccess: (data) => {
      applyResponse(qc, data);
      toast.success("Red de invitados activada", {
        description: "La programación quedó en pausa hasta que reanudes.",
      });
    },
    onError: (err: Error) => {
      toast.error("No se pudo activar la red", { description: err.message });
    },
  });
}

export function useDisableGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disableGuest(),
    onSuccess: (data) => {
      applyResponse(qc, data);
      toast.success("Red de invitados desactivada", {
        description: "La programación quedó en pausa hasta que reanudes.",
      });
    },
    onError: (err: Error) => {
      toast.error("No se pudo desactivar la red", { description: err.message });
    },
  });
}

export function useResumeGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.resumeGuest(),
    onSuccess: (data) => {
      applyResponse(qc, data);
      toast.success("Programación reanudada", {
        description: "El scheduler volverá a controlar la red automáticamente.",
      });
    },
    onError: (err: Error) => {
      toast.error("No se pudo reanudar la programación", { description: err.message });
    },
  });
}
