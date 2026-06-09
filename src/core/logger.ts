export interface Logger {
  child(scope: string): Logger;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return new ConsoleLogger(scope);
}

class ConsoleLogger implements Logger {
  constructor(private readonly scope: string) {}

  child(scope: string): Logger {
    return new ConsoleLogger(`${this.scope}:${scope}`);
  }

  debug(message: string, data?: unknown): void {
    this.#write("debug", message, data);
  }

  info(message: string, data?: unknown): void {
    this.#write("info", message, data);
  }

  warn(message: string, data?: unknown): void {
    this.#write("warn", message, data);
  }

  error(message: string, data?: unknown): void {
    this.#write("error", message, data);
  }

  #write(level: string, message: string, data?: unknown): void {
    const prefix = `[${new Date().toISOString()}] [${level}] [${this.scope}]`;
    if (data === undefined) {
      console.log(`${prefix} ${message}`);
      return;
    }

    console.log(`${prefix} ${message}`, data);
  }
}
