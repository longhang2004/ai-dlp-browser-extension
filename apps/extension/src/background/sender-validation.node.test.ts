import { describe, expect, it } from "vitest";

import {
  isAllowedRuntimeSender,
  resolveSettingsPortSenderDescriptor,
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

  it("accepts optional documentId and optional sender.origin when the URL derives the exact catalog origin", () => {
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
    ).toBe(true);
    expect(
      resolveSettingsPortSenderDescriptor(
        {
          id: contentSender.id,
          url: contentSender.url,
          frameId: contentSender.frameId,
          documentId: contentSender.documentId,
        },
        runtimeId,
      ),
    ).toMatchObject({
      adapterId: "chatgpt",
      surfaceId: "chatgpt_web",
      origins: ["https://chatgpt.com"],
    });
    for (const origin of [null, "null", "https://evil.example"]) {
      expect(
        isValidSettingsPortSender({ ...contentSender, origin }, runtimeId),
      ).toBe(false);
    }
  });

  it("fails closed for malformed required fields, page origin claims, and alternate ports", () => {
    const invalidSenders = [
      undefined,
      {
        url: contentSender.url,
        origin: contentSender.origin,
        frameId: contentSender.frameId,
        documentId: contentSender.documentId,
      },
      { ...contentSender, id: "different" },
      {
        id: contentSender.id,
        url: contentSender.url,
        origin: contentSender.origin,
        documentId: contentSender.documentId,
      },
      { ...contentSender, frameId: 1 },
      {
        id: contentSender.id,
        origin: contentSender.origin,
        frameId: contentSender.frameId,
        documentId: contentSender.documentId,
      },
      { ...contentSender, url: "not a url" },
      {
        ...contentSender,
        url: "https://chatgpt.com:8443/",
        origin: "https://chatgpt.com:8443",
      },
      {
        ...contentSender,
        url: "https://evil.example/",
        origin: "https://chatgpt.com",
      },
      {
        ...contentSender,
        url: "https://evil.example/",
        origin: "https://evil.example",
      },
    ];

    for (const sender of invalidSenders) {
      expect(resolveSettingsPortSenderDescriptor(sender, runtimeId)).toBeNull();
      expect(isValidSettingsPortSender(sender, runtimeId)).toBe(false);
    }
  });

  it("rejects alternate-port audit senders before any audit path can accept them", () => {
    expect(
      isAllowedRuntimeSender(
        { type: "audit.append" },
        {
          ...contentSender,
          url: "https://chatgpt.com:8443/",
          origin: "https://chatgpt.com:8443",
        },
        runtimeId,
      ),
    ).toBe(false);
  });
});
