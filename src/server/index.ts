/**
 * Bootstrap del backend.
 * ----------------------------------------------------------------------------
 * 1. Lee variables de entorno.
 * 2. Inicializa los servicios.
 * 3. Inicia el scheduler (sincronización inicial + ciclo cada 60s).
 * 4. Arranca el servidor Hono.
 * 5. En producción, sirve los archivos estáticos del frontend desde `dist/`.
 *
 * La aplicación permanece activa indefinidamente (Bun.serve es long-lived).
 * `bun run start` está pensado para correr como servicio / tarea programada.
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { ConfigService } from "./services/ConfigService";
import { RouterService } from "./services/RouterService";
import { SchedulerService } from "./services/SchedulerService";
import { createStatusRoutes } from "./routes/status";
import { createSettingsRoutes } from "./routes/settings";
import { createGuestRoutes } from "./routes/guest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");

// ----------------------------------------------------------------------------
// Configuración
// ----------------------------------------------------------------------------

const ROUTER_URL = process.env.ROUTER_URL ?? "http://192.168.0.1/ubus";
const ROUTER_USERNAME = process.env.ROUTER_USERNAME ?? "useradmin";
const ROUTER_PASSWORD = process.env.ROUTER_PASSWORD ?? "";
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3001);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SETTINGS_PATH = path.join(ROOT_DIR, "data", "settings.json");

if (!ROUTER_PASSWORD) {
  console.warn(
    "⚠️  ROUTER_PASSWORD no está definido. Las llamadas al router van a fallar.",
  );
}

// ----------------------------------------------------------------------------
// Servicios
// ----------------------------------------------------------------------------

const configService = new ConfigService(SETTINGS_PATH);
const routerService = new RouterService({
  url: ROUTER_URL,
  username: ROUTER_USERNAME,
  password: ROUTER_PASSWORD,
  log: (msg: string) => console.log(`[router] ${msg}`),
});
const schedulerService = new SchedulerService(configService, routerService);

// Log minimal de eventos del scheduler para debugging en producción.
schedulerService.on((event) => {
  const ts = new Date().toISOString();
  if (event.type === "tick" && event.changed) {
    console.log(`[scheduler ${ts}] cambio detectado: ${event.currentActive} → ${event.desiredActive} (${event.reason})`);
  } else if (event.type === "apply") {
    if (event.success) {
      console.log(`[scheduler ${ts}] aplicado: ${event.desiredActive ? "ON" : "OFF"}`);
    } else {
      console.error(`[scheduler ${ts}] error aplicando: ${event.error}`);
    }
  } else if (event.type === "error") {
    console.error(`[scheduler ${ts}] error: ${event.error}`);
  }
});

// ----------------------------------------------------------------------------
// Hono app
// ----------------------------------------------------------------------------

const app = new Hono();

app.use("*", cors({ origin: "*" }));

// Healthcheck
app.get("/api/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

// API
app.route("/api/status", createStatusRoutes(configService, routerService));
app.route("/api/settings", createSettingsRoutes(configService));
app.route("/api/guest", createGuestRoutes(configService, routerService));

// Frontend estático (solo producción)
if (IS_PRODUCTION) {
  const DIST_DIR = path.join(ROOT_DIR, "dist");
  if (existsSync(DIST_DIR)) {
    app.use("/*", serveStatic({ root: "./dist" }));
    // SPA fallback: cualquier ruta que no sea /api ni asset → index.html
    app.get("*", serveStatic({ path: "./dist/index.html" }));
  } else {
    console.warn("⚠️  dist/ no existe. Ejecutá `bun run build` antes de `bun run start`.");
  }
}

// ----------------------------------------------------------------------------
// Arranque
// ----------------------------------------------------------------------------

const server = Bun.serve({
  port: SERVER_PORT,
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`✅ Backend escuchando en http://localhost:${server.port}`);

await schedulerService.start();
console.log("✅ Scheduler activo (evaluación inmediata + ciclo cada 60s)");

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n${signal} recibido. Cerrando...`);
  schedulerService.stop();
  server.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
