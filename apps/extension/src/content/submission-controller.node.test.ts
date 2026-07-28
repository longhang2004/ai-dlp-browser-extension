import {
  createFindingId,
  createDefaultProtectionSettings,
  SENSITIVE_DATA_PLACEHOLDERS,
  type AuditEvent,
  type PolicyAction,
  type PolicyDecision,
  type ProtectionDialogIntent,
  type SensitiveDataFinding,
} from "@ai-dlp/shared-types";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type {
  AttachmentStateFingerprint,
  ChatApplicationAdapter,
  LiveSubmissionContext,
} from "../adapters/chat-application-adapter.js";
import {
  AUTHORIZATION_LIFETIME_MS,
  consumeSubmissionAuthorization,
  createSubmissionAuthorization,
  type SubmissionAuthorization,
} from "./authorization.js";
import { toPolicyFinding } from "./display-model.js";
import { createSubmissionController } from "./submission-controller.js";

function emailFinding(prompt = "person@example.com"): SensitiveDataFinding {
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

type HarnessOptions = {
  prompt?: string;
  findings?: SensitiveDataFinding[];
  action?: PolicyAction;
  dialogIntent?: ProtectionDialogIntent;
  monotonicNow?: () => number;
  analyze?: () => SensitiveDataFinding[];
  evaluate?: (input: unknown) => PolicyDecision;
  auditDelay?: Promise<void>;
  hasAttachment?: boolean;
  attachmentAction?: "block" | "warn" | "allow";
  replacementCapability?: "supported" | "unsupported";
};

function createHarness(value: string | HarnessOptions = "clean prompt") {
  const harnessOptions = typeof value === "string" ? { prompt: value } : value;
  const prompt = harnessOptions.prompt ?? "clean prompt";
  let currentPrompt = prompt;
  let contextVersion = 1;
  let currentUrl = new URL("https://chatgpt.com/");
  let hasAttachment = harnessOptions.hasAttachment ?? false;
  let attachmentFingerprint = {} as AttachmentStateFingerprint;
  const composer = { isConnected: true } as HTMLElement;
  const sendControl = { isConnected: true } as HTMLElement;
  const submissionRegion = { isConnected: true } as HTMLElement;
  const context = (): LiveSubmissionContext => ({
    composer,
    sendControl,
    submissionRegion,
    applicationUrl: new URL(currentUrl.href),
    contextIdentity: 1,
    contextVersion,
  });
  let interceptor:
    Parameters<ChatApplicationAdapter["registerSubmitInterceptor"]>[0] | null =
    null;
  const inspectSubmissionCapabilities = vi.fn(() => ({
    attachmentPresent: hasAttachment,
    attachmentStateFingerprint: attachmentFingerprint,
  }));
  const getPromptReplacementCapability = vi.fn(
    () => harnessOptions.replacementCapability ?? "supported",
  );
  const adapter: ChatApplicationAdapter = {
    id: "chatgpt",
    version: "1",
    matches: (url) => url.origin === "https://chatgpt.com",
    resolveCurrentSubmissionContext: vi.fn(() => context()),
    resolveSubmissionContext: vi.fn(() => context()),
    inspectSubmissionCapabilities,
    getPromptReplacementCapability,
    readPrompt: vi.fn(() => currentPrompt),
    replacePrompt: vi.fn((_context, value) => {
      currentPrompt = value;
      return { ok: true as const, verifiedText: value };
    }),
    registerSubmitInterceptor: vi.fn((handler) => {
      interceptor = handler;
      return () => {
        interceptor = null;
      };
    }),
    resumeSubmission: vi.fn(),
    dispose: vi.fn(),
  };
  const events: AuditEvent[] = [];
  const dialog = {
    show: vi.fn(async () => harnessOptions.dialogIntent ?? "cancel"),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
  const controller = createSubmissionController({
    adapter,
    settings: () => ({
      ...createDefaultProtectionSettings(),
      attachmentAction: harnessOptions.attachmentAction ?? "warn",
    }),
    dialog,
    audit: {
      append: vi.fn(async (event: AuditEvent) => {
        if (event.kind !== "decision" || event.policyAction !== "allow") {
          events.push(event);
        }
        await harnessOptions.auditDelay;
      }),
    },
    eventId: () => "00000000-0000-4000-8000-000000000001",
    wallClockNow: () => new Date("2026-07-26T00:00:00.000Z"),
    ...(harnessOptions.monotonicNow === undefined
      ? {}
      : { monotonicNow: harnessOptions.monotonicNow }),
    analyze:
      harnessOptions.analyze ??
      (() => structuredClone(harnessOptions.findings ?? [])),
    evaluate:
      harnessOptions.evaluate ??
      (() => ({
        action:
          harnessOptions.action ??
          (hasAttachment
            ? (harnessOptions.attachmentAction ?? "warn")
            : "allow"),
        matchedRuleIds: hasAttachment
          ? ["attachment.unsupported"]
          : harnessOptions.action === undefined ||
              harnessOptions.action === "allow"
            ? ["allow.no-findings"]
            : ["warn.email"],
        reasonCode: hasAttachment
          ? "unsupported_attachment"
          : harnessOptions.action === undefined ||
              harnessOptions.action === "allow"
            ? "no_findings"
            : "policy_match",
        attachmentPresent: hasAttachment,
      })),
  });
  controller.register();
  return {
    adapter,
    controller,
    dialog,
    events,
    fire: (id = "attempt-1") =>
      interceptor?.({
        id,
        source: "click",
        contextIdentity: 1,
        initialContextVersion: 1,
      }),
    prompt: () => currentPrompt,
    setPrompt: (value: string) => {
      currentPrompt = value;
    },
    setAttachment: (value: boolean) => {
      hasAttachment = value;
      attachmentFingerprint = {} as AttachmentStateFingerprint;
    },
    mutateAttachment: () => {
      attachmentFingerprint = {} as AttachmentStateFingerprint;
    },
    inspectSubmissionCapabilities,
    getPromptReplacementCapability,
    replaceComposer: () => {
      contextVersion += 1;
    },
    navigate: (url: string) => {
      currentUrl = new URL(url);
      contextVersion += 1;
    },
  };
}

describe("submission authorization", () => {
  it("is one-shot and expires after five monotonic minutes", () => {
    const authorization = createSubmissionAuthorization("attempt-1", 10);
    expect(
      consumeSubmissionAuthorization(authorization, "attempt-1", 10),
    ).not.toBeNull();
    expect(
      consumeSubmissionAuthorization(authorization, "attempt-1", 10),
    ).toBeNull();

    const expired = createSubmissionAuthorization("attempt-2", 10);
    expect(
      consumeSubmissionAuthorization(
        expired,
        "attempt-2",
        10 + AUTHORIZATION_LIFETIME_MS + 1,
      ),
    ).toBeNull();
  });

  it("rejects forged objects without observing hostile fields or prototypes", () => {
    const attemptId = vi.fn(() => {
      throw new Error("must not read");
    });
    const forged = Object.create({ attemptId: "attempt-1" }) as object;
    Object.defineProperty(forged, "attemptId", { get: attemptId });

    expect(() =>
      consumeSubmissionAuthorization(
        forged as SubmissionAuthorization,
        "attempt-1",
        10,
      ),
    ).not.toThrow();
    expect(
      consumeSubmissionAuthorization(
        forged as SubmissionAuthorization,
        "attempt-1",
        10,
      ),
    ).toBeNull();
    expect(attemptId).not.toHaveBeenCalled();
  });
});

describe("submission privacy boundaries", () => {
  it("copies only four metadata fields into policy input", () => {
    expect(toPolicyFinding(emailFinding())).toEqual({
      id: createFindingId("email", 0, "person@example.com".length),
      detectorId: "email",
      category: "email",
      confidence: "high",
    });
  });
});

describe("submission controller", () => {
  it("blocks an attachment through a decision without analyzing attachment data", async () => {
    const analyze = vi.fn(() => []);
    const filename = "confidential-board-plan.pdf";
    const harness = createHarness({
      prompt: "",
      hasAttachment: true,
      attachmentAction: "block",
      analyze,
    });

    expect(harness.fire()).toBe("intercept");
    await harness.controller.whenSettledForTesting();

    expect(analyze).toHaveBeenCalledWith("", { protectedKeywords: [] });
    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "block",
        attachmentPresent: true,
        findings: [],
      }),
    );
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "decision",
      policyAction: "block",
      reasonCode: "unsupported_attachment",
      attachmentPresent: true,
      findingCount: 0,
      resolution: "blocked",
    });
    expect(JSON.stringify(harness.events)).not.toContain(filename);
  });

  it("warns and cancels an attachment-only attempt", async () => {
    const harness = createHarness({
      hasAttachment: true,
      attachmentAction: "warn",
    });

    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warn",
        attachmentPresent: true,
        findings: [],
      }),
    );
    expect(harness.events).toEqual([
      expect.objectContaining({
        kind: "decision",
        policyAction: "warn",
        resolution: "cancelled",
        attachmentPresent: true,
      }),
    ]);
  });

  it("uses attachment_bypassed for an attachment warning bypass", async () => {
    let settle!: (intent: ProtectionDialogIntent) => void;
    const harness = createHarness({
      hasAttachment: true,
      attachmentAction: "warn",
    });
    harness.dialog.show.mockImplementationOnce(
      () => new Promise((resolve) => (settle = resolve)),
    );
    harness.fire();
    await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());

    settle("bypass");
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).toHaveBeenCalledOnce();
    expect(harness.events).toContainEqual(
      expect.objectContaining({
        kind: "decision",
        resolution: "attachment_bypassed",
      }),
    );
  });

  it("allows an attachment dialog-free and without persistence", async () => {
    const harness = createHarness({
      hasAttachment: true,
      attachmentAction: "allow",
    });

    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).toHaveBeenCalledOnce();
    expect(harness.dialog.show).not.toHaveBeenCalled();
    expect(harness.events).toEqual([]);
  });

  it("uses one combined warning and attachment_bypassed resolution", async () => {
    const finding = emailFinding();
    const harness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      hasAttachment: true,
      dialogIntent: "bypass",
      evaluate: () => ({
        action: "warn",
        matchedRuleIds: ["warn.email", "attachment.unsupported"],
        reasonCode: "unsupported_attachment",
        attachmentPresent: true,
      }),
    });

    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warn",
        attachmentPresent: true,
        canRedact: false,
        findings: [expect.objectContaining({ category: "email" })],
      }),
    );
    expect(harness.adapter.resumeSubmission).toHaveBeenCalledOnce();
    expect(harness.events[0]).toMatchObject({
      reasonCode: "unsupported_attachment",
      attachmentPresent: true,
      resolution: "attachment_bypassed",
    });
  });

  it("does not let attachment approval bypass a stricter prompt block", async () => {
    const finding = emailFinding();
    const harness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      hasAttachment: true,
      dialogIntent: "bypass",
      evaluate: () => ({
        action: "block",
        matchedRuleIds: ["warn.email", "attachment.unsupported"],
        reasonCode: "policy_match",
        attachmentPresent: true,
      }),
    });

    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "block", attachmentPresent: true }),
    );
    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.events[0]).toMatchObject({
      policyAction: "block",
      resolution: "blocked",
      reasonCode: "policy_match",
    });
  });

  it.each(["added", "removed", "mutated"] as const)(
    "invalidates attachment approval when evidence is %s",
    async (change) => {
      let settle!: (intent: ProtectionDialogIntent) => void;
      const harness = createHarness({
        hasAttachment: change !== "added",
        attachmentAction: "warn",
        ...(change === "added"
          ? {
              prompt: "person@example.com",
              findings: [emailFinding()],
              action: "warn" as const,
            }
          : {}),
      });
      harness.dialog.show.mockImplementationOnce(
        () => new Promise((resolve) => (settle = resolve)),
      );
      harness.fire();
      await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());
      if (change === "added") harness.setAttachment(true);
      else if (change === "removed") harness.setAttachment(false);
      else harness.mutateAttachment();
      settle("bypass");
      await harness.controller.whenSettledForTesting();

      expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
      expect(harness.events).toContainEqual(
        expect.objectContaining({
          kind: "decision",
          resolution: "cancelled",
        }),
      );
    },
  );

  it("evaluates a new submission normally after its attachment is removed", async () => {
    const harness = createHarness({
      hasAttachment: true,
      attachmentAction: "block",
    });
    harness.fire("attached");
    await harness.controller.whenSettledForTesting();
    harness.setAttachment(false);

    harness.fire("attachment-removed");
    await harness.controller.whenSettledForTesting();
    expect(harness.adapter.resumeSubmission).toHaveBeenCalledOnce();
  });

  it("allows a clean prompt once without a persisted audit event", async () => {
    const harness = createHarness();
    expect(harness.fire()).toBe("intercept");
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).toHaveBeenCalledTimes(1);
    expect(harness.events).toEqual([]);
    expect(harness.controller.getDiagnosticsForTesting()).toEqual({
      state: "completed",
      hasActiveAttempt: false,
      hasPromptSnapshot: false,
      hasSensitiveFindings: false,
      hasAuthorization: false,
    });
  });

  it("does not scan an oversized prompt and records only a content-free error", async () => {
    const analyze = vi.fn(() => []);
    const harness = createHarness("x".repeat(100_001));
    harness.controller.dispose();
    const events: AuditEvent[] = [];
    const controller = createSubmissionController({
      adapter: harness.adapter,
      settings: () => createDefaultProtectionSettings(),
      dialog: harness.dialog,
      analyze,
      audit: { append: async (event) => void events.push(event) },
      eventId: () => "00000000-0000-4000-8000-000000000001",
      wallClockNow: () => new Date("2026-07-26T00:00:00.000Z"),
    });
    const disposition = controller.handleCapturedAttempt({
      id: "large",
      source: "enter",
      contextIdentity: 1,
      initialContextVersion: 1,
    });
    expect(disposition).toBe("intercept");
    await controller.whenSettledForTesting();

    expect(analyze).not.toHaveBeenCalled();
    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.dialog.show).toHaveBeenCalledWith({
      kind: "error",
      errorCode: "prompt_too_large",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: "prompt_too_large",
    });
    expect(JSON.stringify(events)).not.toContain("xxxxx");
  });

  it("shows oversized guidance and accepts the next attempt without waiting for audit storage", async () => {
    const neverSettles = new Promise<void>(() => undefined);
    const analyze = vi.fn(() => []);
    const harness = createHarness({
      prompt: "x".repeat(100_001),
      analyze,
      auditDelay: neverSettles,
    });
    harness.fire("oversized");
    await harness.controller.whenSettledForTesting();

    expect(harness.dialog.show).toHaveBeenCalledWith({
      kind: "error",
      errorCode: "prompt_too_large",
    });
    expect(harness.controller.getDiagnosticsForTesting()).toMatchObject({
      state: "cancelled",
      hasActiveAttempt: false,
      hasPromptSnapshot: false,
    });

    harness.setPrompt("clean");
    expect(harness.fire("next-attempt")).toBe("intercept");
    await harness.controller.whenSettledForTesting();
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(harness.adapter.resumeSubmission).toHaveBeenCalledTimes(1);
  });

  it("shows detector-failure guidance without waiting for audit storage", async () => {
    const neverSettles = new Promise<void>(() => undefined);
    const analyze = vi
      .fn<() => SensitiveDataFinding[]>()
      .mockImplementationOnce(() => {
        throw new Error("detector failed");
      })
      .mockReturnValue([]);
    const harness = createHarness({ analyze, auditDelay: neverSettles });
    harness.fire("detector-error");
    await harness.controller.whenSettledForTesting();

    expect(harness.dialog.show).toHaveBeenCalledWith({
      kind: "error",
      errorCode: "detector_failure",
    });
    expect(harness.controller.getDiagnosticsForTesting()).toMatchObject({
      state: "cancelled",
      hasActiveAttempt: false,
    });

    expect(harness.fire("after-detector-error")).toBe("intercept");
    await harness.controller.whenSettledForTesting();
    expect(harness.adapter.resumeSubmission).toHaveBeenCalledTimes(1);
  });

  it("scans a prompt at exactly 100,000 UTF-16 code units", async () => {
    const analyze = vi.fn(() => []);
    const harness = createHarness({
      prompt: "x".repeat(100_000),
      analyze,
    });
    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(harness.adapter.resumeSubmission).toHaveBeenCalledTimes(1);
  });

  it("passes through synchronously while protection is disabled", () => {
    const harness = createHarness();
    harness.controller.dispose();
    const controller = createSubmissionController({
      adapter: harness.adapter,
      settings: () => ({
        ...createDefaultProtectionSettings(),
        protectionEnabled: false,
      }),
      dialog: harness.dialog,
      audit: { append: vi.fn() },
    });

    expect(
      controller.handleCapturedAttempt({
        id: "disabled",
        source: "click",
        contextIdentity: 1,
        initialContextVersion: 1,
      }),
    ).toBe("pass_through");
    expect(harness.adapter.resolveSubmissionContext).not.toHaveBeenCalled();
  });

  it("stops a missing live context with one extension error", async () => {
    const harness = createHarness();
    vi.mocked(harness.adapter.resolveSubmissionContext).mockReturnValue(null);
    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: "extension_context_invalidated",
    });
  });

  it.each([
    ["cancel", "cancelled", 0],
    ["bypass", "bypassed", 1],
    ["redact", "redacted", 1],
  ] as const)(
    "maps warning intent %s to %s exactly",
    async (dialogIntent, resolution, resumeCount) => {
      const finding = emailFinding();
      const harness = createHarness({
        prompt: finding.matchedText,
        findings: [finding],
        action: "warn",
        dialogIntent,
      });
      harness.fire();
      await harness.controller.whenSettledForTesting();

      expect(harness.adapter.resumeSubmission).toHaveBeenCalledTimes(
        resumeCount,
      );
      expect(harness.events).toHaveLength(1);
      expect(harness.events[0]).toMatchObject({
        kind: "decision",
        policyAction: "warn",
        resolution,
        detectorCategories: ["email"],
        findingCount: 1,
      });
      if (dialogIntent === "redact") {
        expect(harness.prompt()).toBe("[EMAIL]");
      }
    },
  );

  it("automatically redacts and blocks without exposing findings to the dialog", async () => {
    const finding = emailFinding();
    const redactHarness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      action: "redact",
    });
    redactHarness.fire();
    await redactHarness.controller.whenSettledForTesting();
    expect(redactHarness.prompt()).toBe("[EMAIL]");
    expect(redactHarness.dialog.show).not.toHaveBeenCalled();
    expect(redactHarness.events[0]).toMatchObject({
      kind: "decision",
      policyAction: "redact",
      resolution: "redacted",
    });

    const blockHarness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      action: "block",
      dialogIntent: "bypass",
    });
    blockHarness.fire();
    await blockHarness.controller.whenSettledForTesting();
    expect(blockHarness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(blockHarness.dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "block",
        canRedact: false,
        findings: [
          {
            category: "email",
            confidence: "high",
            placeholder: "[EMAIL]",
          },
        ],
      }),
    );
    expect(blockHarness.events[0]).toMatchObject({
      kind: "decision",
      policyAction: "block",
      resolution: "blocked",
    });
  });

  it("hides redaction for an unsupported editor and fails closed for automatic redact", async () => {
    const finding = emailFinding();
    const warned = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      action: "warn",
      replacementCapability: "unsupported",
    });
    warned.fire();
    await warned.controller.whenSettledForTesting();
    expect(warned.dialog.show).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "warn", canRedact: false }),
    );

    const automatic = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      action: "redact",
      replacementCapability: "unsupported",
    });
    automatic.fire();
    await automatic.controller.whenSettledForTesting();
    expect(automatic.adapter.replacePrompt).not.toHaveBeenCalled();
    expect(automatic.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(automatic.events).toContainEqual(
      expect.objectContaining({
        kind: "enforcement_error",
        errorCode: "redaction_unavailable",
      }),
    );
  });

  it("classifies adapter prompt replacement failure as unavailable redaction", async () => {
    const finding = emailFinding();
    const harness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      action: "warn",
      dialogIntent: "redact",
    });
    vi.mocked(harness.adapter.replacePrompt).mockImplementation(() => {
      throw new Error(finding.matchedText);
    });
    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: "redaction_unavailable",
    });
  });

  it("passes an independently allocated four-field finding to policy", async () => {
    const finding = emailFinding();
    const evaluate = vi.fn<(input: unknown) => PolicyDecision>(() => ({
      action: "warn",
      matchedRuleIds: ["warn.email"],
      reasonCode: "policy_match",
      attachmentPresent: false,
    }));
    const harness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      evaluate,
    });
    harness.fire();
    await harness.controller.whenSettledForTesting();

    const input = evaluate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).toEqual({
      application: "chatgpt",
      attachmentPresent: false,
      findings: [
        {
          id: finding.id,
          detectorId: "email",
          category: "email",
          confidence: "high",
        },
      ],
      policy: expect.any(Object),
    });
    expect((input.findings as unknown[])[0]).not.toBe(finding);
    const serialized = JSON.stringify(input);
    for (const forbidden of [
      "matchedText",
      "redactedText",
      "sanitizedText",
      "start",
      "end",
      finding.matchedText,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("serializes physical attempts and does not create a second decision", async () => {
    let settle!: (intent: ProtectionDialogIntent) => void;
    const harness = createHarness({
      prompt: "person@example.com",
      findings: [emailFinding()],
      action: "warn",
    });
    harness.dialog.show.mockImplementation(
      () => new Promise((resolve) => (settle = resolve)),
    );
    expect(harness.fire("first")).toBe("intercept");
    await vi.waitFor(() =>
      expect(harness.dialog.show).toHaveBeenCalledTimes(1),
    );
    expect(harness.fire("duplicate")).toBe("intercept");
    settle("bypass");
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).toHaveBeenCalledTimes(1);
    expect(harness.events).toHaveLength(1);
  });

  it.each(["modified", "composer", "navigation"] as const)(
    "invalidates warning approval after %s change",
    async (change) => {
      let settle!: (intent: ProtectionDialogIntent) => void;
      const harness = createHarness({
        prompt: "person@example.com",
        findings: [emailFinding()],
        action: "warn",
      });
      harness.dialog.show.mockImplementation(
        () => new Promise((resolve) => (settle = resolve)),
      );
      harness.fire();
      await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());
      if (change === "modified") {
        harness.setPrompt("changed");
      } else if (change === "composer") {
        harness.replaceComposer();
      } else {
        harness.navigate("https://chatgpt.com/c/new");
      }
      settle("bypass");
      await harness.controller.whenSettledForTesting();

      expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
      expect(harness.events[0]).toMatchObject({
        kind: "decision",
        policyAction: "warn",
        resolution: "cancelled",
      });
    },
  );

  it("invalidates an approval after the five-minute lifetime", async () => {
    let now = 100;
    let settle!: (intent: ProtectionDialogIntent) => void;
    const harness = createHarness({
      prompt: "person@example.com",
      findings: [emailFinding()],
      action: "warn",
      monotonicNow: () => now,
    });
    harness.dialog.show.mockImplementation(
      () => new Promise((resolve) => (settle = resolve)),
    );
    harness.fire();
    await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());
    now += AUTHORIZATION_LIFETIME_MS + 1;
    settle("bypass");
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.events[0]).toMatchObject({ resolution: "cancelled" });
  });

  it("cancels an active dialog and makes its later action inert", async () => {
    let settle!: (intent: ProtectionDialogIntent) => void;
    const harness = createHarness({
      prompt: "person@example.com",
      findings: [emailFinding()],
      action: "warn",
    });
    harness.dialog.show.mockImplementation(
      () => new Promise((resolve) => (settle = resolve)),
    );
    harness.fire();
    await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());
    harness.controller.cancelActiveAttempt();
    settle("bypass");
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.events[0]).toMatchObject({ resolution: "cancelled" });
  });

  it("clears sensitive state immediately when dialog cancellation throws and never settles", async () => {
    let releaseAudit!: () => void;
    const auditDelay = new Promise<void>((resolve) => (releaseAudit = resolve));
    const harness = createHarness({
      prompt: "person@example.com",
      findings: [emailFinding()],
      action: "warn",
      auditDelay,
    });
    harness.dialog.show.mockImplementation(
      () => new Promise<ProtectionDialogIntent>(() => undefined),
    );
    harness.dialog.cancel.mockImplementation(() => {
      throw new Error("cancel failed");
    });
    harness.fire();
    await vi.waitFor(() =>
      expect(harness.controller.getDiagnosticsForTesting()).toMatchObject({
        state: "dialog",
        hasPromptSnapshot: true,
        hasSensitiveFindings: true,
        hasAuthorization: true,
      }),
    );

    expect(() => harness.controller.cancelActiveAttempt()).not.toThrow();
    expect(harness.controller.getDiagnosticsForTesting()).toMatchObject({
      state: "cancelled",
      hasActiveAttempt: false,
      hasPromptSnapshot: false,
      hasSensitiveFindings: false,
      hasAuthorization: false,
    });
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "decision",
      policyAction: "warn",
      resolution: "cancelled",
      detectorCategories: ["email"],
      findingCount: 1,
    });
    releaseAudit();
    await harness.controller.whenSettledForTesting();
    expect(harness.events).toHaveLength(1);
  });

  it("clears sensitive state and emits one UI error even when a failed dialog never settles", async () => {
    let releaseAudit!: () => void;
    const auditDelay = new Promise<void>((resolve) => (releaseAudit = resolve));
    const harness = createHarness({
      prompt: "person@example.com",
      findings: [emailFinding()],
      action: "warn",
      auditDelay,
    });
    harness.dialog.show.mockImplementation(
      () => new Promise<ProtectionDialogIntent>(() => undefined),
    );
    harness.fire();
    await vi.waitFor(() =>
      expect(harness.controller.getDiagnosticsForTesting()).toMatchObject({
        state: "dialog",
        hasPromptSnapshot: true,
        hasSensitiveFindings: true,
        hasAuthorization: true,
      }),
    );

    harness.controller.reportDialogRenderFailure();
    harness.controller.reportDialogRenderFailure();
    expect(harness.controller.getDiagnosticsForTesting()).toMatchObject({
      state: "cancelled",
      hasActiveAttempt: false,
      hasPromptSnapshot: false,
      hasSensitiveFindings: false,
      hasAuthorization: false,
    });
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: "ui_failure",
    });
    releaseAudit();
    await harness.controller.whenSettledForTesting();
    expect(harness.events).toHaveLength(1);
  });

  it("disposal releases prompt and authorization state without exposing either on the controller", async () => {
    const prompt = "person@example.com";
    const harness = createHarness({
      prompt,
      findings: [emailFinding()],
      action: "warn",
    });
    harness.dialog.show.mockImplementation(
      () => new Promise<ProtectionDialogIntent>(() => undefined),
    );
    harness.fire();
    await vi.waitFor(() =>
      expect(harness.controller.getDiagnosticsForTesting()).toMatchObject({
        state: "dialog",
        hasPromptSnapshot: true,
        hasSensitiveFindings: true,
        hasAuthorization: true,
      }),
    );
    expect(JSON.stringify(harness.controller)).not.toContain(prompt);

    harness.controller.dispose();
    expect(harness.controller.getDiagnosticsForTesting()).toEqual({
      state: "cancelled",
      hasActiveAttempt: false,
      hasPromptSnapshot: false,
      hasSensitiveFindings: false,
      hasAuthorization: false,
    });
    expect(JSON.stringify(harness.controller)).not.toContain(prompt);
  });

  it("passes only placeholder metadata to UI and audit boundaries", async () => {
    const finding = emailFinding();
    const harness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      action: "warn",
      dialogIntent: "cancel",
    });
    harness.fire();
    await harness.controller.whenSettledForTesting();

    const boundary = JSON.stringify({
      dialogCalls: harness.dialog.show.mock.calls,
      auditEvents: harness.events,
    });
    expect(boundary).toContain("[EMAIL]");
    for (const forbidden of [
      finding.matchedText,
      "matchedText",
      "redactedText",
      "sanitizedText",
      '"start"',
      '"end"',
    ]) {
      expect(boundary).not.toContain(forbidden);
    }
  });

  it.each([
    ["detector_failure", "analyze"],
    ["policy_failure", "evaluate"],
    ["ui_failure", "dialog"],
    ["resume_failure", "resume"],
  ] as const)("stops and records a content-free %s", async (code, source) => {
    const finding = emailFinding();
    const harness = createHarness({
      prompt: finding.matchedText,
      findings: [finding],
      action: source === "dialog" ? "warn" : "allow",
      ...(source === "analyze"
        ? {
            analyze: () => {
              throw new Error(finding.matchedText);
            },
          }
        : {}),
      ...(source === "evaluate"
        ? {
            evaluate: () => {
              throw new Error(finding.matchedText);
            },
          }
        : {}),
    });
    if (source === "dialog") {
      harness.dialog.show.mockRejectedValueOnce(new Error(finding.matchedText));
    }
    if (source === "resume") {
      vi.mocked(harness.adapter.resumeSubmission).mockImplementation(() => {
        throw new Error(finding.matchedText);
      });
    }
    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).toHaveBeenCalledTimes(
      source === "resume" ? 1 : 0,
    );
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: code,
    });
    expect(JSON.stringify(harness.events)).not.toContain(finding.matchedText);
  });

  it("converts the dialog render-failure callback into one UI error", async () => {
    let settle!: (intent: ProtectionDialogIntent) => void;
    const harness = createHarness({
      prompt: "person@example.com",
      findings: [emailFinding()],
      action: "warn",
    });
    harness.dialog.show.mockImplementation(
      () => new Promise((resolve) => (settle = resolve)),
    );
    harness.fire();
    await vi.waitFor(() => expect(harness.dialog.show).toHaveBeenCalled());
    harness.controller.reportDialogRenderFailure();
    settle("cancel");
    await harness.controller.whenSettledForTesting();

    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "enforcement_error",
      errorCode: "ui_failure",
    });
  });

  it("treats a malformed runtime dialog intent as cancellation", async () => {
    const harness = createHarness({
      prompt: "person@example.com",
      findings: [emailFinding()],
      action: "warn",
    });
    harness.dialog.show.mockResolvedValue(
      "unexpected" as ProtectionDialogIntent,
    );
    harness.fire();
    await harness.controller.whenSettledForTesting();

    expect(harness.adapter.resumeSubmission).not.toHaveBeenCalled();
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0]).toMatchObject({
      kind: "decision",
      policyAction: "warn",
      resolution: "cancelled",
    });
  });

  it("keeps all DOM-bearing adapter operations out of async controller frames", () => {
    const source = readFileSync(
      new URL("./submission-controller.ts", import.meta.url),
      "utf8",
    );
    const asyncResume = source.slice(
      source.indexOf("async function resumeApproved"),
      source.indexOf("async function processAttempt"),
    );
    const asyncProcess = source.slice(
      source.indexOf("async function processAttempt"),
      source.indexOf("function handleCapturedAttempt"),
    );

    expect(source).toContain("function capturePromptSynchronously");
    expect(source).toContain("function performApprovedResumeSynchronously");
    for (const asyncFrame of [asyncResume, asyncProcess]) {
      expect(asyncFrame).not.toContain("LiveSubmissionContext");
      expect(asyncFrame).not.toContain("resolveCurrentSubmissionContext");
      expect(asyncFrame).not.toContain("adapter.readPrompt");
      expect(asyncFrame).not.toContain("adapter.replacePrompt");
      expect(asyncFrame).not.toContain("adapter.resumeSubmission");
    }
  });
});
