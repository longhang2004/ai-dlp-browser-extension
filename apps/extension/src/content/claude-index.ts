import type { RuntimeResponse } from "@ai-dlp/shared-types";

import { CLAUDE_ADAPTER_DESCRIPTOR } from "../adapters/adapter-catalog.js";
import { createClaudeDocumentAdapterRegistry } from "../adapters/claude/registry.js";
import {
  adaptInstalledPort,
  bootstrapContent,
  type ContentBootstrap,
} from "./bootstrap.js";

const installedChrome = typeof chrome === "undefined" ? undefined : chrome;

export const installedClaudeContent: ContentBootstrap | undefined =
  installedChrome === undefined || typeof document === "undefined"
    ? undefined
    : bootstrapContent({
        document,
        descriptor: CLAUDE_ADAPTER_DESCRIPTOR,
        createRegistry: createClaudeDocumentAdapterRegistry,
        runtime: {
          connect: ({ name }) =>
            adaptInstalledPort(installedChrome.runtime.connect({ name })),
          sendMessage: (message) =>
            installedChrome.runtime.sendMessage<unknown, RuntimeResponse>(
              message,
            ),
        },
      });
