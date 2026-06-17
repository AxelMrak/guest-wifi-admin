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

import type { RouterSession, UciGetResult, WifiBand } from "../types";

const UBUS_NULL_SESSION = "00000000000000000000000000000000";
const REQUEST_TIMEOUT_MS = 8_000;

interface UbusCallParams {
  method: string;
  payload: Record<string, unknown>;
  // Si se setea, se invoca `uci <extra[0]>` en vez de `uci <method>` (ej: "apply").
  extra?: string[];
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

  /** Invalida la sesión actual. Útil cuando el router reporta sesión inválida. */
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
        `Login UBUS falló: ${JSON.stringify(res?.result ?? "sin respuesta")}`,
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

  /** Devuelve la config cruda de una banda (incluye `Enable2`). */
  async getBandConfig(band: WifiBand): Promise<UciGetResult> {
    return this.callWithRetry({
      method: "uci",
      payload: { config: "wificfg", section: band },
    }) as Promise<UciGetResult>;
  }

  /**
   * Estado actual de la red de invitados.
   * Una banda se considera activa si `Enable2 === "1"`.
   * Si alguna banda difiere o no responde, retorna `false` (estado seguro).
   */
  async getGuestStatus(): Promise<{ active: boolean; values: Record<WifiBand, string | undefined> }> {
    const [band2G, band5G] = await Promise.all([
      this.getBandConfig("2G").catch(() => null),
      this.getBandConfig("5G").catch(() => null),
    ]);

    const v2g = band2G?.result?.[1]?.Enable2;
    const v5g = band5G?.result?.[1]?.Enable2;

    // Solo consideramos activa si AMBAS bandas lo están.
    const active = v2g === "1" && v5g === "1";

    return {
      active,
      values: { "2G": v2g, "5G": v5g },
    };
  }

  /** Activa la red de invitados en ambas bandas. No-op si ya está activa. */
  async enableGuest(): Promise<void> {
    return this.setGuestState(true);
  }

  /** Desactiva la red de invitados en ambas bandas. No-op si ya está desactivada. */
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
      const current = await this.getBandConfig(band);
      const currentValue = current.result?.[1]?.Enable2;
      if (currentValue === target) continue;

      // Merge inteligente: NO pisamos otros campos. Solo cambiamos Enable2.
      const newValues = { ...current.result[1], Enable2: target };
      await this.callWithRetry({
        method: "uci",
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
      method: "uci",
      payload: { timeout: "60" },
      extra: ["apply"],
    });
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
        // Forzar re-login y reintentar una sola vez.
        this.invalidateSession();
        return this.ubusCall(params);
      }
      throw err;
    }
  }

  private isSessionError(message: string): boolean {
    return /session/i.test(message) || /5$/.test(message); // UBUS usa 5 para session errors
  }

  private async ubusCall(params: UbusCallParams): Promise<unknown> {
    const session = await this.ensureSession();
    const target = params.extra ? [session.token, "uci", params.extra[0], params.payload] : [session.token, "uci", params.method, params.payload];

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
