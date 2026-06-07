import { assertEquals } from "@std/assert";
import { Message } from "discord.js";
import {
  buildMessageContentWithReplyContext,
  buildMessageImageUrls,
  buildMessageImageUrlsWithReplyContext,
} from "./messageContent.ts";

function fakeMessage(options: {
  attachments?: Array<{
    contentType?: string;
    name?: string;
    size?: number;
    url: string;
  }>;
  authorTag: string;
  bot?: boolean;
  content: string;
  reference?: Message;
}): Message {
  return {
    attachments: new Map(
      (options.attachments ?? []).map((attachment, index) => [
        String(index),
        attachment,
      ]),
    ),
    author: {
      bot: options.bot ?? false,
      tag: options.authorTag,
    },
    content: options.content,
    fetchReference: () => Promise.resolve(options.reference),
    reference: options.reference ? { messageId: "referenced" } : undefined,
  } as unknown as Message;
}

Deno.test("adds author-tagged Discord reply context to message content", async () => {
  const original = fakeMessage({
    authorTag: "friend#0001",
    content: "original thought",
  });
  const reply = fakeMessage({
    authorTag: "me#0002",
    content: "<@123> my reply",
    reference: original,
  });

  assertEquals(
    await buildMessageContentWithReplyContext(reply, "123"),
    [
      "Discord reply context:",
      "Original message from friend#0001:",
      "original thought",
      "",
      "Reply from me#0002:",
      "my reply",
    ].join("\n"),
  );
});

Deno.test("extracts current and referenced image urls for vision", async () => {
  const original = fakeMessage({
    attachments: [{
      contentType: "image/png",
      url: "https://cdn.example/original.png",
    }],
    authorTag: "friend#0001",
    content: "original image",
  });
  const reply = fakeMessage({
    attachments: [
      {
        contentType: "image/jpeg",
        url: "https://cdn.example/reply.jpg",
      },
      {
        contentType: "image/gif",
        url: "https://cdn.example/reaction.gif",
      },
    ],
    authorTag: "me#0002",
    content: "compare these",
    reference: original,
  });

  assertEquals(buildMessageImageUrls(reply), [
    "https://cdn.example/reply.jpg",
  ]);
  assertEquals(await buildMessageImageUrlsWithReplyContext(reply), [
    "https://cdn.example/original.png",
    "https://cdn.example/reply.jpg",
  ]);
});
