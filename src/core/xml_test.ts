import { assertEquals } from "@std/assert";
import {
  fallbackAgentOutput,
  formatAgentOutputXml,
  parseAgentOutputXml,
  tryParseAgentOutputXml,
} from "./xml.ts";

Deno.test("parseAgentOutputXml parses messages and tool calls", () => {
  const output = parseAgentOutputXml(`
    <agent>
      <respond>false</respond>
      <message>Hello &amp; welcome.</message>
      <memory_updates>
        <memory key="location">Sydney</memory>
      </memory_updates>
      <tool_calls>
        <tool_call name="echo.repeat">
          <input>{"text":"hello"}</input>
        </tool_call>
      </tool_calls>
    </agent>
  `);

  assertEquals(output, {
    message: "Hello & welcome.",
    memoryUpdates: [{ key: "location", value: "Sydney" }],
    respond: false,
    toolCalls: [{ name: "echo.repeat", input: { text: "hello" } }],
  });
});

Deno.test("formatAgentOutputXml formats the platform XML response", () => {
  assertEquals(
    formatAgentOutputXml({
      message: "Use <xml> safely.",
      memoryUpdates: [],
      respond: true,
      toolCalls: [],
    }),
    "<agent><respond>true</respond><message>Use &lt;xml&gt; safely.</message><memory_updates></memory_updates><tool_calls></tool_calls></agent>",
  );
});

Deno.test("tryParseAgentOutputXml extracts fenced XML", () => {
  const parsed = tryParseAgentOutputXml(`
    \`\`\`xml
    <agent>
      <respond>true</respond>
      <message>fixed</message>
      <memory_updates></memory_updates>
      <tool_calls></tool_calls>
    </agent>
    \`\`\`
  `);

  assertEquals(parsed.ok, true);
  assertEquals(parsed.output?.message, "fixed");
});

Deno.test("fallbackAgentOutput preserves plain text as a response", () => {
  assertEquals(fallbackAgentOutput("hello there"), {
    message: "hello there",
    memoryUpdates: [],
    respond: true,
    toolCalls: [],
  });
});
