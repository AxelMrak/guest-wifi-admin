/**
 * Rutas: acciones manuales sobre la red de invitados.
 *
 *   POST /api/guest/enable   → activa la red y registra override manual
 *   POST /api/guest/disable  → desactiva la red y registra override manual
 *   POST /api/guest/resume   → limpia el override y vuelve al scheduler
 *
 * Cada acción devuelve un snapshot del estado actual (status completo) para
 * que el cliente pueda sincronizar su UI en una sola llamada.
 */

import { Hono } from "hono";
import type { ConfigService } from "../services/ConfigService";
import type { RouterService } from "../services/RouterService";
import type { NetworkStatus } from "@shared/types";

async function snapshot(config: ConfigService, router: RouterService): Promise<NetworkStatus> {
  const settings = await config.loadSettings();
  let active = false;
  let routerConnected = true;
  let routerError: string | undefined;

  try {
    const status = await router.getGuestStatus();
    active = status.active;
  } catch (err) {
    routerConnected = false;
    routerError = (err as Error).message;
  }

  return {
    active,
    routerConnected,
    routerError,
    lastSyncAt: new Date().toISOString(),
    settings,
  };
}

export function createGuestRoutes(
  config: ConfigService,
  router: RouterService,
) {
  const app = new Hono();

  // Activar manualmente -------------------------------------------------------
  app.post("/enable", async (c) => {
    const current = await config.loadSettings();
    await config.saveSettings({
      scheduleEnabled: current.scheduleEnabled,
    } as any);
    await config.patchRaw({ manualOverride: true, manualState: true });

    try {
      await router.enableGuest();
      await config.patchRaw({ lastKnownState: true });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 502);
    }

    return c.json({ ok: true, data: await snapshot(config, router) });
  });

  // Desactivar manualmente ----------------------------------------------------
  app.post("/disable", async (c) => {
    await config.patchRaw({ manualOverride: true, manualState: false });

    try {
      await router.disableGuest();
      await config.patchRaw({ lastKnownState: false });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 502);
    }

    return c.json({ ok: true, data: await snapshot(config, router) });
  });

  // Reanudar programación -----------------------------------------------------
  app.post("/resume", async (c) => {
    await config.patchRaw({ manualOverride: false });
    return c.json({ ok: true, data: await snapshot(config, router) });
  });

  return app;
}
