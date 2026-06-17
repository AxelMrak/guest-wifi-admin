/**
 * Tipos compartidos entre el cliente y el servidor.
 * Mantener este archivo sincronizado para que los contratos de la API
 * no se rompan.
 */

/** Configuración persistida de la aplicación */
export interface AppSettings {
  /** Si la programación automática está habilitada */
  scheduleEnabled: boolean;
  /** Hora de inicio del rango (formato HH:mm, 24h) */
  startTime: string;
  /** Hora de fin del rango (formato HH:mm, 24h) */
  endTime: string;
  /**
   * Días activos de la semana.
   * 0 = Domingo, 1 = Lunes, ... 6 = Sábado
   */
  days: number[];
  /** Si el usuario hizo un override manual (pausa la programación) */
  manualOverride: boolean;
  /** Estado deseado por el override manual */
  manualState: boolean;
  /** Último estado conocido de la red (cache para evitar llamadas innecesarias) */
  lastKnownState: boolean;
}

/** Estado actual de la red de invitados + conexión con el router */
export interface NetworkStatus {
  /** Estado actual de la red de invitados (true = activa) */
  active: boolean;
  /** Si el router responde correctamente */
  routerConnected: boolean;
  /** Mensaje de error si routerConnected === false */
  routerError?: string;
  /** Última vez que se consultó el router (ISO) */
  lastSyncAt: string;
  /** Configuración actual (snapshot) */
  settings: AppSettings;
}

/** Respuesta genérica de la API */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Payload para actualizar la configuración */
export interface UpdateSettingsPayload {
  scheduleEnabled?: boolean;
  startTime?: string;
  endTime?: string;
  days?: number[];
}

/** Días de la semana en español */
export const WEEK_DAYS = [
  { value: 1, label: "Lunes", short: "L" },
  { value: 2, label: "Martes", short: "M" },
  { value: 3, label: "Miércoles", short: "X" },
  { value: 4, label: "Jueves", short: "J" },
  { value: 5, label: "Viernes", short: "V" },
  { value: 6, label: "Sábado", short: "S" },
  { value: 0, label: "Domingo", short: "D" },
] as const;

export type WeekDayValue = (typeof WEEK_DAYS)[number]["value"];
