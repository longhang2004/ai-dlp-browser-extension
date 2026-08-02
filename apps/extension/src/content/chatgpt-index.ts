import type { RuntimeResponse } from "@ai-dlp/shared-types";

import { CHATGPT_ADAPTER_DESCRIPTOR } from "../adapters/adapter-catalog.js";
import { createChatGptDocumentAdapterRegistry } from "../adapters/chatgpt/registry.js";
import {
  adaptInstalledPort,
  bootstrapContent,
  type ContentBootstrap,
} from "./bootstrap.js";

const installedChrome = typeof chrome === "undefined" ? undefined : chrome;

export const installedContent: ContentBootstrap | undefined =
  installedChrome === undefined || typeof document === "undefined"
    ? undefined
    : bootstrapContent({
        document,
        descriptor: CHATGPT_ADAPTER_DESCRIPTOR,
        createRegistry: createChatGptDocumentAdapterRegistry,
        runtime: {
          connect: ({ name }) =>
            adaptInstalledPort(installedChrome.runtime.connect({ name })),
          sendMessage: (message) =>
            installedChrome.runtime.sendMessage<unknown, RuntimeResponse>(
              message,
            ),
        },
      });
