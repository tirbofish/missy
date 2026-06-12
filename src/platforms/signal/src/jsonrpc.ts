/** JSON-RPC 2.0 client for signal-cli daemon. */

import { createConnection, type Socket } from "node:net";
import type { AgentContext } from "../../../core/types.ts";

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

type NotificationHandler = (params: Record<string, unknown>) => void;

export class SignalJsonRpc {
  #conn: Socket | undefined;
  #pending = new Map<JsonRpcId, {
    resolve: (r: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  #nextId = 1;
  #handlers = new Map<string, Set<NotificationHandler>>();
  #buffer = "";
  #decoder = new TextDecoder();
  #encoder = new TextEncoder();
  #logger: AgentContext["logger"] | undefined;

  constructor(logger?: AgentContext["logger"]) {
    this.#logger = logger;
  }

  async connect(address: string): Promise<void> {
    this.#buffer = "";
    if (address.includes(":")) {
      const [host, port] = address.split(":");
      this.#conn = createConnection({ host, port: Number(port) });
    } else {
      this.#conn = createConnection({ path: address });
    }
    await new Promise<void>((resolve, reject) => {
      this.#conn!.once("connect", resolve);
      this.#conn!.once("error", reject);
    });
    this.#startReadLoop();
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `${this.#nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`JSON-RPC request timeout: ${method}`));
      }, 30_000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async notify(method: string, params: Record<string, unknown>): Promise<void> {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  on(method: string, handler: NotificationHandler): void {
    let handlers = this.#handlers.get(method);
    if (!handlers) { handlers = new Set(); this.#handlers.set(method, handlers); }
    handlers.add(handler);
  }

  close(): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
    }
    this.#pending.clear();
    this.#conn?.destroy();
    this.#conn = undefined;
  }

  #send(message: JsonRpcMessage): void {
    this.#conn?.write(this.#encoder.encode(JSON.stringify(message) + "\n"));
  }

  #startReadLoop(): void {
    this.#readLoop().catch(() => { this.close(); });
  }

  async #readLoop(): Promise<void> {
    for await (const chunk of this.#conn!) {
      this.#buffer += this.#decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = this.#buffer.indexOf("\n")) !== -1) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        if (line.trim()) {
          try {
            this.#handleMessage(JSON.parse(line) as JsonRpcMessage);
          } catch (error) {
            this.#logger?.warn("Failed to parse JSON-RPC message", error);
          }
        }
      }
    }
    this.close();
  }

  #handleMessage(message: JsonRpcMessage): void {
    if ("id" in message) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      const response = message as JsonRpcResponse;
      if (response.error) {
        pending.reject(new Error(`JSON-RPC error (${response.error.code}): ${response.error.message}`));
      } else {
        pending.resolve(response.result);
      }
      return;
    }
    const notification = message as JsonRpcNotification;
    const handlers = this.#handlers.get(notification.method);
    if (handlers) {
      for (const handler of handlers) handler(notification.params);
    }
  }
}
