/**
 * Rutas: configuración persistida.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { ConfigService } from "../services/ConfigService";
import type { UpdateSettingsPayload } from "@shared/types";

const SettingsSchema = z.object({
  scheduleEnabled: z.boolean().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  days: z.array(z.number().int().min(0).max(6)).min(1).optional(),
});

export function createSettingsRoutes(config: ConfigService) {
  const app = new Hono();

  app.get("/", async (c) => {
    const settings = await config.loadSettings();
    return c.json({ ok: true, data: settings });
  });

  app.put("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = SettingsSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Payload inválido" }, 400);
    }

    const payload: UpdateSettingsPayload = parsed.data;
    const settings = await config.saveSettings(payload);
    return c.json({ ok: true, data: settings });
  });

  return app;
}
