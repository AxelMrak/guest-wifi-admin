/**
 * RouterService
 * ----------------------------------------------------------------------------
 * Encapsula TODA la comunicación con el router mediante el protocolo UBUS.
 *
 * Responsabilidades:
 *   - Login y mantenimiento de la sesión.
 *   - Reintentos automáticos cuando la sesión expira.
 *   - Lectura / escritura de la configuración de las bandas 2G y 5G.
 *   - Activación / desactivación de la red de invitados.
 *   - Aplicación de cambios (`uci apply`).
 *
 * Es la única pieza del sistema que conoce el protocolo UBUS. Si en el futuro
 * se cambia de router, este es el único archivo a tocar.
 */

import type { RouterSession, UciWificfgValues, WifiBand } from "../types";

const UBUS_NULL_SESSION = "00000000000000000000000000000000";
const REQUEST_TIMEOUT_MS = 8_000;

interface UbusCallParams {
  method: string;
  payload: Record<string, unknown>;
}

export class RouterService {
  private readonly url: string;
  private readonly username: string;
  private readonly password: string;
  private session: RouterSession | null = null;
  private loginInFlight: Promise<RouterSession> | null = null;
  private callId = 1;

  constructor(config: { url: string; username: string; password: string }) {
    this.url = config.url;
    this.username = config.username;
    this.password = config.password;
  }

  // ---------------------------------------------------------------------------
  // Sesión
  // ---------------------------------------------------------------------------

  /**
   * Garantiza que haya una sesión válida. Si no hay, hace login.
   * Si ya hay una en vuelo, re-usa la promise para evitar logins concurrentes.
   */
  async ensureSession(): Promise<RouterSession> {
    if (this.session && !this.isSessionExpired(this.session)) {
      return this.session;
    }

    if (this.loginInFlight) {
      return this.loginInFlight;
    }

    this.loginInFlight = this.login().finally(() => {
      this.loginInFlight = null;
    });

    return this.loginInFlight;
  }

  invalidateSession(): void {
    this.session = null;
  }

  private isSessionExpired(session: RouterSession): boolean {
    // Las sesiones UBUS suelen expirar a los 60-300s. Renovamos cada 90s
    // para evitar carreras sin generar tráfico excesivo.
    const SESSION_TTL_MS = 90_000;
    return Date.now() - session.obtainedAt > SESSION_TTL_MS;
  }

  private async login(): Promise<RouterSession> {
    const body = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "call",
      params: [
        UBUS_NULL_SESSION,
        "session",
        "login",
        { username: this.username, password: this.password },
      ],
    };

    const res = await this.rawCall(body);

    if (!res || res.result?.[0] !== 0) {
      throw new Error(
        `Login UBUS falló: ${JSON.stringify(res?.result ?? res?.error ?? "sin respuesta")}`,
      );
    }

    const sessionId = res.result?.[1]?.ubus_rpc_session;
    if (!sessionId) {
      throw new Error("Login UBUS sin session id en la respuesta");
    }

    this.session = { token: sessionId, obtainedAt: Date.now() };
    return this.session;
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /** Devuelve los valores de config de una banda. Lanza si la respuesta es inválida. */
  async getBandConfig(band: WifiBand): Promise<UciWificfgValues> {
    const response = await this.callWithRetry({
      method: "get",
      payload: { config: "wificfg", section: band },
    });
    return this.parseUciValues(response, band);
  }

  /**
   * Estado actual de la red de invitados.
   * Una banda se considera activa si `Enable2 === "1"`.
   * Si alguna banda falla al leer, esa banda se considera `undefined` y el
   * estado global cae a `false` (estado seguro: "no sabemos, asumimos apagado").
   */
  async getGuestStatus(): Promise<{ active: boolean; values: Record<WifiBand, string | undefined> }> {
    const [band2G, band5G] = await Promise.all([
      this.getBandConfig("2G").catch(() => null),
      this.getBandConfig("5G").catch(() => null),
    ]);

    const v2g = band2G?.Enable2;
    const v5g = band5G?.Enable2;

    // Solo activa si AMBAS bandas lo están.
    const active = v2g === "1" && v5g === "1";

    return {
      active,
      values: { "2G": v2g, "5G": v5g },
    };
  }

  async enableGuest(): Promise<void> {
    return this.setGuestState(true);
  }

  async disableGuest(): Promise<void> {
    return this.setGuestState(false);
  }

  /** Ping rápido: ¿el router responde y nuestras credenciales son válidas? */
  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureSession();
      await this.getBandConfig("2G");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Activa o desactiva modificando SOLO `Enable2` en ambas bandas.
   * Lee la config actual primero, modifica únicamente ese campo, y aplica.
   * Solo emite comandos si realmente hay un cambio.
   */
  private async setGuestState(enabled: boolean): Promise<void> {
    const target = enabled ? "1" : "0";
    const bands: WifiBand[] = ["2G", "5G"];
    let changed = false;

    for (const band of bands) {
      const currentValues = await this.getBandConfig(band);
      const currentValue = currentValues.Enable2;
      if (currentValue === target) continue;

      // Merge: NO pisamos otros campos. Solo cambiamos Enable2.
      const newValues: UciWificfgValues = { ...currentValues, Enable2: target };
      await this.callWithRetry({
        method: "set",
        payload: { config: "wificfg", section: band, values: newValues },
      });
      changed = true;
    }

    if (changed) {
      await this.applyChanges();
    }
  }

  /** Ejecuta `uci apply` para que los cambios tomen efecto. */
  private async applyChanges(): Promise<void> {
    await this.callWithRetry({
      method: "apply",
      payload: { timeout: "60" },
    });
  }

  /**
   * Parseo defensivo de la respuesta de `uci get`.
   * Acepta DOS formatos de respuesta (compatibilidad con distintos firmwares):
   *   1. OpenWRT estándar: result[1] = { values: { Enable2: "1", ... } }
   *   2. Variante:          result[1] = { Enable2: "1", ... }
   * Lanza un error claro si la respuesta no tiene la forma esperada,
   * incluyendo el JSON crudo para debug.
   */
  private parseUciValues(response: unknown, band: WifiBand): UciWificfgValues {
    if (!response || typeof response !== "object") {
      throw new Error(`uci ${band}: respuesta no es un objeto`);
    }

    const r = response as { result?: unknown; error?: unknown };

    if (r.error !== undefined) {
      throw new Error(`uci ${band} error: ${JSON.stringify(r.error)}`);
    }

    if (!Array.isArray(r.result) || r.result.length < 2) {
      const snippet = JSON.stringify(response).slice(0, 300);
      throw new Error(`uci ${band}: respuesta sin result[1]. Recibido: ${snippet}`);
    }

    const [status, data] = r.result;
    if (status !== 0) {
      throw new Error(`uci ${band}: código ${status}, data: ${JSON.stringify(data)}`);
    }

    if (!data || typeof data !== "object") {
      throw new Error(`uci ${band}: data inválida: ${JSON.stringify(data)}`);
    }

    const dataObj = data as Record<string, unknown>;

    // Formato 1: result[1].values.Enable2
    if (dataObj.values && typeof dataObj.values === "object") {
      return dataObj.values as UciWificfgValues;
    }

    // Formato 2: result[1].Enable2
    return dataObj as UciWificfgValues;
  }

  /**
   * Realiza una llamada UBUS con retry automático ante sesión inválida.
   * Si el router devuelve código de error de sesión, relogea y reintenta UNA vez.
   */
  private async callWithRetry(params: UbusCallParams): Promise<unknown> {
    try {
      return await this.ubusCall(params);
    } catch (err) {
      const message = (err as Error).message;
      if (this.isSessionError(message)) {
        this.invalidateSession();
        return this.ubusCall(params);
      }
      throw err;
    }
  }

  private isSessionError(message: string): boolean {
    return /session/i.test(message) || /access denied/i.test(message) || /unauthorized/i.test(message);
  }

  private async ubusCall(params: UbusCallParams): Promise<unknown> {
    const session = await this.ensureSession();
    const target = [session.token, "uci", params.method, params.payload];

    const body = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "call",
      params: target,
    };

    return this.rawCall(body);
  }

  private async rawCall(body: unknown): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} desde router`);
      }

      return await res.json();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error("Timeout contactando al router");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private nextId(): number {
    this.callId = (this.callId % 1_000_000) + 1;
    return this.callId;
  }
}
