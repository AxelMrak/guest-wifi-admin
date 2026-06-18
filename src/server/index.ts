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
const ROUTER_PHONE_ID = process.env.ROUTER_PHONE_ID ?? "";
const ROUTER_RID = process.env.ROUTER_RID ?? "";
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
  phoneId: ROUTER_PHONE_ID,
  rid: ROUTER_RID,
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

// Diagnóstico: lista servicios UBUS disponibles en el router
app.get("/api/diagnostics", async (c) => {
  try {
    const allNames = await routerService.listAllServices();
    const wifiRelated = allNames.filter(
      (n) =>
        n.includes("wifi") ||
        n.includes("wireless") ||
        n.includes("wlan") ||
        n.includes("guest") ||
        n.includes("radio") ||
        n.includes("wificfg") ||
        n.includes("network") ||
        n.includes("hotspot") ||
        n.includes("rkey"),
    );

    const details: Record<string, unknown> = {};
    for (const name of wifiRelated) {
      try {
        details[name] = await routerService.describeService(name);
      } catch (err) {
        details[name] = { error: (err as Error).message };
      }
    }

    return c.json({
      ok: true,
      data: { totalServices: allNames.length, allServiceNames: allNames, wifiRelated, serviceDetails: details },
    });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 502);
  }
});

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

// Diagnóstico de arranque: descubrir servicios UBUS antes del scheduler
console.log("[diag] descubriendo servicios UBUS del router…");
try {
  const allNames = await routerService.listAllServices();
  const wifiRelated = allNames.filter(
    (n) =>
      n.includes("wifi") ||
      n.includes("wireless") ||
      n.includes("wlan") ||
      n.includes("guest") ||
      n.includes("radio") ||
      n.includes("wificfg") ||
      n.includes("network") ||
      n.includes("hotspot") ||
      n.includes("rkey"),
  );
  console.log(`[diag] ${allNames.length} servicios. WiFi/red/rkey: ${wifiRelated.join(", ") || "ninguno"}`);

  for (const name of wifiRelated) {
    try {
      const methods = await routerService.describeService(name);
      const methodNames = Object.keys(methods);
      const controlMethods = methodNames.filter(
        (m) =>
          m.includes("enable") ||
          m.includes("disable") ||
          m.includes("status") ||
          m.includes("set") ||
          m.includes("get") ||
          m.includes("up") ||
          m.includes("down") ||
          m.includes("on") ||
          m.includes("off"),
      );
      console.log(`[diag]   ${name}: ${methodNames.join(", ")}`);
      if (controlMethods.length > 0) {
        console.log(`[diag]     → potencial control: ${controlMethods.join(", ")}`);
      }
    } catch (err) {
      console.log(`[diag]   ${name}: ERROR — ${(err as Error).message}`);
    }
  }

  // Exploración adicional: llamar directamente a métodos de routerd y rkey.*
  console.log("[diag] exploración adicional — routerd, rkey.*, network.* …");

  // 1) Listar métodos de routerd (el servicio que SÍ responde)
  try {
    const routerdMethods = await routerService.describeService("routerd");
    console.log(`[diag] routerd métodos: ${Object.keys(routerdMethods).join(", ")}`);
  } catch (err) {
    console.log(`[diag] describe routerd: ERROR — ${(err as Error).message}`);
  }

  // 1b) Listar métodos de wifi (porque get_apply_status funciona)
  try {
    const wifiMethods = await routerService.describeService("wifi");
    console.log(`[diag] wifi métodos: ${Object.keys(wifiMethods).join(", ")}`);
  } catch (err) {
    console.log(`[diag] describe wifi: ERROR — ${(err as Error).message}`);
  }

  // 1c) Listar métodos de rkey.uci (porque get devuelve [2] y list [3])
  try {
    const rkeyUciMethods = await routerService.describeService("rkey.uci");
    console.log(`[diag] rkey.uci métodos: ${Object.keys(rkeyUciMethods).join(", ")}`);
  } catch (err) {
    console.log(`[diag] describe rkey.uci: ERROR — ${(err as Error).message}`);
  }

  // 1d) Listar métodos de hotspot
  try {
    const hotspotMethods = await routerService.describeService("hotspot");
    console.log(`[diag] hotspot métodos: ${Object.keys(hotspotMethods).join(", ")}`);
  } catch (err) {
    console.log(`[diag] describe hotspot: ERROR — ${(err as Error).message}`);
  }

  // 1e) Listar métodos de otros servicios candidatos
  for (const svc of ["network", "network.wireless", "luci", "luci-rpc", "service", "system", "rc", "platform_hal", "iwinfo", "rkey", "rkey.session"]) {
    try {
      const methods = await routerService.describeService(svc);
      console.log(`[diag] ${svc} métodos: ${Object.keys(methods).join(", ")}`);
    } catch (err) {
      console.log(`[diag] describe ${svc}: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  // 2) Probar uci.* y rkey.uci.* con los nuevos headers
  const tryMethods: Array<{ service: string; method: string; payload?: Record<string, unknown> }> = [
    { service: "uci", method: "get", payload: { config: "wificfg", section: "2G" } },
    { service: "uci", method: "get", payload: { config: "wificfg", section: "5G" } },
    { service: "uci", method: "get", payload: { config: "wificfg" } },
    { service: "uci", method: "apply", payload: { timeout: "60" } },
    { service: "rkey.uci", method: "get", payload: { config: "wificfg", section: "2G" } },
    { service: "rkey.uci", method: "get", payload: { config: "wificfg", section: "5G" } },
    { service: "rkey.uci", method: "get", payload: { config: "wificfg" } },
    { service: "rkey.uci", method: "set", payload: { config: "wificfg", section: "2G", values: { Enable2: "0" } } },
    { service: "rkey.uci", method: "apply", payload: { timeout: 60 } },
    { service: "rkey.uci", method: "get_all", payload: { config: "wificfg" } },
    { service: "rkey.uci", method: "configs", payload: {} },
  ];

  console.log("[diag] probando uci.* y rkey.uci.* con nuevos headers…");
  for (const { service, method, payload } of tryMethods) {
    try {
      const res = await routerService.callService(service, method, payload);
      const snippet = JSON.stringify(res).slice(0, 400);
      console.log(`[diag]   ${service}.${method}(${JSON.stringify(payload)}): ${snippet}`);
    } catch (err) {
      const msg = (err as Error).message.slice(0, 100);
      console.log(`[diag]   ${service}.${method}(${JSON.stringify(payload)}): ERROR — ${msg}`);
    }
  }

  // 3) Probar más métodos en wifi (ya que get_apply_status funciona)
  const wifiTests = [
    "config", "configs", "wificfg", "wificfg_2g", "wificfg_5g", "wlan0", "wlan1",
    "guest", "guest_2g", "guest_5g", "2g", "5g", "set", "get", "update",
    "enable_2g", "enable_5g", "disable_2g", "disable_5g", "set_2g", "set_5g",
    "get_2g", "get_5g", "apply", "ssid", "scan",
  ];

  console.log("[diag] probando métodos de wifi…");
  for (const method of wifiTests) {
    try {
      const res = await routerService.callService("wifi", method, {});
      const snippet = JSON.stringify(res).slice(0, 200);
      console.log(`[diag]   wifi.${method}: ${snippet}`);
    } catch (err) {
      const code = (err as Error).message.match(/"code":(-?\d+)/)?.[1] ?? "?";
      if (code !== "3") {
        console.log(`[diag]   wifi.${method}: code=${code} — ${(err as Error).message.slice(0, 80)}`);
      }
    }
  }

  // 4) Búsqueda del método apply (rkey.uci no tiene apply, hay que encontrar el correcto)
  const applyTests: Array<{ service: string; method: string; payload: Record<string, unknown>; label: string }> = [
    { service: "rkey.uci", method: "commit", payload: { config: "wificfg" }, label: "commit config=wificfg" },
    { service: "rkey.uci", method: "commit", payload: {}, label: "commit sin args" },
    { service: "rkey.uci", method: "apply", payload: { config: "wificfg" }, label: "apply con config" },
    { service: "rkey.uci", method: "apply", payload: { config: "wificfg", section: "2G" }, label: "apply con section" },
    { service: "rkey.uci", method: "apply", payload: {}, label: "apply sin args" },
    { service: "wifi", method: "apply", payload: { config: "wificfg" }, label: "wifi.apply" },
    { service: "wifi", method: "apply", payload: {}, label: "wifi.apply sin args" },
    { service: "rkey", method: "apply", payload: { config: "wificfg" }, label: "rkey.apply" },
    { service: "rkey", method: "wificfg_apply", payload: {}, label: "rkey.wificfg_apply" },
    { service: "rkey", method: "wifi_apply", payload: {}, label: "rkey.wifi_apply" },
  ];

  console.log("[diag] probando métodos de apply…");
  for (const { service, method, payload, label } of applyTests) {
    try {
      const res = await routerService.callService(service, method, payload);
      const snippet = JSON.stringify(res).slice(0, 200);
      console.log(`[diag]   ${service}.${method} (${label}): ${snippet}`);
    } catch (err) {
      const code = (err as Error).message.match(/"code":(-?\d+)/)?.[1] ?? "?";
      if (code !== "3") {
        console.log(`[diag]   ${service}.${method} (${label}): code=${code} — ${(err as Error).message.slice(0, 80)}`);
      }
    }
  }

  // 5) Set con apply=true (algunos UBUS aceptan apply embebido)
  try {
    const res = await routerService.callService("rkey.uci", "set", {
      config: "wificfg",
      section: "2G",
      values: { Enable2: "1" },
      apply: true,
    });
    console.log(`[diag]   rkey.uci.set con apply=true: ${JSON.stringify(res).slice(0, 200)}`);
  } catch (err) {
    console.log(`[diag]   rkey.uci.set con apply=true: ${(err as Error).message.slice(0, 150)}`);
  }

  // 6) Test de toggle end-to-end (DESTRUCTIVO — solo si RUN_TEST_CYCLE=1)
  if (process.env.RUN_TEST_CYCLE !== "1") {
    console.log("[diag] (test end-to-end de toggle NO ejecutado — setear RUN_TEST_CYCLE=1 para correr)");
  } else {
  console.log("[diag] ============================================================");
  console.log("[diag] TEST END-TO-END: deshabilitar guest WiFi 2G+5G");
  console.log("[diag] ============================================================");

  const before: Record<string, string | undefined> = {};
  for (const section of ["2G", "5G"]) {
    try {
      const res = (await routerService.callService("uci", "get", {
        config: "wificfg",
        section,
      })) as { result?: [number, { values?: Record<string, string> }] };
      before[section] = res.result?.[1]?.values?.Enable2;
      console.log(`[diag]   ANTES  wificfg/${section}.Enable2 = ${before[section]}`);
    } catch (err) {
      console.log(`[diag]   ANTES  wificfg/${section}: ERROR — ${(err as Error).message.slice(0, 120)}`);
    }
  }

  // Aplicar: deshabilitar ambos
  for (const section of ["2G", "5G"]) {
    try {
      const res = await routerService.callService("rkey.uci", "set", {
        config: "wificfg",
        section,
        values: { Enable2: "0" },
        apply: true,
      });
      console.log(`[diag]   SET    rkey.uci.set wificfg/${section} Enable2=0 apply=true: ${JSON.stringify(res).slice(0, 100)}`);
    } catch (err) {
      console.log(`[diag]   SET    rkey.uci.set wificfg/${section}: ERROR — ${(err as Error).message.slice(0, 120)}`);
    }
  }

  // Poll wifi.get_apply_status
  for (let i = 0; i < 8; i++) {
    try {
      const res = (await routerService.callService("wifi", "get_apply_status", {})) as {
        result?: [number, { status?: string; applied?: number; pending?: number }];
      };
      console.log(`[diag]   POLL   wifi.get_apply_status (${i + 1}/8): ${JSON.stringify(res.result?.[1]).slice(0, 150)}`);
      if (res.result?.[0] === 0 && (res.result[1]?.pending === 0 || res.result[1]?.status === "success")) break;
    } catch (err) {
      console.log(`[diag]   POLL   wifi.get_apply_status (${i + 1}/8): ERROR — ${(err as Error).message.slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Verificar persistencia
  const after: Record<string, string | undefined> = {};
  for (const section of ["2G", "5G"]) {
    try {
      const res = (await routerService.callService("uci", "get", {
        config: "wificfg",
        section,
      })) as { result?: [number, { values?: Record<string, string> }] };
      after[section] = res.result?.[1]?.values?.Enable2;
      const changed = before[section] !== after[section] ? "✓ CAMBIÓ" : "✗ NO CAMBIÓ";
      console.log(`[diag]   DESPUÉS wificfg/${section}.Enable2 = ${after[section]} (${changed})`);
    } catch (err) {
      console.log(`[diag]   DESPUÉS wificfg/${section}: ERROR — ${(err as Error).message.slice(0, 120)}`);
    }
  }

  console.log("[diag] >>> AHORA CHEQUEÁ TU LISTA DE WI-FI: 'Vertiente Clientes' y 'Vertiente Clientes-5G' deberían haber DESAPARECIDO.");
  console.log("[diag] >>> Si siguen visibles, el set persistió pero el radio no se re Cargó — el router necesita un reload explícito.");
  console.log("[diag] ============================================================");
  }
} catch (err) {
  console.log(`[diag] falló descubrimiento UBUS: ${(err as Error).message}`);
}

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
