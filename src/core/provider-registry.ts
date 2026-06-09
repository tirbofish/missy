import type { AiProvider } from "./types.ts";

export class ProviderRegistry {
  #providers = new Map<string, AiProvider>();

  constructor(private readonly defaultProviderName: string) {}

  register(name: string, provider: AiProvider): void {
    if (this.#providers.has(name)) {
      throw new Error(`AI provider already registered: ${name}`);
    }

    this.#providers.set(name, provider);
  }

  default(): AiProvider {
    return this.get(this.defaultProviderName);
  }

  get(name: string): AiProvider {
    const provider = this.#providers.get(name);
    if (!provider) {
      throw new Error(`Unknown AI provider: ${name}`);
    }

    return provider;
  }

  names(): string[] {
    return [...this.#providers.keys()].sort();
  }
}
