/**
 * RouterService
 * ----------------------------------------------------------------------------
 * Encapsula TODA la comunicación con el router mediante el protocolo UBUS.
 *
 * Basado en las llamadas reales del portal cautivo del router (ZTE/Huawei).
 * Usa config "wificfg", secciones "2G"/"5G", y clave Enable2.
 */

import type { WifiBand } from "../types";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

const UBUS_NULL_SESSION = "00000000000000000000000000000000";
const REQUEST_TIMEOUT_MS = 8_000;
const UCI_CONFIG = "wificfg";

export type LogFn = (message: string) => void;

interface RouterSession {
  token: string;
  obtainedAt: number;
}

interface UbusCallParams {
  service: string;
  method: string;
  payload: Record<string, unknown>;
}

/** Información de una sección WiFi descubierta en el UCI */
interface WirelessSection {
  /** Nombre de la sección UCI (ej: "@wifi-iface[1]") */
  uciName: string;
  /** Banda inferida: "2G" o "5G" */
  band: WifiBand;
  /** Clave que controla encendido/apagado ("Enable2" o "disabled") */
  enableKey: string;
  /** Valor de la clave que significa "activado" */
  activeValue: string;
  /** Valor de la clave que significa "desactivado" */
  inactiveValue: string;
}

/** Valores crudos de una sección UCI */
interface UciSectionValues {
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// RouterService
// ---------------------------------------------------------------------------

export class RouterService {
  private readonly url: string;
  private readonly username: string;
  private readonly password: string;
  private readonly log: LogFn;
  private readonly phoneId: string;
  private readonly rid: string;

  private session: RouterSession | null = null;
  private loginInFlight: Promise<RouterSession> | null = null;
  private callId = 1;

  /** Caché de secciones descubiertas (se puebla en el primer getGuestStatus) */
  private cachedSections: WirelessSection[] | null = null;

  constructor(config: {
    url: string;
    username: string;
    password: string;
    phoneId?: string;
    rid?: string;
    log?: LogFn;
  }) {
    this.url = config.url;
    this.username = config.username;
    this.password = config.password;
    this.phoneId = config.phoneId ?? "";
    this.rid = config.rid ?? "";
    this.log = config.log ?? (() => {});
  }

  /**
   * URL final con query params del portal cautivo (phoneId, rid) si están configurados.
   * El portal cautivo agrega estos params desde localStorage después del login HTTP.
   */
  private get ubusUrl(): string {
    if (!this.phoneId && !this.rid) return this.url;
    const u = new URL(this.url);
    if (this.phoneId) u.searchParams.set("phoneId", this.phoneId);
    if (this.rid) u.searchParams.set("rid", this.rid);
    return u.toString();
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

    this.log(`[login] POST ${this.url} intentando sesión…`);
    const res = await this.rawCall(body);

    if (!res) {
      throw new Error("Login UBUS: sin respuesta del router");
    }

    // Error explícito del router
    if (res.error) {
      const snippet = JSON.stringify(res.error).slice(0, 400);
      throw new Error(`Login UBUS rechazado: ${snippet}`);
    }

    // Resultado exitoso: formato [0, { ubus_rpc_session: "…" }]
    if (Array.isArray(res.result)) {
      const statusCode = res.result[0];
      if (statusCode !== 0) {
        throw new Error(
          `Login UBUS: código de estado ${statusCode} – ${JSON.stringify(res.result).slice(0, 300)}`,
        );
      }

      const data = res.result[1];

      // Formato 1: { ubus_rpc_session: "token" }
      if (typeof data === "object" && data !== null && "ubus_rpc_session" in data) {
        const token = (data as Record<string, unknown>).ubus_rpc_session as string;
        this.session = { token, obtainedAt: Date.now() };
        this.log(`[login] sesión obtenida (token: ${token.slice(0, 8)}…)`);
        return this.session;
      }

      // Formato 2: el token es directamente un string en result[1]
      if (typeof data === "string" && data.length > 10) {
        this.session = { token: data, obtainedAt: Date.now() };
        this.log(`[login] sesión obtenida (token directo: ${data.slice(0, 8)}…)`);
        return this.session;
      }

      // Formato 3: { token: "…" } o { session: "…" }
      if (typeof data === "object" && data !== null) {
        const obj = data as Record<string, unknown>;
        const token = (obj.token ?? obj.session ?? obj.session_id) as string | undefined;
        if (typeof token === "string" && token.length > 10) {
          this.session = { token, obtainedAt: Date.now() };
          this.log(`[login] sesión obtenida (campo alternativo: ${token.slice(0, 8)}…)`);
          return this.session;
        }
      }

      throw new Error(
        `Login UBUS: no se pudo extraer token de la respuesta: ${JSON.stringify(data).slice(0, 300)}`,
      );
    }

    // Resultado no es array, tal vez es un objeto con token directo
    if (typeof res.result === "object" && res.result !== null) {
      const obj = res.result as Record<string, unknown>;
      const token = (obj.ubus_rpc_session ?? obj.token ?? obj.session) as string | undefined;
      if (typeof token === "string" && token.length > 10) {
        this.session = { token, obtainedAt: Date.now() };
        this.log(`[login] sesión obtenida (formato objeto: ${token.slice(0, 8)}…)`);
        return this.session;
      }
    }

    throw new Error(
      `Login UBUS: formato de respuesta inesperado: ${JSON.stringify(res).slice(0, 400)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /**
   * Estado actual de la red de invitados.
   * Una banda se considera activa si la clave de control (Enable2 o disabled)
   * tiene el valor que significa "encendido".
   *
   * En el primer llamado descubre automáticamente las secciones wireless del
   * router. Si el descubrimiento falla, lanza error con instrucciones.
   */
  async getGuestStatus(): Promise<{
    active: boolean;
    values: Record<WifiBand, string | undefined>;
    sections: Record<string, string>;
  }> {
    // Descubrir secciones si no tenemos caché
    if (!this.cachedSections) {
      this.cachedSections = await this.discoverGuestSections();
    }

    const results: Record<WifiBand, { rawValue: string | undefined; active: boolean }> = {
      "2G": { rawValue: undefined, active: false },
      "5G": { rawValue: undefined, active: false },
    };

    const sectionMap: Record<string, string> = {};

    for (const section of this.cachedSections) {
      sectionMap[section.band] = section.uciName;

      try {
        const values = await this.getSectionValues(section.uciName);
        const rawValue = values[section.enableKey];
        results[section.band].rawValue = rawValue;
        results[section.band].active = rawValue === section.activeValue;
      } catch (err) {
        this.log(`[getGuestStatus] error leyendo ${section.band} (${section.uciName}): ${(err as Error).message}`);
        // Si una banda falla, la tratamos como inactiva (safe default)
      }
    }

    const active = results["2G"].active && results["5G"].active;

    return {
      active,
      values: {
        "2G": results["2G"].rawValue,
        "5G": results["5G"].rawValue,
      },
      sections: sectionMap,
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
      // Forzamos descubrimiento fresco
      this.cachedSections = null;
      await this.getGuestStatus();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Lista TODOS los servicios UBUS disponibles en el router.
   * Usa sesión autenticada porque este router restringe `list` sin auth.
   * `ubus list` sin params devuelve array de nombres de servicio.
   */
  async listAllServices(): Promise<string[]> {
    await this.ensureSession();

    const body = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "list",
      params: [],
    };

    this.log("[list] consultando servicios UBUS disponibles…");
    const res = await this.rawCall(body);

    if (!res || typeof res !== "object") {
      throw new Error("list: sin respuesta del router");
    }

    if (res.error) {
      throw new Error(`list: ${JSON.stringify(res.error).slice(0, 300)}`);
    }

    this.log(`[list] raw response: ${JSON.stringify(res).slice(0, 600)}`);

    const raw = res.result;
    if (Array.isArray(raw)) {
      return raw as string[];
    }

    const obj = raw as Record<string, unknown>;
    if (obj && typeof obj === "object") {
      return Object.keys(obj);
    }

    throw new Error(`list: resultado inesperado: ${JSON.stringify(res).slice(0, 300)}`);
  }

  /**
   * Describe los métodos y firmas de un servicio UBUS (con auth).
   * `ubus list [name]` devuelve { método: { params: ... } }.
   */
  async describeService(name: string): Promise<Record<string, unknown>> {
    await this.ensureSession();

    const body = {
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "list",
      params: [name],
    };

    const res = await this.rawCall(body);

    if (!res || typeof res !== "object") {
      throw new Error(`describe ${name}: sin respuesta`);
    }

    if (res.error) {
      throw new Error(`describe ${name}: ${JSON.stringify(res.error).slice(0, 300)}`);
    }

    const methods = res.result as Record<string, unknown> | undefined;
    if (!methods || typeof methods !== "object") {
      throw new Error(`describe ${name}: resultado inesperado`);
    }

    this.log(`[describe] "${name}" → ${Object.keys(methods).join(", ")}`);
    return methods;
  }

  /**
   * Llama a un método arbitrario de un servicio (con auth).
   * Útil para explorar API de routerd y similares.
   */
  async callService(service: string, method: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.callWithRetry({ service, method, payload });
  }

  // ---------------------------------------------------------------------------
  // Descubrimiento de secciones
  // ---------------------------------------------------------------------------

  /**
   * Descubre automáticamente las secciones WiFi de invitados en el UCI.
   *
   * Estrategia:
   *   1. Obtener TODA la configuración wireless del router.
   *   2. Buscar secciones que parezcan interfaces de invitados
   *      (por network="guest", ssid que contenga "guest"/"invitado",
   *       o que sean wifi-iface con propiedades particulares).
   *   3. Si no se encuentran, intentar @wifi-iface[0], @wifi-iface[1], etc.
   *
   * Lanza error con instrucciones si no puede descubrir nada.
   */
  private async discoverGuestSections(): Promise<WirelessSection[]> {
    this.log("[discover] buscando secciones wireless del guest…");

    const allSections = await this.getAllWirelessSections();

    if (!allSections || Object.keys(allSections).length === 0) {
      throw new Error(
        `No se pudo obtener la configuración wireless del router. ` +
        `Verificá que la URL (${this.url}) y las credenciales sean correctas.`,
      );
    }

    this.log(`[discover] secciones encontradas: ${Object.keys(allSections).join(", ")}`);

    // Filtrar las que parezcan interfaces WiFi de invitados
    const guestCandidates = this.findGuestInterfaces(allSections);

    if (guestCandidates.length >= 2) {
      this.log(`[discover] interfaces guest detectadas: ${guestCandidates.map((s) => `${s.band}=${s.uciName}`).join(", ")}`);
      return guestCandidates;
    }

    // No encontramos suficientes — intentar con patrones comunes
    this.log("[discover] búsqueda heurística de interfaces invitado…");
    const heuristic = this.heuristicGuestSections(allSections);

    if (heuristic.length >= 2) {
      this.log(`[discover] interfaces guest (heurística): ${heuristic.map((s) => `${s.band}=${s.uciName}`).join(", ")}`);
      return heuristic;
    }

    // Último recurso: listar lo que hay para que el usuario configure manualmente
    const available = Object.entries(allSections)
      .map(([name, vals]) => {
        const type = vals[".type"] ?? "desconocido";
        const ssid = vals.ssid ?? "(sin SSID)";
        const network = vals.network ?? "(sin network)";
        return `  • ${name} (${type}) ssid=${ssid} network=${network}`;
      })
      .join("\n");

    throw new Error(
      `No se encontraron interfaces WiFi de invitados.\n\n` +
      `Secciones wireless del router:\n${available}\n\n` +
      `Para configurar manualmente, ejecutá en el router:\n` +
      `  uci show wireless | grep -i guest\n` +
      `Y agregá los nombres de sección al archivo de configuración.`,
    );
  }

  /**
   * Obtiene todas las secciones de la configuración wireless.
   * Prueba varios métodos de UBUS (algunos routers exponen la API de forma distinta).
   */
  private async getAllWirelessSections(): Promise<Record<string, UciSectionValues> | null> {
    // Único path que funciona en este router: rkey.uci.get.
    // El router bloquea `uci.*` por ACL y `uci.get_all` devuelve [3].
    const res = await this.ubusCallRaw({
      service: "rkey.uci",
      method: "get",
      payload: { config: UCI_CONFIG },
    });
    return this.extractSectionsFromResponse(res);
  }

  /**
   * Dado un objeto con todas las secciones wireless, identifica cuáles son
   * las interfaces de invitados.
   *
   * Criterios:
   *   - Tipo ".type" = "wifi-iface" (no "wifi-device")
   *   - network = "guest" o similar
   *   - ssid contiene "guest", "invitado", "invitad"
   *   - O si no hay candidatos claros, asume que las últimas wifi-iface son guest
   */
  private findGuestInterfaces(allSections: Record<string, UciSectionValues>): WirelessSection[] {
    // Firmware custom (router ISP): secciones type=Radio con clave Enable2
    // son las radios guest (2G/5G con main y guest coexistiendo).
    const radioGuests = Object.entries(allSections)
      .filter(([name, vals]) => {
        if (vals[".type"] !== "Radio") return false;
        if (!("Enable2" in vals)) return false;
        return name !== "global";
      })
      .map(([name, vals]) => ({ name, vals }));

    if (radioGuests.length >= 2) {
      return this.buildSections(radioGuests.slice(0, 2));
    }

    // OpenWRT estándar: wifi-iface con network=guest o SSID patrón
    const ifaces = Object.entries(allSections)
      .filter(([, vals]) => vals[".type"] === "wifi-iface")
      .map(([name, vals]) => ({ name, vals }));

    if (ifaces.length < 2) return [];

    const guestPattern = /guest|invitad|visitante/i;

    const guestIfaces = ifaces.filter(({ vals }) => {
      const net = (vals.network ?? "").toLowerCase();
      const ssid = (vals.ssid ?? "").toLowerCase();
      return guestPattern.test(net) || guestPattern.test(ssid);
    });

    if (guestIfaces.length >= 2) {
      return this.buildSections(guestIfaces.slice(0, 2));
    }

    if (guestIfaces.length === 1) {
      const other = ifaces.find((i) => i.name !== guestIfaces[0].name);
      if (other) {
        return this.buildSections([guestIfaces[0], other]);
      }
    }

    if (ifaces.length === 2) {
      return this.buildSections(ifaces);
    }

    return [];
  }

  /**
   * Heurística de último recurso: asume que las últimas wifi-iface son guest.
   */
  private heuristicGuestSections(allSections: Record<string, UciSectionValues>): WirelessSection[] {
    const ifaces = Object.entries(allSections)
      .filter(([, vals]) => vals[".type"] === "wifi-iface")
      .map(([name, vals]) => ({ name, vals }));

    if (ifaces.length < 2) return [];

    // Tomamos las últimas 2 wifi-iface (las guest suelen agregarse después de las principales)
    const candidates = ifaces.slice(-2);
    return this.buildSections(candidates);
  }

  /**
   * Construye objetos WirelessSection a partir de los candidatos detectados,
   * determinando la banda (2G o 5G) y la clave de control.
   */
  private buildSections(
    candidates: { name: string; vals: UciSectionValues }[],
  ): WirelessSection[] {
    return candidates.map(({ name, vals }, index) => {
      let band: WifiBand = index === 0 ? "2G" : "5G";

      // Firmware custom: el nombre de la sección ES la banda ("2G", "5G")
      if (name === "2G" || name === "5G") {
        band = name;
      }

      // OpenWRT estándar: inferir desde device
      const device = vals.device;
      if (typeof device === "string") {
        const lower = device.toLowerCase();
        if (lower.includes("5g") || lower.includes("radio1") || lower.includes("radio_5g")) {
          band = "5G";
        } else if (lower.includes("2g") || lower.includes("radio0") || lower.includes("radio_2g")) {
          band = "2G";
        }
      }

      const enableKey = this.detectEnableKey(vals);

      return {
        uciName: name,
        band,
        enableKey,
        activeValue: enableKey === "disabled" ? "0" : "1",
        inactiveValue: enableKey === "disabled" ? "1" : "0",
      };
    });
  }

  /**
   * Detecta qué clave controla el encendido/apagado en los valores de la sección.
   * Prioridad: Enable2 (firmwares custom) > disabled (OpenWRT estándar)
   */
  private detectEnableKey(vals: UciSectionValues): string {
    if ("Enable2" in vals) return "Enable2";
    if ("enabled2" in vals) return "enabled2";
    if ("enable2" in vals) return "enable2";
    if ("disabled" in vals) return "disabled";
    if ("disabled2" in vals) return "disabled2";
    // Fallback: asumimos disabled (estándar OpenWRT)
    return "disabled";
  }

  /**
   * Obtiene los valores de una sección específica del UCI.
   */
  private async getSectionValues(sectionName: string): Promise<UciSectionValues> {
    const res = await this.callWithRetry({
      service: "rkey.uci",
      method: "get",
      payload: { config: UCI_CONFIG, section: sectionName },
    });
    return this.parseSingleSection(res, sectionName);
  }

  // ---------------------------------------------------------------------------
  // Parseo de respuestas UCI
  // ---------------------------------------------------------------------------

  /** Extrae TODAS las secciones de una respuesta UBUS uci (get_all o get sin sección). */
  private extractSectionsFromResponse(res: unknown): Record<string, UciSectionValues> | null {
    if (!res || typeof res !== "object") return null;

    const r = res as { result?: unknown; error?: unknown };
    if (r.error !== undefined) return null;

    if (!Array.isArray(r.result) || r.result.length < 2) return null;

    const status = r.result[0];
    if (status !== 0) return null;

    const wrapper = r.result[1];
    if (!wrapper || typeof wrapper !== "object") return null;

    // `rkey.uci.get({config})` envuelve en {values:{section:{...}}}
    // `uci.get` estándar lo devuelve plano {section:{...}}
    const data = (wrapper as Record<string, unknown>).values ?? wrapper;
    if (!data || typeof data !== "object") return null;

    const result: Record<string, UciSectionValues> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        if (".type" in val || ".name" in val || ".anonymous" in val) {
          result[key] = val as UciSectionValues;
        }
      }
    }

    return result;
  }



  /**
   * Parseo de respuesta de una sección individual.
   * Acepta DOS formatos (compatibilidad con distintos firmwares):
   *   1. result[1].values.Enable2 (formato con objeto values anidado)
   *   2. result[1].Enable2 (formato plano)
   */
  private parseSingleSection(res: unknown, sectionName: string): UciSectionValues {
    if (!res || typeof res !== "object") {
      throw new Error(`uci ${sectionName}: respuesta no es un objeto`);
    }

    const r = res as { result?: unknown; error?: unknown };

    if (r.error !== undefined) {
      this.log(`[uci] error en ${sectionName}: ${JSON.stringify(r.error).slice(0, 300)}`);
      throw new Error(`uci ${sectionName}: error del router – ${JSON.stringify(r.error).slice(0, 200)}`);
    }

    if (!Array.isArray(r.result) || r.result.length < 2) {
      const snippet = JSON.stringify(res).slice(0, 300);
      throw new Error(`uci ${sectionName}: respuesta sin result[1]. Recibido: ${snippet}`);
    }

    const [status, data] = r.result;
    if (status !== 0) {
      throw new Error(`uci ${sectionName}: código ${status}, data: ${JSON.stringify(data).slice(0, 300)}`);
    }

    if (!data || typeof data !== "object") {
      throw new Error(`uci ${sectionName}: data inválida: ${JSON.stringify(data).slice(0, 200)}`);
    }

    const dataObj = data as Record<string, unknown>;

    // Formato 1: result[1].values.Enable2
    if (dataObj.values && typeof dataObj.values === "object") {
      this.log(`[uci] ${sectionName}: valores encontrados (formato anidado), keys: ${Object.keys(dataObj.values as object).join(", ")}`);
      return dataObj.values as UciSectionValues;
    }

    // Formato 2: result[1].Enable2 (plano)
    this.log(`[uci] ${sectionName}: valores encontrados (formato plano), keys: ${Object.keys(dataObj).join(", ")}`);
    return dataObj as UciSectionValues;
  }

  // ---------------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------------

  /**
   * Activa o desactiva la red de invitados modificando SOLO la clave de control
   * en cada banda. Solo emite comandos si realmente hay un cambio.
   */
  private async setGuestState(enabled: boolean): Promise<void> {
    if (!this.cachedSections) {
      this.cachedSections = await this.discoverGuestSections();
    }

    let changed = false;

    for (const section of this.cachedSections) {
      const currentValues = await this.getSectionValues(section.uciName);
      const targetValue = enabled ? section.activeValue : section.inactiveValue;
      const currentValue = currentValues[section.enableKey];

      if (currentValue === targetValue) continue;

      this.log(`[setGuestState] cambiando ${section.band} (${section.uciName}).${section.enableKey}: ${currentValue} → ${targetValue}`);

      await this.callWithRetry({
        service: "rkey.uci",
        method: "set",
        payload: {
          config: UCI_CONFIG,
          section: section.uciName,
          values: { [section.enableKey]: targetValue },
          apply: true,
        },
      });
      changed = true;
    }

    if (changed) {
      await this.applyChanges();
    }
  }

  /**
   * Espera a que el subsistema WiFi procese los cambios UCI.
   * El apply real se hace dentro del set con `apply: true` (la única vía que
   * funciona en este firmware — `uci.apply` y `rkey.uci.apply` devuelven
   * `[5]` y `[3]` respectivamente). Acá solo esperamos el estado.
   */
  private async applyChanges(): Promise<void> {
    this.log(`[apply] esperando que WiFi aplique cambios en ${UCI_CONFIG}…`);
    try {
      await this.waitForWifiApply();
    } catch (err) {
      this.log(`[apply] wifi.get_apply_status falló (no crítico): ${(err as Error).message}`);
    }
    this.log(`[apply] cambios aplicados.`);
  }

  /**
   * Espera a que el subsistema WiFi termine de aplicar los cambios de UCI.
   * Llama a `wifi.get_apply_status` hasta que devuelva success.
   */
  private async waitForWifiApply(): Promise<void> {
    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      const res = (await this.callWithRetry({
        service: "wifi",
        method: "get_apply_status",
        payload: {},
      })) as { status?: string; success?: boolean };

      if (res?.status === "success" || res?.success === true) {
        this.log(`[apply] wifi listo (intento ${i + 1})`);
        return;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error("wifi.get_apply_status no terminó a tiempo");
  }

  /** Limpia la caché de secciones — útil después de un cambio de config. */
  clearSectionCache(): void {
    this.cachedSections = null;
  }

  // ---------------------------------------------------------------------------
  // Llamadas UBUS
  // ---------------------------------------------------------------------------

  /**
   * Llamada UBUS con retry automático ante sesión inválida.
   */
  private async callWithRetry(params: UbusCallParams): Promise<unknown> {
    try {
      return await this.ubusCallRaw(params);
    } catch (err) {
      const message = (err as Error).message;
      if (this.isSessionError(message)) {
        this.log(`[retry] sesión inválida detectada, relogeando…`);
        this.invalidateSession();
        return this.ubusCallRaw(params);
      }
      throw err;
    }
  }

  private isSessionError(message: string): boolean {
    return (
      /session/i.test(message) ||
      /unauthorized/i.test(message) ||
      /no permission/i.test(message) ||
      /not found/i.test(message)
    );
  }

  private async ubusCallRaw(params: UbusCallParams): Promise<unknown> {
    const session = await this.ensureSession();
    const target = [session.token, params.service, params.method, params.payload];

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
      const targetUrl = this.ubusUrl;
      const routerOrigin = new URL(targetUrl).origin;
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Referer": routerOrigin + "/",
          "Origin": routerOrigin,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(sin cuerpo)");
        throw new Error(`HTTP ${res.status} desde router: ${text.slice(0, 200)}`);
      }

      const json = (await res.json()) as Record<string, unknown>;

      // Si hay error UBUS, loguearlo para debug
      if (json.error) {
        this.log(`[ubus] error: ${JSON.stringify(json.error).slice(0, 300)}`);
      }

      return json;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error("Timeout contactando al router (8s)");
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
