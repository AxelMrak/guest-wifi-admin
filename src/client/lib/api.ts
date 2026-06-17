/**
 * Cliente HTTP tipado para la API del backend.
 *
 * Mantiene el contrato de la API en un solo lugar. Si cambia un endpoint,
 * se cambia acá y TypeScript marca todos los call-sites.
 */

import type { ApiResponse, AppSettings, NetworkStatus, UpdateSettingsPayload } from "@shared/types";

class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      const body = (await res.json()) as ApiResponse;
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }

  const body = (await res.json()) as ApiResponse<T>;
  if (!body.ok || body.data === undefined) {
    throw new ApiError(body.error ?? "Respuesta inválida del servidor");
  }
  return body.data;
}

export const api = {
  status: () => request<NetworkStatus>("/api/status"),
  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (payload: UpdateSettingsPayload) =>
    request<AppSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  enableGuest: () =>
    request<NetworkStatus>("/api/guest/enable", { method: "POST" }),
  disableGuest: () =>
    request<NetworkStatus>("/api/guest/disable", { method: "POST" }),
  resumeGuest: () =>
    request<NetworkStatus>("/api/guest/resume", { method: "POST" }),
};

export { ApiError };
