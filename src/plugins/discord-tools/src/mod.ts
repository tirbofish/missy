/** Discord tools plugin — composes tool registrations from split files. */

import type { PluginModule } from "../../../core/types.ts";
import type { DiscordService } from "../../../platforms/discord/src/service.ts";
import { registerReactionTools } from "./tools/reactions.ts";
import { registerMessageTools } from "./tools/messages.ts";
import { registerSearchTools } from "./tools/search.ts";
import { registerUserTools } from "./tools/users.ts";
import { registerAdminTools } from "./tools/admin.ts";

const module: PluginModule = {
  metadata: {
    name: "discord-tools",
    description: "Registers AI-callable tools for Discord actions (react, DM, search, nicknames, etc).",
    version: "0.1.0",
  },
  setup(context) {
    const discord = context.platformServices.get<DiscordService>("discord");
    if (!discord) {
      context.logger.warn(
        "discord-tools: Discord platform service not available, skipping tool registration",
      );
      return;
    }

    registerReactionTools(context, discord);
    registerMessageTools(context, discord);
    registerSearchTools(context, discord);
    registerUserTools(context, discord);
    registerAdminTools(context, discord);
  },
};

export default module;
