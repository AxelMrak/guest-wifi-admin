/**
 * SchedulerService
 * ----------------------------------------------------------------------------
 * Evalúa la configuración actual contra la hora del sistema y decide
 * si la red de invitados debe estar activa o no.
 *
 * Características:
 *   - Corre cada 60s en el backend (independiente de la UI).
 *   - Sincronización inicial al arrancar: aplica el estado correcto
 *     antes de iniciar el ciclo periódico.
 *   - Solo emite comandos cuando hay un cambio real.
 *   - Maneja correctamente el caso "horario que cruza medianoche"
 *     (ej: 22:00 → 06:00).
 *   - Si hay override manual activo, lo respeta.
 *
 * Vive en el backend por diseño: aunque nadie abra la UI, el servidor
 * sigue controlando el router.
 */

import type { ConfigService } from "./ConfigService";
import type { RouterService } from "./RouterService";
import type { AppSettings } from "@shared/types";

const TICK_INTERVAL_MS = 60_000;

export type SchedulerEvent =
  | { type: "tick"; at: string; desiredActive: boolean; currentActive: boolean; changed: boolean; reason: string }
  | { type: "apply"; at: string; desiredActive: boolean; previous: boolean; success: boolean; error?: string }
  | { type: "error"; at: string; error: string }
  | { type: "started"; at: string }
  | { type: "stopped"; at: string };

type Listener = (event: SchedulerEvent) => void;

export class SchedulerService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<Listener>();
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly router: RouterService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Arranca el scheduler.
   * 1. Carga settings.
   * 2. Evalúa inmediatamente (corrige drift si la PC estuvo apagada).
   * 3. Inicia el ciclo cada 60s.
   */
  async start(): Promise<void> {
    if (this.interval) return;

    this.emit({ type: "started", at: new Date().toISOString() });

    // Sincronización inicial: aplicamos el estado correcto YA, sin esperar al
    // primer tick. Crítico cuando la máquina estuvo apagada toda la noche.
    await this.syncOnBoot();

    this.interval = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    this.emit({ type: "stopped", at: new Date().toISOString() });
  }

  isRunning(): boolean {
    return this.interval !== null;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------------------------------------------------------------------------
  // Sincronización inicial
  // ---------------------------------------------------------------------------

  /**
   * Llamado UNA VEZ al arrancar. Aplica el estado que debería haber según
   * el horario configurado, sin esperar al primer tick.
   */
  async syncOnBoot(): Promise<void> {
    try {
      const settings = await this.config.loadSettings();
      const desired = this.evaluate(settings);
      const current = await this.router.getGuestStatus();
      const wasActive = current.active;

      this.emit({
        type: "tick",
        at: new Date().toISOString(),
        desiredActive: desired,
        currentActive: wasActive,
        changed: desired !== wasActive,
        reason: "syncOnBoot",
      });

      if (desired !== wasActive) {
        await this.applyState(desired, wasActive);
      }
    } catch (err) {
      this.emit({ type: "error", at: new Date().toISOString(), error: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------------

  /** Llamado periódicamente. Público para tests. */
  async tick(): Promise<void> {
    if (this.ticking) return; // evitar solapamiento si una corrida tarda más de 60s
    this.ticking = true;
    try {
      const settings = await this.config.loadSettings();
      const desired = this.evaluate(settings);

      let currentActive: boolean;
      try {
        const current = await this.router.getGuestStatus();
        currentActive = current.active;
      } catch {
        // No se puede leer el router ahora; abortar este tick silenciosamente.
        this.emit({
          type: "tick",
          at: new Date().toISOString(),
          desiredActive: desired,
          currentActive: false,
          changed: false,
          reason: "router-unreachable",
        });
        return;
      }

      this.emit({
        type: "tick",
        at: new Date().toISOString(),
        desiredActive: desired,
        currentActive,
        changed: desired !== currentActive,
        reason: "periodic",
      });

      if (desired !== currentActive) {
        await this.applyState(desired, currentActive);
      }
    } catch (err) {
      this.emit({ type: "error", at: new Date().toISOString(), error: (err as Error).message });
    } finally {
      this.ticking = false;
    }
  }

  /** Lógica pura: dado settings + ahora, ¿la red debería estar activa? */
  evaluate(settings: AppSettings, now: Date = new Date()): boolean {
    // 1) Override manual gana sobre todo.
    if (settings.manualOverride) {
      return settings.manualState;
    }

    // 2) Si la programación está deshabilitada, mantener el último estado conocido.
    if (!settings.scheduleEnabled) {
      return settings.lastKnownState;
    }

    // 3) Verificar día.
    const day = now.getDay(); // 0 = Domingo
    if (!settings.days.includes(day)) {
      return false;
    }

    // 4) Verificar hora (soporta cruce de medianoche).
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const startMin = this.toMinutes(settings.startTime);
    const endMin = this.toMinutes(settings.endTime);

    if (startMin === endMin) return false; // horario vacío
    if (startMin < endMin) {
      return minutesNow >= startMin && minutesNow < endMin;
    }
    // Cruza medianoche: ej 22:00 → 06:00
    return minutesNow >= startMin || minutesNow < endMin;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async applyState(desired: boolean, previous: boolean): Promise<void> {
    try {
      if (desired) {
        await this.router.enableGuest();
      } else {
        await this.router.disableGuest();
      }

      // Anotar el último estado conocido (cache, sin validar).
      await this.config.patchRaw({ lastKnownState: desired });

      this.emit({
        type: "apply",
        at: new Date().toISOString(),
        desiredActive: desired,
        previous,
        success: true,
      });
    } catch (err) {
      this.emit({
        type: "apply",
        at: new Date().toISOString(),
        desiredActive: desired,
        previous,
        success: false,
        error: (err as Error).message,
      });
    }
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }

  private emit(event: SchedulerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // un listener roto no debe matar el scheduler
      }
    }
  }
}
