/**
 * Session attachment conversion helpers.
 */

import type { MessageAttachment } from "../../../core/types.ts";
import type { SessionMessage } from "./types.ts";

/** Convert Session message attachments to the core MessageAttachment shape. */
export function sessionAttachments(msg: SessionMessage): MessageAttachment[] {
  return (msg.attachments ?? []).map((a) => ({
    id: a.id,
    contentType: a.metadata?.contentType,
    name: a.name,
    size: a.size,
    width: a.metadata?.width,
    height: a.metadata?.height,
    caption: a.caption,
  }));
}
