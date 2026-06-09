import type { AgentTool, ToolExecutionContext } from "./types.ts";

export class ToolRegistry {
  #tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.#tools.set(tool.name, tool);
  }

  list(): AgentTool[] {
    return [...this.#tools.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return await tool.execute(input, context);
  }
}
