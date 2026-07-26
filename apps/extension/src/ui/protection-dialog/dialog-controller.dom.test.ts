import {
  createDisplayFinding,
  createProtectionDialogModel,
} from "@ai-dlp/shared-types";
import type {
  ProtectionDialogModel,
  ProtectionDialogRequest,
} from "@ai-dlp/shared-types";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProtectionDialogController } from "./dialog-controller.js";

function createWarning(): ProtectionDialogModel {
  return createProtectionDialogModel({
    kind: "warn",
    findings: [createDisplayFinding("email", "high")],
    reasonCode: "policy_match",
    canRedact: true,
  });
}

function getShadowRoot(): ShadowRoot {
  const host = document.querySelector<HTMLElement>(
    "[data-ai-dlp-protection-dialog-host]",
  );
  expect(host).not.toBeNull();
  expect(host?.shadowRoot).not.toBeNull();
  return host?.shadowRoot as ShadowRoot;
}

function getButton(root: ShadowRoot, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === name,
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
}

async function allowMutationObserverDelivery(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

describe("protection dialog controller", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("creates one inspectable open shadow root and mounts only once", () => {
    const attachShadow = vi.spyOn(HTMLElement.prototype, "attachShadow");
    const controller = createProtectionDialogController(document);

    act(() => {
      void controller.show(createWarning());
    });
    const firstRoot = getShadowRoot();
    act(() => {
      void controller.show({ kind: "error", errorCode: "ui_failure" });
    });

    expect(getShadowRoot()).toBe(firstRoot);
    expect(attachShadow).toHaveBeenCalledTimes(1);
    expect(attachShadow).toHaveBeenCalledWith({ mode: "open" });

    act(() => controller.dispose());
  });

  it("observes only direct dialog ownership boundaries", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const controller = createProtectionDialogController(document);

    act(() => {
      void controller.show(createWarning());
    });

    expect(observe).toHaveBeenCalledTimes(3);
    for (const [, options] of observe.mock.calls) {
      if (options === undefined) {
        throw new Error("Expected observer options.");
      }
      expect(options.childList).toBe(true);
      expect(options.subtree).not.toBe(true);
    }
    act(() => controller.dispose());
  });

  it("focuses the safe action, contains Tab navigation, handles Escape, and restores focus", async () => {
    const before = document.createElement("button");
    before.textContent = "Before";
    document.body.append(before);
    before.focus();
    const controller = createProtectionDialogController(document);

    let result!: Promise<string>;
    act(() => {
      result = controller.show(createWarning());
    });
    const shadow = getShadowRoot();
    const cancel = getButton(shadow, "Cancel");
    const send = getButton(shadow, "Send anyway");
    expect(shadow.activeElement).toBe(cancel);

    send.focus();
    send.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(shadow.activeElement).toBe(cancel);

    cancel.focus();
    cancel.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(shadow.activeElement).toBe(send);

    act(() => {
      send.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(result).resolves.toBe("cancel");
    expect(document.activeElement).toBe(before);

    act(() => controller.dispose());
  });

  it("invalidates actions from replaced generations", async () => {
    const controller = createProtectionDialogController(document);
    let first!: Promise<string>;
    let second!: Promise<string>;
    act(() => {
      first = controller.show(createWarning());
    });
    const staleSend = getButton(getShadowRoot(), "Send anyway");

    act(() => {
      second = controller.show(createWarning());
    });
    await expect(first).resolves.toBe("cancel");

    act(() => staleSend.click());
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    act(() => getButton(getShadowRoot(), "Redact and continue").click());
    await expect(second).resolves.toBe("redact");
    act(() => controller.dispose());
  });

  it("reuses its mount after cancellation and rejects use after disposal", async () => {
    const controller = createProtectionDialogController(document);
    let first!: Promise<string>;
    act(() => {
      first = controller.show(createWarning());
    });
    const shadow = getShadowRoot();

    act(() => controller.cancel());
    await expect(first).resolves.toBe("cancel");
    expect(shadow.querySelector("[role='dialog']")).toBeNull();

    let second!: Promise<string>;
    act(() => {
      second = controller.show({ kind: "error", errorCode: "ui_failure" });
    });
    expect(getShadowRoot()).toBe(shadow);
    act(() => getButton(shadow, "Close").click());
    await expect(second).resolves.toBe("cancel");

    act(() => controller.dispose());
    expect(() => controller.show(createWarning())).toThrow(
      "Protection dialog controller is disposed.",
    );
  });

  it("rebuilds when the host is removed between dialogs", async () => {
    const controller = createProtectionDialogController(document);
    let first!: Promise<string>;
    act(() => {
      first = controller.show(createWarning());
    });
    const oldHost = document.querySelector<HTMLElement>(
      "[data-ai-dlp-protection-dialog-host]",
    );
    expect(oldHost).not.toBeNull();
    act(() => controller.cancel());
    await expect(first).resolves.toBe("cancel");
    oldHost?.remove();

    let second!: Promise<string>;
    act(() => {
      second = controller.show(createWarning());
    });
    const newHost = document.querySelector<HTMLElement>(
      "[data-ai-dlp-protection-dialog-host]",
    );
    expect(newHost).not.toBeNull();
    expect(newHost).not.toBe(oldHost);
    expect(newHost?.isConnected).toBe(true);
    const send = getButton(getShadowRoot(), "Send anyway");

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await allowMutationObserverDelivery();
    expect(secondSettled).toBe(false);

    act(() => send.click());
    await expect(second).resolves.toBe("bypass");
    act(() => controller.dispose());
  });

  it("cancels safely when the host is removed during an active dialog", async () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    const controller = createProtectionDialogController(document);
    let first!: Promise<string>;
    act(() => {
      first = controller.show(createWarning());
    });
    const staleSend = getButton(getShadowRoot(), "Send anyway");
    await act(async () => {
      document
        .querySelector<HTMLElement>("[data-ai-dlp-protection-dialog-host]")
        ?.remove();
      await allowMutationObserverDelivery();
    });
    await expect(first).resolves.toBe("cancel");
    expect(document.activeElement).toBe(before);

    let second!: Promise<string>;
    act(() => {
      second = controller.show(createWarning());
    });
    act(() => staleSend.click());
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    act(() => controller.cancel());
    await expect(second).resolves.toBe("cancel");
    act(() => controller.dispose());
  });

  it("rebuilds when the shadow mount is removed between dialogs", async () => {
    const controller = createProtectionDialogController(document);
    let first!: Promise<string>;
    act(() => {
      first = controller.show(createWarning());
    });
    const oldShadow = getShadowRoot();
    const oldMount = oldShadow.querySelector<HTMLElement>(
      "[data-ai-dlp-protection-dialog-mount]",
    );
    expect(oldMount).not.toBeNull();
    act(() => controller.cancel());
    await expect(first).resolves.toBe("cancel");
    oldMount?.remove();

    // Let the old observer reconcile before the next generation starts.
    await allowMutationObserverDelivery();

    let second!: Promise<string>;
    act(() => {
      second = controller.show(createWarning());
    });
    const newShadow = getShadowRoot();
    const newMount = newShadow.querySelector<HTMLElement>(
      "[data-ai-dlp-protection-dialog-mount]",
    );
    expect(newShadow).not.toBe(oldShadow);
    expect(newMount).not.toBeNull();
    expect(newMount).not.toBe(oldMount);
    expect(newMount?.isConnected).toBe(true);
    const redact = getButton(newShadow, "Redact and continue");

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    act(() => redact.click());
    await expect(second).resolves.toBe("redact");
    act(() => controller.dispose());
  });

  it("cancels safely when the shadow mount is removed during an active dialog", async () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    const controller = createProtectionDialogController(document);
    let first!: Promise<string>;
    act(() => {
      first = controller.show(createWarning());
    });
    const oldShadow = getShadowRoot();
    const staleSend = getButton(oldShadow, "Send anyway");
    await act(async () => {
      oldShadow
        .querySelector<HTMLElement>("[data-ai-dlp-protection-dialog-mount]")
        ?.remove();
      await allowMutationObserverDelivery();
    });
    await expect(first).resolves.toBe("cancel");
    expect(document.activeElement).toBe(before);

    let second!: Promise<string>;
    act(() => {
      second = controller.show(createWarning());
    });
    expect(getShadowRoot()).not.toBe(oldShadow);
    act(() => staleSend.click());
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    act(() => controller.cancel());
    await expect(second).resolves.toBe("cancel");
    act(() => controller.dispose());
  });

  it("strictly rejects unsanitized runtime input without exposing its contents", () => {
    const controller = createProtectionDialogController(document);
    const malicious = {
      kind: "warn",
      findings: [
        {
          category: "email",
          confidence: "high",
          placeholder: "[EMAIL]",
          matchedText: "DO-NOT-RENDER",
        },
      ],
      maskedPreview: "… [EMAIL] …",
      reasonCode: "policy_match",
      canRedact: true,
    } as unknown as ProtectionDialogRequest;

    expect(() => controller.show(malicious)).toThrow(
      "Invalid protection dialog request.",
    );
    expect(document.body.textContent).not.toContain("DO-NOT-RENDER");
    act(() => controller.dispose());
  });

  it("shows a fixed, content-free fallback when React rendering fails", async () => {
    const onRenderFailure = vi.fn();
    const controller = createProtectionDialogController(document, {
      renderer: () => {
        throw new Error("DO-NOT-RENDER");
      },
      onRenderFailure,
    });
    let result!: Promise<string>;

    act(() => {
      result = controller.show(createWarning());
    });
    const shadow = getShadowRoot();
    expect(shadow.textContent).toContain("Protection dialog unavailable");
    expect(shadow.textContent).toContain(
      "Close this message, then reload the page and try again.",
    );
    expect(shadow.textContent).not.toContain("DO-NOT-RENDER");
    expect([...shadow.querySelectorAll("button")]).toHaveLength(1);
    expect(onRenderFailure.mock.calls).toEqual([[]]);

    act(() => getButton(shadow, "Close").click());
    await expect(result).resolves.toBe("cancel");
    act(() => controller.dispose());
  });

  it("keeps fallback cancellation usable when the render-failure reporter throws", async () => {
    const controller = createProtectionDialogController(document, {
      renderer: () => {
        throw new Error("render detail must remain private");
      },
      onRenderFailure: () => {
        throw new Error("reporter unavailable");
      },
    });
    let result!: Promise<string>;

    act(() => {
      result = controller.show(createWarning());
    });
    const shadow = getShadowRoot();
    expect(shadow.textContent).toContain("Protection dialog unavailable");
    expect(shadow.textContent).not.toContain(
      "render detail must remain private",
    );
    expect(shadow.textContent).not.toContain("reporter unavailable");

    act(() => getButton(shadow, "Close").click());
    await expect(result).resolves.toBe("cancel");
    act(() => controller.dispose());
  });

  it("settles cancellation if render failure leaves no usable mount", async () => {
    const onRenderFailure = vi.fn();
    const controller = createProtectionDialogController(document, {
      renderer: () => {
        getShadowRoot()
          .querySelector<HTMLElement>("[data-ai-dlp-protection-dialog-mount]")
          ?.remove();
        throw new Error("render failed after mount removal");
      },
      onRenderFailure,
    });
    let result!: Promise<string>;

    act(() => {
      result = controller.show(createWarning());
    });

    await expect(result).resolves.toBe("cancel");
    expect(onRenderFailure.mock.calls).toEqual([[]]);
    expect(
      document.querySelector("[data-ai-dlp-protection-dialog-host]"),
    ).toBeNull();
    act(() => controller.dispose());
  });

  it("unmounts before removing the host and disposes idempotently", () => {
    const events: string[] = [];
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const controller = createProtectionDialogController(document);
    act(() => {
      void controller.show(createWarning());
    });
    const host = document.querySelector<HTMLElement>(
      "[data-ai-dlp-protection-dialog-host]",
    );
    expect(host).not.toBeNull();
    const originalRemove = host?.remove.bind(host);
    vi.spyOn(host as HTMLElement, "remove").mockImplementation(() => {
      events.push(
        host?.shadowRoot?.querySelector("[role='dialog']") === null
          ? "unmounted"
          : "mounted",
      );
      events.push("remove");
      originalRemove?.();
    });

    act(() => {
      controller.dispose();
      controller.dispose();
    });

    expect(events).toEqual(["unmounted", "remove"]);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector("[data-ai-dlp-protection-dialog-host]"),
    ).toBeNull();
  });
});
