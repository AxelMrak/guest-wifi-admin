/**
 * ConfigService
 * ----------------------------------------------------------------------------
 * Persistencia simple en `data/settings.json`.
 *
 * Es async-friendly y thread-safe a nivel de proceso: usa un Mutex en memoria
 * para evitar condiciones de carrera entre requests concurrentes.
 *
 * En el futuro, si se quiere cambiar a SQLite o Postgres, este es el único
 * punto a tocar.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppSettings, UpdateSettingsPayload } from "@shared/types";

const DEFAULT_SETTINGS: AppSettings = {
  scheduleEnabled: false,
  startTime: "08:00",
  endTime: "22:00",
  days: [1, 2, 3, 4, 5, 6, 0],
  manualOverride: false,
  manualState: true,
  lastKnownState: true,
};

class Mutex {
  private chain: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }
}

export class ConfigService {
  private readonly filePath: string;
  private cache: AppSettings | null = null;
  private readonly mutex = new Mutex();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async loadSettings(): Promise<AppSettings> {
    return this.mutex.run(async () => {
      if (this.cache) return structuredClone(this.cache);

      try {
        const raw = await fs.readFile(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        const merged = this.mergeWithDefaults(parsed);
        this.cache = merged;
        return structuredClone(merged);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          // Primera ejecución: crear el archivo con defaults.
          const initial = { ...DEFAULT_SETTINGS };
          await this.writeToDisk(initial);
          this.cache = initial;
          return structuredClone(initial);
        }
        throw err;
      }
    });
  }

  async saveSettings(updates: UpdateSettingsPayload): Promise<AppSettings> {
    return this.mutex.run(async () => {
      const current = this.cache ?? (await this.loadSettingsFromDisk());
      const next: AppSettings = {
        ...current,
        ...updates,
      };
      this.validate(next);
      await this.writeToDisk(next);
      this.cache = next;
      return structuredClone(next);
    });
  }

  /**
   * Actualización parcial que NO pasa por validación completa.
   * Usado por el scheduler para anotar `lastKnownState` rápidamente.
   */
  async patchRaw(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.mutex.run(async () => {
      const current = this.cache ?? (await this.loadSettingsFromDisk());
      const next: AppSettings = { ...current, ...patch };
      await this.writeToDisk(next);
      this.cache = next;
      return structuredClone(next);
    });
  }

  /** Invalida el cache (útil en tests). */
  invalidate(): void {
    this.cache = null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadSettingsFromDisk(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      return this.mergeWithDefaults(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...DEFAULT_SETTINGS };
      }
      throw err;
    }
  }

  private async writeToDisk(settings: AppSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Escritura atómica: tmp + rename.
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(settings, null, 2), "utf-8");
    await fs.rename(tmp, this.filePath);
  }

  private mergeWithDefaults(partial: Partial<AppSettings>): AppSettings {
    return {
      ...DEFAULT_SETTINGS,
      ...partial,
      // Arrays: si vienen vacíos o ausentes, usar defaults.
      days: Array.isArray(partial.days) && partial.days.length > 0 ? partial.days : DEFAULT_SETTINGS.days,
    };
  }

  private validate(settings: AppSettings): void {
    if (!/^\d{2}:\d{2}$/.test(settings.startTime)) {
      throw new Error(`startTime inválido: ${settings.startTime}`);
    }
    if (!/^\d{2}:\d{2}$/.test(settings.endTime)) {
      throw new Error(`endTime inválido: ${settings.endTime}`);
    }
    for (const d of settings.days) {
      if (d < 0 || d > 6 || !Number.isInteger(d)) {
        throw new Error(`Día inválido: ${d}`);
      }
    }
  }
}
