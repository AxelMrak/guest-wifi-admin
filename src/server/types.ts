/**
 * Tipos internos del backend (no expuestos al cliente).
 * Aquí vive la lógica de protocolo UBUS.
 */

/** Configuración cruda de una banda devuelta por `uci get` */
export interface UciWificfgValues {
  Enable2?: string;
  [key: string]: string | undefined;
}

/** Respuesta cruda de un `uci get` */
export interface UciGetResult {
  result: [number, UciWificfgValues];
}

/** Respuesta cruda del login UBUS */
export interface UbusLoginResult {
  jsonrpc: string;
  id: number;
  result: [number, { ubus_rpc_session: string }];
}

/** Estado interno del RouterService */
export interface RouterSession {
  token: string;
  obtainedAt: number;
}

/** Bandas WiFi soportadas */
export type WifiBand = "2G" | "5G";
