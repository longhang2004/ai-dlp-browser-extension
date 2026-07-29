import {
  createDefaultProtectionSettings,
  createFindingId,
  SENSITIVE_DATA_PLACEHOLDERS,
  type AuditEvent,
  type ProtectionDialogIntent,
  type SensitiveDataFinding,
} from "@ai-dlp/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatGptAdapter } from "../adapters/chatgpt/chatgpt-adapter.js";
import {
  AMBIGUOUS_SHARED_SEND_COMPOSER_FIXTURE,
  MULTI_COMPOSER_FIXTURE,
  NATIVE_TEXTAREA_COMPOSER_FIXTURE,
} from "../adapters/chatgpt/fixtures.js";
import { createProtectionDialogController } from "../ui/protection-dialog/dialog-controller.js";
import { createSubmissionController } from "./submission-controller.js";

function renderComposer(prompt: string): void {
  const parsed = new DOMParser().parseFromString(
    NATIVE_TEXTAREA_COMPOSER_FIXTURE,
    "text/html",
  );
  document.body.replaceChildren(...parsed.body.childNodes);
  const composer = document.querySelector("textarea");
  if (!(composer instanceof HTMLTextAreaElement)) {
    throw new Error("Expected textarea composer.");
  }
  composer.value = prompt;
}

function findingFor(prompt: string): SensitiveDataFinding {
  return {
    id: createFindingId("email", 0, prompt.length),
    detectorId: "email",
    category: "email",
    start: 0,
    end: prompt.length,
    confidence: "high",
    matchedText: prompt,
    redactedText: SENSITIVE_DATA_PLACEHOLDERS.email,
  };
}

function composer(): HTMLTextAreaElement {
  const value = document.querySelector("textarea");
  if (!(value instanceof HTMLTextAreaElement)) {
    throw new Error("Expected textarea composer.");
  }
  return value;
}

function sendControl(): HTMLButtonElement {
  const value = document.querySelector('button[type="submit"]');
  if (!(value instanceof HTMLButtonElement)) {
    throw new Error("Expected send control.");
  }
  return value;
}

function createHarness(prompt: string, action: "warn" | "redact" = "warn") {
  renderComposer(prompt);
  const adapter = new ChatGptAdapter({
    document,
    getCurrentUrl: () => new URL("https://chatgpt.com/"),
  });
  const events: AuditEvent[] = [];
  let settle!: (intent: ProtectionDialogIntent) => void;
  const dialog = {
    show: vi.fn(
      () =>
        new Promise<ProtectionDialogIntent>((resolve) => (settle = resolve)),
    ),
    cancel: vi.fn(),
  };
  const finding = findingFor(prompt);
  const controller = createSubmissionController({
    adapter,
    settings: () => createDefaultProtectionSettings(),
    currentRevision: () => 1,
    dialog,
    audit: { append: async (event) => void events.push(event) },
    analyze: () => [finding],
    evaluate: () => ({
      action,
      matchedRuleIds: ["warn.email"],
      contributingCategories: ["email"],
      reasonCode: "policy_match",
      attachmentPresent: false,
    }),
    eventId: () => "00000000-0000-4000-8000-000000000001",
    wallClockNow: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  controller.register();
  sendControl().addEventListener("click", (event) => event.preventDefault());
  return {
    adapter,
    controller,
    dialog,
    events,
    settle: (intent: ProtectionDialogIntent) => settle(intent),
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("submission controller with the semantic ChatGPT adapter", () => {
  it("does not analyze, authorize, show findings, allow, or resume an ambiguous shared-Send attempt", async () => {
    const parsed = new DOMParser().parseFromString(
      AMBIGUOUS_SHARED_SEND_COMPOSER_FIXTURE,
      "text/html",
    );
    document.body.replaceChildren(...parsed.body.childNodes);
    const adapter = new ChatGptAdapter({
      document,
      getCurrentUrl: () => new URL("https://chatgpt.com/"),
    });
    const analyze = vi.fn(() => [findingFor("private prompt sentinel")]);
    const evaluate = vi.fn(() => ({
      action: "allow" as const,
      matchedRuleIds: ["allow.no-findings"],
      contributingCategories: [],
      reasonCode: "no_findings" as const,
      attachmentPresent: false,
    }));
    const events: AuditEvent[] = [];
    const dialog = {
      show: vi.fn(async () => "cancel" as const),
      cancel: vi.fn(),
    };
    const controller = createSubmissionController({
      adapter,
      settings: () => createDefaultProtectionSettings(),
      currentRevision: () => 1,
      dialog,
      audit: { append: async (event) => void events.push(event) },
      analyze,
      evaluate,
    });
    controller.register();
    const resumed = vi.fn();
    document.querySelector("#shared-send")?.addEventListener("click", resumed);

    try {
      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      document.querySelector("#shared-send")?.dispatchEvent(click);
      await controller.whenSettledForTesting();

      expect(click.defaultPrevented).toBe(true);
      expect(analyze).not.toHaveBeenCalled();
      expect(evaluate).not.toHaveBeenCalled();
      expect(resumed).not.toHaveBeenCalled();
      expect(dialog.show).toHaveBeenCalledWith({
        kind: "error",
        errorCode: "extension_context_invalidated",
      });
      expect(JSON.stringify(dialog.show.mock.calls)).not.toContain("findings");
      expect(controller.getDiagnosticsForTesting()).toMatchObject({
        hasActiveAttempt: false,
        hasPromptSnapshot: false,
        hasSensitiveFindings: false,
        hasAuthorization: false,
      });
      expect(JSON.stringify(events)).not.toContain("private prompt sentinel");
    } finally {
      controller.dispose();
      adapter.dispose();
    }
  });

  it("analyzes and resumes only the event-targeted second composer", async () => {
    const parsed = new DOMParser().parseFromString(
      MULTI_COMPOSER_FIXTURE,
      "text/html",
    );
    document.body.replaceChildren(...parsed.body.childNodes);
    const composerA = document.querySelector("#prompt-a");
    const composerB = document.querySelector("#prompt-b");
    const sendA = document.querySelector("#composer-a button");
    const sendB = document.querySelector("#composer-b button");
    if (
      !(composerA instanceof HTMLElement) ||
      !(composerB instanceof HTMLElement) ||
      !(sendA instanceof HTMLButtonElement) ||
      !(sendB instanceof HTMLButtonElement)
    ) {
      throw new Error("Missing multi-composer fixture.");
    }
    composerA.textContent = "person-a@example.com";
    composerB.textContent = "person-b@example.com";
    const adapter = new ChatGptAdapter({
      document,
      getCurrentUrl: () => new URL("https://chatgpt.com/"),
    });
    let settle!: (intent: ProtectionDialogIntent) => void;
    const dialog = {
      show: vi.fn(
        () =>
          new Promise<ProtectionDialogIntent>((resolve) => (settle = resolve)),
      ),
      cancel: vi.fn(),
    };
    const analyze = vi.fn((prompt: string) => [findingFor(prompt)]);
    const controller = createSubmissionController({
      adapter,
      settings: () => createDefaultProtectionSettings(),
      currentRevision: () => 1,
      dialog,
      audit: { append: vi.fn() },
      analyze,
      evaluate: () => ({
        action: "warn",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    });
    controller.register();
    const sendAClicks = vi.fn();
    const sendBClicks = vi.fn();
    sendA.addEventListener("click", sendAClicks);
    sendB.addEventListener("click", sendBClicks);

    sendB.click();
    await vi.waitFor(() => expect(dialog.show).toHaveBeenCalledOnce());

    expect(analyze).toHaveBeenCalledWith("person-b@example.com", {
      protectedKeywords: [],
    });
    settle("bypass");
    await controller.whenSettledForTesting();
    expect(sendAClicks).not.toHaveBeenCalled();
    expect(sendBClicks).toHaveBeenCalledOnce();

    controller.dispose();
    adapter.dispose();
  });

  it("cannot submit composer A after targeted composer B is replaced", async () => {
    const parsed = new DOMParser().parseFromString(
      MULTI_COMPOSER_FIXTURE,
      "text/html",
    );
    document.body.replaceChildren(...parsed.body.childNodes);
    const composerB = document.querySelector("#prompt-b");
    const sendA = document.querySelector("#composer-a button");
    const sendB = document.querySelector("#composer-b button");
    if (
      !(composerB instanceof HTMLElement) ||
      !(sendA instanceof HTMLButtonElement) ||
      !(sendB instanceof HTMLButtonElement)
    ) {
      throw new Error("Missing multi-composer fixture.");
    }
    composerB.textContent = "person-b@example.com";
    const adapter = new ChatGptAdapter({
      document,
      getCurrentUrl: () => new URL("https://chatgpt.com/"),
    });
    let settle!: (intent: ProtectionDialogIntent) => void;
    const dialog = {
      show: vi.fn(
        () =>
          new Promise<ProtectionDialogIntent>((resolve) => (settle = resolve)),
      ),
      cancel: vi.fn(),
    };
    const events: AuditEvent[] = [];
    const controller = createSubmissionController({
      adapter,
      settings: () => createDefaultProtectionSettings(),
      currentRevision: () => 1,
      dialog,
      audit: { append: (event) => void events.push(event) },
      analyze: (prompt) => [findingFor(prompt)],
      evaluate: () => ({
        action: "warn",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    });
    controller.register();
    const sendAClicks = vi.fn();
    const sendBClicks = vi.fn();
    sendA.addEventListener("click", sendAClicks);
    sendB.addEventListener("click", sendBClicks);
    sendB.click();
    await vi.waitFor(() => expect(dialog.show).toHaveBeenCalledOnce());

    const replacement = composerB.cloneNode(true);
    composerB.replaceWith(replacement);
    settle("bypass");
    await controller.whenSettledForTesting();

    expect(sendAClicks).not.toHaveBeenCalled();
    expect(sendBClicks).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ resolution: "cancelled" });
    controller.dispose();
    adapter.dispose();
  });

  it("invalidates approval when the owned region changes around the same composer", async () => {
    const parsed = new DOMParser().parseFromString(
      MULTI_COMPOSER_FIXTURE,
      "text/html",
    );
    document.body.replaceChildren(...parsed.body.childNodes);
    const regionB = document.querySelector("#composer-b");
    const composerB = document.querySelector("#prompt-b");
    const sendB = document.querySelector("#composer-b button");
    if (
      !(regionB instanceof HTMLElement) ||
      !(composerB instanceof HTMLElement) ||
      !(sendB instanceof HTMLButtonElement)
    ) {
      throw new Error("Missing multi-composer fixture.");
    }
    composerB.textContent = "person-b@example.com";
    const adapter = new ChatGptAdapter({
      document,
      getCurrentUrl: () => new URL("https://chatgpt.com/"),
    });
    let settle!: (intent: ProtectionDialogIntent) => void;
    const dialog = {
      show: vi.fn(
        () =>
          new Promise<ProtectionDialogIntent>((resolve) => (settle = resolve)),
      ),
      cancel: vi.fn(),
    };
    const events: AuditEvent[] = [];
    const controller = createSubmissionController({
      adapter,
      settings: () => createDefaultProtectionSettings(),
      currentRevision: () => 1,
      dialog,
      audit: { append: (event) => void events.push(event) },
      analyze: (prompt) => [findingFor(prompt)],
      evaluate: () => ({
        action: "warn",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
    });
    controller.register();
    const resumed = vi.fn();
    sendB.addEventListener("click", resumed);
    sendB.click();
    await vi.waitFor(() => expect(dialog.show).toHaveBeenCalledOnce());

    const replacementRegion = document.createElement("section");
    replacementRegion.dataset.testid = "composer-root";
    replacementRegion.append(composerB, sendB);
    regionB.replaceWith(replacementRegion);
    settle("bypass");
    await controller.whenSettledForTesting();

    expect(resumed).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ resolution: "cancelled" });
    controller.dispose();
    adapter.dispose();
  });

  it("stops click and Enter duplicates while one dialog is active, then resumes once", async () => {
    const prompt = "person@example.com";
    const harness = createHarness(prompt);
    const bubbledClicks = vi.fn();
    document.addEventListener("click", bubbledClicks);

    const originalClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    sendControl().dispatchEvent(originalClick);
    await vi.waitFor(() =>
      expect(harness.dialog.show).toHaveBeenCalledTimes(1),
    );
    expect(harness.dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn", canRedact: false }),
    );
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    composer().dispatchEvent(enter);
    expect(originalClick.defaultPrevented).toBe(true);
    expect(enter.defaultPrevented).toBe(true);

    harness.settle("bypass");
    await harness.controller.whenSettledForTesting();
    expect(harness.dialog.show).toHaveBeenCalledTimes(1);
    expect(bubbledClicks).toHaveBeenCalledTimes(1);
    expect(harness.events).toHaveLength(1);
    harness.controller.dispose();
    harness.adapter.dispose();
    document.removeEventListener("click", bubbledClicks);
  });

  it("uses a newly resolved send control and never clicks the disconnected one", async () => {
    const prompt = "person@example.com";
    const harness = createHarness(prompt);
    const original = sendControl();
    const originalClick = vi.fn();
    original.addEventListener("click", originalClick);
    original.click();
    await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());

    const replacement = original.cloneNode(true) as HTMLButtonElement;
    const replacementClick = vi.fn();
    replacement.addEventListener("click", (event) => {
      event.preventDefault();
      replacementClick();
    });
    original.replaceWith(replacement);
    harness.settle("bypass");
    await harness.controller.whenSettledForTesting();

    expect(originalClick).toHaveBeenCalledTimes(0);
    expect(replacementClick).toHaveBeenCalledTimes(1);
    harness.controller.dispose();
    harness.adapter.dispose();
  });

  it("invalidates an identically populated replacement composer", async () => {
    const prompt = "person@example.com";
    const harness = createHarness(prompt);
    sendControl().click();
    await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());

    const original = composer();
    const replacement = original.cloneNode(true) as HTMLTextAreaElement;
    replacement.value = prompt;
    original.replaceWith(replacement);
    harness.settle("bypass");
    await harness.controller.whenSettledForTesting();

    expect(harness.events[0]).toMatchObject({ resolution: "cancelled" });
    harness.controller.dispose();
    harness.adapter.dispose();
  });

  it("fails closed on automatic redact without mutating or resuming ChatGPT", async () => {
    const prompt = "person@example.com";
    const harness = createHarness(prompt, "redact");
    const resumed = vi.fn();
    sendControl().addEventListener("click", resumed);

    sendControl().click();
    await vi.waitFor(() =>
      expect(harness.dialog.show).toHaveBeenCalledWith({
        kind: "error",
        errorCode: "redaction_unavailable",
      }),
    );
    harness.settle("cancel");
    await harness.controller.whenSettledForTesting();

    expect(composer().value).toBe(prompt);
    expect(resumed).not.toHaveBeenCalled();
    expect(harness.events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: "redaction_unavailable",
    });
    harness.controller.dispose();
    harness.adapter.dispose();
  });

  it("keeps the content-free fallback interactive after a synchronous React render failure", async () => {
    const prompt = "person@example.com";
    renderComposer(prompt);
    const adapter = new ChatGptAdapter({
      document,
      getCurrentUrl: () => new URL("https://chatgpt.com/"),
    });
    const events: AuditEvent[] = [];
    const controllerRef: {
      current: ReturnType<typeof createSubmissionController> | null;
    } = { current: null };
    const dialog = createProtectionDialogController(document, {
      renderer: () => {
        throw new Error(prompt);
      },
      onRenderFailure: () => controllerRef.current?.reportDialogRenderFailure(),
    });
    const controller = createSubmissionController({
      adapter,
      settings: () => createDefaultProtectionSettings(),
      currentRevision: () => 1,
      dialog,
      audit: { append: async (event) => void events.push(event) },
      analyze: () => [findingFor(prompt)],
      evaluate: () => ({
        action: "warn",
        matchedRuleIds: ["warn.email"],
        contributingCategories: ["email"],
        reasonCode: "policy_match",
        attachmentPresent: false,
      }),
      eventId: () => "00000000-0000-4000-8000-000000000001",
      wallClockNow: () => new Date("2026-07-26T00:00:00.000Z"),
    });
    controllerRef.current = controller;
    controller.register();
    sendControl().addEventListener("click", (event) => event.preventDefault());

    sendControl().click();
    const host = await vi.waitFor(() => {
      const candidate = document.querySelector<HTMLElement>(
        "[data-ai-dlp-protection-dialog-host]",
      );
      expect(candidate?.shadowRoot?.textContent).toContain(
        "Protection dialog unavailable",
      );
      return candidate;
    });
    const close = [
      ...(host?.shadowRoot?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent === "Close");
    expect(close).toBeInstanceOf(HTMLButtonElement);
    (close as HTMLButtonElement).click();
    await controller.whenSettledForTesting();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: "ui_failure",
    });
    expect(JSON.stringify(events)).not.toContain(prompt);
    dialog.dispose();
    controller.dispose();
    adapter.dispose();
  });
});
