import type { PlatformService } from "./types.ts";

export class PlatformServiceRegistry {
  #services = new Map<string, PlatformService>();

  register(name: string, service: PlatformService): void {
    if (this.#services.has(name)) {
      throw new Error(`Platform service already registered: ${name}`);
    }
    this.#services.set(name, service);
  }

  get<T extends PlatformService>(name: string): T | undefined {
    return this.#services.get(name) as T | undefined;
  }

  has(name: string): boolean {
    return this.#services.has(name);
  }
}
