/**
 * Rutas: estado actual de la red + estado del router.
 */

import { Hono } from "hono";
import type { ConfigService } from "../services/ConfigService";
import type { RouterService } from "../services/RouterService";
import type { NetworkStatus } from "@shared/types";

export function createStatusRoutes(
  config: ConfigService,
  router: RouterService,
) {
  const app = new Hono();

  app.get("/", async (c) => {
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

    const payload: NetworkStatus = {
      active,
      routerConnected,
      routerError,
      lastSyncAt: new Date().toISOString(),
      settings,
    };

    return c.json({ ok: true, data: payload });
  });

  return app;
}
