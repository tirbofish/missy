import { expect, test } from "bun:test";
import {
  fallbackAgentOutput,
  formatAgentOutputXml,
  parseAgentOutputXml,
  tryParseAgentOutputXml,
} from "./xml.ts";

test("parseAgentOutputXml parses messages and tool calls", () => {
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

  expect(output).toEqual({
    message: "Hello & welcome.",
    memoryUpdates: [{ key: "location", value: "Sydney" }],
    respond: false,
    toolCalls: [{ name: "echo.repeat", input: { text: "hello" } }],
  });
});

test("formatAgentOutputXml formats the platform XML response", () => {
  expect(
    formatAgentOutputXml({
      message: "Use <xml> safely.",
      memoryUpdates: [],
      respond: true,
      toolCalls: [],
    }),
  ).toEqual(
    "<agent><respond>true</respond><message>Use &lt;xml&gt; safely.</message><memory_updates></memory_updates><tool_calls></tool_calls></agent>",
  );
});

test("tryParseAgentOutputXml extracts fenced XML", () => {
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

  expect(parsed.ok).toEqual(true);
  expect(parsed.output?.message).toEqual("fixed");
});

test("fallbackAgentOutput preserves plain text as a response", () => {
  expect(fallbackAgentOutput("hello there")).toEqual({
    message: "hello there",
    memoryUpdates: [],
    respond: true,
    toolCalls: [],
  });
});
