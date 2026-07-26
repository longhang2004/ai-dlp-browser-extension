import { describe, expect, it } from "vitest";

import {
  isAllowedRuntimeSender,
  isValidSettingsPortSender,
} from "./sender-validation.js";

const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
const extensionSender = {
  id: runtimeId,
  url: `chrome-extension://${runtimeId}/popup.html`,
  origin: `chrome-extension://${runtimeId}`,
  frameId: 0,
};
const contentSender = {
  id: runtimeId,
  url: "https://chatgpt.com/c/abc",
  origin: "https://chatgpt.com",
  frameId: 0,
  documentId: "document-1",
};

describe("runtime sender validation", () => {
  it("allows only known extension pages for extension-page requests", () => {
    for (const type of [
      "settings.read",
      "settings.save",
      "audit.read",
      "audit.clear",
      "status.read",
    ] as const) {
      expect(isAllowedRuntimeSender({ type }, extensionSender, runtimeId)).toBe(
        true,
      );
    }

    expect(
      isAllowedRuntimeSender(
        { type: "settings.read" },
        {
          ...extensionSender,
          url: `chrome-extension://${runtimeId}/unknown.html`,
        },
        runtimeId,
      ),
    ).toBe(false);
    expect(
      isAllowedRuntimeSender(
        { type: "settings.read" },
        {
          id: extensionSender.id,
          url: extensionSender.url,
          frameId: extensionSender.frameId,
        },
        runtimeId,
      ),
    ).toBe(false);
    for (const origin of [null, "null", "https://chatgpt.com"]) {
      expect(
        isAllowedRuntimeSender(
          { type: "settings.read" },
          { ...extensionSender, origin },
          runtimeId,
        ),
      ).toBe(false);
    }
    expect(
      isAllowedRuntimeSender(
        { type: "settings.read" },
        { ...extensionSender, id: "different" },
        runtimeId,
      ),
    ).toBe(false);
  });

  it("allows audit append only from a top-frame ChatGPT content script", () => {
    expect(
      isAllowedRuntimeSender(
        { type: "audit.append" },
        contentSender,
        runtimeId,
      ),
    ).toBe(true);
    expect(
      isAllowedRuntimeSender(
        { type: "audit.append" },
        extensionSender,
        runtimeId,
      ),
    ).toBe(false);
    expect(
      isAllowedRuntimeSender(
        { type: "audit.append" },
        { ...contentSender, frameId: 1 },
        runtimeId,
      ),
    ).toBe(false);
    expect(
      isAllowedRuntimeSender(
        { type: "audit.append" },
        { ...contentSender, url: "https://evil.example/" },
        runtimeId,
      ),
    ).toBe(false);
  });

  it("accepts optional documentId for Chrome 102 but requires the exact origin", () => {
    const chrome102Sender = {
      id: contentSender.id,
      url: contentSender.url,
      frameId: contentSender.frameId,
      origin: contentSender.origin,
    };
    expect(isValidSettingsPortSender(chrome102Sender, runtimeId)).toBe(true);
    expect(
      isValidSettingsPortSender(
        { ...contentSender, documentId: "" },
        runtimeId,
      ),
    ).toBe(false);
    expect(
      isValidSettingsPortSender(
        { ...contentSender, origin: "https://example.test" },
        runtimeId,
      ),
    ).toBe(false);
    expect(
      isValidSettingsPortSender(
        {
          id: contentSender.id,
          url: contentSender.url,
          frameId: contentSender.frameId,
          documentId: contentSender.documentId,
        },
        runtimeId,
      ),
    ).toBe(false);
    for (const origin of [null, "null", "https://evil.example"]) {
      expect(
        isValidSettingsPortSender({ ...contentSender, origin }, runtimeId),
      ).toBe(false);
    }
  });
});
