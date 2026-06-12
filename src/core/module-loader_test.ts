import { expect, test } from "bun:test";
import { loadConfig } from "./config.ts";
import { MemoryStore } from "./memory-store.ts";
import { discoverPlugins, discoverProvider } from "./module-loader.ts";
import { FileKeystore } from "./keystore.ts";
import { createLogger } from "./logger.ts";
import { PlatformServiceRegistry } from "./platform-service-registry.ts";
import { ProviderRegistry } from "./provider-registry.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type { AgentContext } from "./types.ts";

test("discoverPlugins loads plugin folders dynamically", async () => {
  const tools = new ToolRegistry();
  const keystore = new FileKeystore("data/test-keystore.json", false);
  await keystore.load();
  const plugins = await discoverPlugins(
    "src/plugins",
    createLogger("test"),
    keystore,
    ["echo", "time", "weather", "web-search"],
  );
  const providers = new ProviderRegistry("openai");
  const memory = new MemoryStore("data/test-memory.json", false);

  const context = {
    ai: {
      generate: () =>
        Promise.resolve(
          "<agent><message></message><tool_calls></tool_calls></agent>",
        ),
    },
    config: loadConfig({
      OPENAI_API_KEY: "test",
      DISCORD_TOKEN: "test",
    }),
    handleMessage: () => Promise.resolve(),
    keystore,
    logger: createLogger("test"),
    memory,
    personality: { xml: "<personality></personality>" },
    platformServices: new PlatformServiceRegistry(),
    plugins: [],
    providers,
    tools,
  } as AgentContext;

  for (const plugin of plugins) {
    await plugin.setup(context);
  }

  expect(tools.list().map((tool) => tool.name)).toEqual([
    "echo.repeat",
    "time.now",
    "weather.current",
    "web.search",
  ]);
});

test("discoverProvider loads the configured provider folder", async () => {
  const provider = await discoverProvider(
    "src/providers",
    "openai",
    createLogger("test"),
  );

  expect(provider.metadata.name).toEqual("openai");
});
