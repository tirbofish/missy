import { assertEquals } from "@std/assert";
import {
  agentToolActivityContent,
  extractResponseControls,
  localAttachmentFailureContent,
  localAttachmentUploadContent,
  resolveResponseControls,
  responseContentWithMedia,
} from "./discord.ts";

Deno.test("extracts image and gif response controls", () => {
  const controls = extractResponseControls([
    "here",
    "MISSY_IMAGE: https://cdn.example/image.png",
    "MISSY_GIF: https://cdn.example/anim.gif",
    "MISSY_REACT: ok",
  ].join("\n"));

  assertEquals(controls.content, "here");
  assertEquals(controls.mediaUrls, [
    "https://cdn.example/image.png",
    "https://cdn.example/anim.gif",
  ]);
  assertEquals(controls.reactions, ["ok"]);
  assertEquals(controls.gifSearchQueries, []);
  assertEquals(
    responseContentWithMedia(controls),
    "here\nhttps://cdn.example/image.png\nhttps://cdn.example/anim.gif",
  );
});

Deno.test("extracts gif search controls without adding query text", () => {
  const controls = extractResponseControls([
    "MISSY_GIF_SEARCH: awkward laugh reaction",
    "MISSY_MESSAGE_BREAK",
    "nah",
  ].join("\n"));

  assertEquals(controls.content, "MISSY_MESSAGE_BREAK\nnah");
  assertEquals(controls.gifSearchQueries, ["awkward laugh reaction"]);
  assertEquals(
    responseContentWithMedia(controls),
    [
      "MISSY_GIF_SEARCH: awkward laugh reaction",
      "MISSY_MESSAGE_BREAK",
      "nah",
    ].join("\n"),
  );
});

Deno.test("extracts local attachment controls without adding path text", () => {
  const controls = extractResponseControls([
    "here",
    "MISSY_ATTACH_LOCAL: C:\\Users\\me\\Pictures\\shot.png",
  ].join("\n"));

  assertEquals(controls.content, "here");
  assertEquals(controls.localFilePaths, [
    "C:\\Users\\me\\Pictures\\shot.png",
  ]);
  assertEquals(responseContentWithMedia(controls), "here");
});

Deno.test("builds local upload caption from attachment filenames", () => {
  assertEquals(
    localAttachmentUploadContent([
      "C:\\Users\\me\\Pictures\\Screenshots\\shot.png",
    ]),
    "uploading `shot.png`",
  );
  assertEquals(
    localAttachmentUploadContent([
      "C:\\Users\\me\\Pictures\\Screenshots\\one.png",
      "C:\\Users\\me\\Pictures\\Screenshots\\two.png",
    ]),
    "uploading `one.png` and 1 more",
  );
});

Deno.test("builds local upload failure message from attachment filenames", () => {
  assertEquals(
    localAttachmentFailureContent([
      "C:\\Users\\me\\Pictures\\Screenshots\\shot.png",
    ]),
    "couldn't upload `shot.png` - it was missing, too big, or the read approval didn't go through.",
  );
});

Deno.test("formats filesystem tool activity updates", () => {
  assertEquals(
    agentToolActivityContent({
      toolName: "missy_deno_repl",
      arguments: {
        code:
          "const files = await Array.fromAsync(Deno.readDir('C:/Users/Thribhu/Pictures')); console.log(files.length);",
      },
    }),
    "running a local Deno check: `const files = await Array.fromAsync(Deno.readDir('C:/Users/Thribhu/Pictures')); console.log(files.length);`",
  );
  assertEquals(
    agentToolActivityContent({
      toolName: "missy_filesystem_list",
      arguments: '{"path":"C:\\\\Users\\\\Thribhu\\\\Pictures"}',
    }),
    "checking the folder `C:\\Users\\Thribhu\\Pictures`",
  );
});

Deno.test("resolves gif search controls through GIPHY", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: URL | Request | string) => {
    const requestUrl = new URL(url.toString());
    assertEquals(requestUrl.hostname, "api.giphy.com");
    assertEquals(requestUrl.pathname, "/v1/gifs/search");
    assertEquals(requestUrl.searchParams.get("api_key"), "test-key");
    assertEquals(requestUrl.searchParams.get("q"), "awkward laugh reaction");
    assertEquals(requestUrl.searchParams.get("limit"), "10");

    return Promise.resolve(
      new Response(JSON.stringify({
        data: [{
          images: {
            downsized: {
              url: "https://media.giphy.com/media/example/giphy.gif",
            },
          },
        }],
      })),
    );
  }) as typeof fetch;

  try {
    const previousApiKey = Deno.env.get("GIPHY_API_KEY");
    Deno.env.set("GIPHY_API_KEY", "test-key");

    const controls = await resolveResponseControls(
      extractResponseControls("MISSY_GIF_SEARCH: awkward laugh reaction"),
    );

    assertEquals(
      responseContentWithMedia(controls),
      "https://media.giphy.com/media/example/giphy.gif",
    );

    if (previousApiKey === undefined) {
      Deno.env.delete("GIPHY_API_KEY");
    } else {
      Deno.env.set("GIPHY_API_KEY", previousApiKey);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("keeps media controls in place around message breaks", () => {
  const controls = extractResponseControls([
    "MISSY_GIF: https://media.example/one.gif",
    "MISSY_MESSAGE_BREAK",
    "MISSY_GIF: https://media.example/two.gif",
    "MISSY_MESSAGE_BREAK",
    "try it and find out",
  ].join("\n"));

  assertEquals(
    responseContentWithMedia(controls),
    [
      "https://media.example/one.gif",
      "MISSY_MESSAGE_BREAK",
      "https://media.example/two.gif",
      "MISSY_MESSAGE_BREAK",
      "try it and find out",
    ].join("\n"),
  );
});
