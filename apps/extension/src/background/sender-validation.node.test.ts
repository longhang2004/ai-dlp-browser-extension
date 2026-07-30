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
const extensionPageCases = [
  {
    page: "popup",
    url: `chrome-extension://${runtimeId}/popup.html`,
    requestTypes: ["status.read"],
  },
  {
    page: "options",
    url: `chrome-extension://${runtimeId}/options.html`,
    requestTypes: ["settings.read", "settings.save"],
  },
  {
    page: "audit",
    url: `chrome-extension://${runtimeId}/audit.html`,
    requestTypes: ["audit.read", "audit.clear"],
  },
] as const;
const contentSender = {
  id: runtimeId,
  url: "https://chatgpt.com/c/abc",
  origin: "https://chatgpt.com",
  frameId: 0,
  documentId: "document-1",
};

describe("runtime sender validation", () => {
  describe.each(extensionPageCases)(
    "$page extension page",
    ({ url, requestTypes }) => {
      it("accepts its natural request paths with the exact extension origin", () => {
        for (const type of requestTypes) {
          expect(
            isAllowedRuntimeSender(
              { type },
              {
                id: runtimeId,
                url,
                origin: `chrome-extension://${runtimeId}`,
                frameId: 0,
              },
              runtimeId,
            ),
          ).toBe(true);
        }
      });

      it("accepts its natural request paths when optional sender.origin is absent under minimum Chrome 102", () => {
        for (const type of requestTypes) {
          expect(
            isAllowedRuntimeSender(
              { type },
              {
                id: runtimeId,
                url,
                frameId: 0,
              },
              runtimeId,
            ),
          ).toBe(true);
        }
      });
    },
  );

  it("rejects null and mismatched extension-page origin claims", () => {
    for (const origin of [
      null,
      "null",
      "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba",
      "https://chatgpt.com",
    ]) {
      expect(
        isAllowedRuntimeSender(
          { type: "settings.read" },
          { ...extensionSender, origin },
          runtimeId,
        ),
      ).toBe(false);
    }
  });

  it("rejects extension pages with the wrong runtime identity or an unknown path", () => {
    expect(
      isAllowedRuntimeSender(
        { type: "settings.read" },
        { ...extensionSender, id: "different" },
        runtimeId,
      ),
    ).toBe(false);
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
  });

  it("rejects extension-page URLs with credentials or a port", () => {
    for (const url of [
      `chrome-extension://user:pass@${runtimeId}/popup.html`,
      `chrome-extension://${runtimeId}:8443/popup.html`,
    ]) {
      expect(
        isAllowedRuntimeSender(
          { type: "status.read" },
          { ...extensionSender, url },
          runtimeId,
        ),
      ).toBe(false);
    }
  });

  it("rejects invalid optional frame and document claims from extension pages", () => {
    expect(
      isAllowedRuntimeSender(
        { type: "settings.read" },
        { ...extensionSender, frameId: 1 },
        runtimeId,
      ),
    ).toBe(false);
    expect(
      isAllowedRuntimeSender(
        { type: "settings.read" },
        { ...extensionSender, documentId: "" },
        runtimeId,
      ),
    ).toBe(false);
  });

  it("does not authorize a content-script sender for extension-page requests", () => {
    for (const type of [
      "settings.read",
      "settings.save",
      "audit.read",
      "audit.clear",
      "status.read",
    ] as const) {
      expect(isAllowedRuntimeSender({ type }, contentSender, runtimeId)).toBe(
        false,
      );
    }
  });

  it("does not authorize an extension page to append audit events", () => {
    expect(
      isAllowedRuntimeSender(
        { type: "audit.append" },
        extensionSender,
        runtimeId,
      ),
    ).toBe(false);
  });

  it("allows audit append only from an exact top-frame ChatGPT content script", () => {
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

  it("requires the content-script runtime id, URL, and top frame", () => {
    for (const sender of [
      {
        url: contentSender.url,
        origin: contentSender.origin,
        frameId: contentSender.frameId,
        documentId: contentSender.documentId,
      },
      { ...contentSender, id: "different" },
      {
        id: contentSender.id,
        origin: contentSender.origin,
        frameId: contentSender.frameId,
        documentId: contentSender.documentId,
      },
      { ...contentSender, url: "not a url" },
      {
        id: contentSender.id,
        url: contentSender.url,
        origin: contentSender.origin,
        documentId: contentSender.documentId,
      },
      { ...contentSender, frameId: 1 },
    ]) {
      expect(resolveSettingsPortSenderDescriptor(sender, runtimeId)).toBeNull();
      expect(isValidSettingsPortSender(sender, runtimeId)).toBe(false);
    }
  });

  it("accepts optional content documentId and sender.origin when the URL derives the exact catalog origin", () => {
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

  it("rejects malformed optional content claims and origins outside the exact catalog", () => {
    const invalidSenders = [
      undefined,
      { ...contentSender, documentId: "" },
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
