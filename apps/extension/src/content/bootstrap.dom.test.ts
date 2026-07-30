import { describe, expect, it, vi } from "vitest";

import {
  SETTINGS_PORT_NAME,
  type AuditEvent,
  type ProtectionSettings,
} from "@ai-dlp/shared-types";

import type {
  AdapterHealthTransition,
  AttachmentStateFingerprint,
  ChatApplicationAdapter,
  LiveSubmissionContext,
  SubmitInterceptor,
} from "../adapters/chat-application-adapter.js";
import type { ChatGptAdapterOptions } from "../adapters/chatgpt/chatgpt-adapter.js";
import {
  CHATGPT_ADAPTER_DESCRIPTOR,
  ChatGptAdapterError,
} from "../adapters/chatgpt/chatgpt-adapter.js";
import type { ProtectionDialogController } from "../ui/protection-dialog/dialog-controller.js";
import type {
  SubmissionController,
  SubmissionControllerOptions,
} from "./submission-controller.js";
import {
  bootstrapContent,
  type ContentRuntime,
  type ContentRuntimePort,
} from "./bootstrap.js";
import type { RetryScheduler } from "./settings-cache.js";

function createPort(): ContentRuntimePort & {
  emitMessage(value: unknown): void;
  emitDisconnect(): void;
  listenerCounts(): { message: number; disconnect: number };
} {
  const messages = new Set<(value: unknown) => void>();
  const disconnects = new Set<() => void>();
  return {
    name: SETTINGS_PORT_NAME,
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener(listener) {
        messages.add(listener);
      },
      removeListener(listener) {
        messages.delete(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        disconnects.add(listener);
      },
      removeListener(listener) {
        disconnects.delete(listener);
      },
    },
    emitMessage(value) {
      for (const listener of messages) listener(value);
    },
    emitDisconnect() {
      for (const listener of [...disconnects]) listener();
    },
    listenerCounts() {
      return { message: messages.size, disconnect: disconnects.size };
    },
  };
}

function createScheduler(): RetryScheduler & { runNext(): void } {
  const queue: Array<() => void> = [];
  return {
    schedule(callback) {
      let cancelled = false;
      queue.push(() => {
        if (!cancelled) callback();
      });
      return () => {
        cancelled = true;
      };
    },
    runNext() {
      queue.shift()?.();
    },
  };
}

function settingsSnapshot(
  enabled = true,
  generation = 0,
  overrides: Partial<ProtectionSettings> = {},
) {
  const settings: ProtectionSettings = {
    protectionEnabled: enabled,
    emailAction: "warn",
    phoneAction: "warn",
    attachmentAction: "warn",
    protectedKeywords: [],
    auditRetentionLimit: 100,
    ...overrides,
  };
  return {
    type: "settings.snapshot" as const,
    generation,
    envelope: { schemaVersion: 2 as const, settings },
  };
}

const ENFORCEMENT_POLICY_CHANGES: Array<[string, Partial<ProtectionSettings>]> =
  [
    ["email", { emailAction: "block" }],
    ["phone", { phoneAction: "block" }],
    ["attachment", { attachmentAction: "block" }],
    ["protected keyword", { protectedKeywords: ["project atlas"] }],
  ];

class FakeAdapter implements ChatApplicationAdapter {
  readonly descriptor = CHATGPT_ADAPTER_DESCRIPTOR;
  interceptor: SubmitInterceptor | null = null;
  readonly unregister = vi.fn(() => {
    this.interceptor = null;
  });
  readonly dispose = vi.fn();

  matches(): boolean {
    return true;
  }
  resolveCurrentSubmissionContext(): LiveSubmissionContext | null {
    return null;
  }
  resolveSubmissionContext(): LiveSubmissionContext | null {
    return null;
  }
  inspectSubmissionCapabilities() {
    return {
      attachmentPresent: false,
      attachmentStateFingerprint: {} as never,
    };
  }
  getPromptReplacementCapability() {
    return "unsupported" as const;
  }
  readPrompt(): string {
    throw new Error("not used");
  }
  replacePrompt() {
    return { ok: false as const, reason: "unsupported_editor" as const };
  }
  registerSubmitInterceptor(handler: SubmitInterceptor): () => void {
    this.interceptor = handler;
    return this.unregister;
  }
  resumeSubmission(): void {}
}

class IntegrationAdapter implements ChatApplicationAdapter {
  readonly descriptor = CHATGPT_ADAPTER_DESCRIPTOR;
  readonly composer = document.createElement("textarea");
  readonly sendControl = document.createElement("button");
  readonly submissionRegion = document.createElement("form");
  readonly attachmentFingerprint = {} as AttachmentStateFingerprint;
  readonly dispose = vi.fn();
  readonly resumeSubmission = vi.fn();
  interceptor: SubmitInterceptor | null = null;
  attachmentPresent = false;

  constructor(prompt: string, attachmentPresent = false) {
    this.composer.value = prompt;
    this.attachmentPresent = attachmentPresent;
    this.submissionRegion.append(this.composer, this.sendControl);
    document.body.append(this.submissionRegion);
  }

  matches(): boolean {
    return true;
  }
  resolveCurrentSubmissionContext(): LiveSubmissionContext | null {
    return this.resolveSubmissionContext();
  }
  resolveSubmissionContext(): LiveSubmissionContext | null {
    return {
      composer: this.composer,
      sendControl: this.sendControl,
      submissionRegion: this.submissionRegion,
      applicationUrl: new URL("https://chatgpt.com/"),
      contextIdentity: 1,
      contextVersion: 1,
    };
  }
  inspectSubmissionCapabilities() {
    return {
      attachmentPresent: this.attachmentPresent,
      attachmentStateFingerprint: this.attachmentFingerprint,
    };
  }
  getPromptReplacementCapability() {
    return "unsupported" as const;
  }
  readPrompt(): string {
    return this.composer.value;
  }
  replacePrompt() {
    return { ok: false as const, reason: "unsupported_editor" as const };
  }
  registerSubmitInterceptor(handler: SubmitInterceptor): () => void {
    this.interceptor = handler;
    return () => {
      this.interceptor = null;
    };
  }
  submit(id: string): void {
    this.interceptor?.({
      id,
      source: "click",
      contextIdentity: 1,
      initialContextVersion: 1,
    });
  }
}

function enforcementIntegrationHarness(options: {
  prompt: string;
  initial: Partial<ProtectionSettings>;
  attachmentPresent?: boolean;
}) {
  const port = createPort();
  const adapter = new IntegrationAdapter(
    options.prompt,
    options.attachmentPresent,
  );
  const audits: AuditEvent[] = [];
  let settleWarning: ((intent: "bypass") => void) | undefined;
  const dialog: ProtectionDialogController = {
    show: vi.fn((intent) => {
      if (intent.kind === "warn") {
        return new Promise((resolve: (intent: "bypass") => void) => {
          settleWarning = resolve;
        });
      }
      return Promise.resolve("cancel" as const);
    }),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
  const content = bootstrapContent({
    document,
    runtime: {
      connect: () => port,
      sendMessage: async (message) => {
        const request = message as { type: string; event?: AuditEvent };
        if (request.type === "audit.append" && request.event !== undefined) {
          audits.push(request.event);
        }
        return { type: "audit.appended" };
      },
    },
    createAdapter: () => adapter,
    createDialog: () => dialog,
    eventId: () => "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  port.emitMessage(settingsSnapshot(true, 0, options.initial));
  return {
    adapter,
    audits,
    content,
    dialog,
    port,
    settleWarning: () => settleWarning?.("bypass"),
  };
}

function harness() {
  const firstPort = createPort();
  const secondPort = createPort();
  const scheduler = createScheduler();
  const runtime: ContentRuntime = {
    connect: vi
      .fn<() => ContentRuntimePort>()
      .mockReturnValueOnce(firstPort)
      .mockReturnValueOnce(secondPort),
    sendMessage: vi.fn(async () => ({ type: "audit.appended" })),
  };
  const adapter = new FakeAdapter();
  let adapterOptions: ChatGptAdapterOptions | undefined;
  let dialogFailure: (() => void) | undefined;
  const dialog: ProtectionDialogController = {
    show: vi.fn(async () => "cancel" as const),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
  let controllerOptions: SubmissionControllerOptions | undefined;
  const registrationDispose = vi.fn();
  const controller: SubmissionController = {
    register: vi.fn(() => registrationDispose),
    handleCapturedAttempt: vi.fn(() => "intercept" as const),
    cancelActiveAttempt: vi.fn(),
    reportDialogRenderFailure: vi.fn(),
    dispose: vi.fn(),
    whenSettledForTesting: vi.fn(async () => undefined),
    getDiagnosticsForTesting: vi.fn(() => ({
      state: "idle" as const,
      hasActiveAttempt: false,
      hasPromptSnapshot: false,
      hasSensitiveFindings: false,
      hasAuthorization: false,
    })),
  };
  const createAdapter = vi.fn((options: ChatGptAdapterOptions) => {
    adapterOptions = options;
    return adapter;
  });
  const createDialog = vi.fn(
    (_document: Document, options: { onRenderFailure?: () => void }) => {
      dialogFailure = options.onRenderFailure;
      return dialog;
    },
  );
  const createController = vi.fn((options: SubmissionControllerOptions) => {
    controllerOptions = options;
    return controller;
  });
  const content = bootstrapContent({
    document,
    runtime,
    scheduler,
    createAdapter,
    createDialog,
    createController,
    eventId: () => "00000000-0000-4000-8000-000000000001",
    now: () => new Date("2026-07-26T00:00:00.000Z"),
  });
  return {
    content,
    firstPort,
    secondPort,
    scheduler,
    runtime,
    adapter,
    dialog,
    controller,
    registrationDispose,
    createAdapter,
    createDialog,
    createController,
    getAdapterOptions: () => adapterOptions,
    getDialogFailure: () => dialogFailure,
    getControllerOptions: () => controllerOptions,
  };
}

describe("content bootstrap", () => {
  it("creates no protection runtime, observer source, or health audit while disabled", () => {
    const h = harness();

    h.firstPort.emitMessage(settingsSnapshot(false));

    expect(h.content.getStatus().state).toBe("disabled");
    expect(h.createAdapter).not.toHaveBeenCalled();
    expect(h.createDialog).not.toHaveBeenCalled();
    expect(h.createController).not.toHaveBeenCalled();
    expect(h.controller.register).not.toHaveBeenCalled();
    expect(h.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("fully disposes on disable and creates exactly one fresh runtime on re-enable", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot(true));
    expect(h.createAdapter).toHaveBeenCalledOnce();

    h.firstPort.emitMessage(settingsSnapshot(false, 1));
    expect(h.registrationDispose).toHaveBeenCalledOnce();
    expect(h.controller.dispose).toHaveBeenCalledOnce();
    expect(h.dialog.dispose).toHaveBeenCalledOnce();
    expect(h.adapter.dispose).toHaveBeenCalledOnce();

    h.firstPort.emitMessage(settingsSnapshot(false, 2));
    expect(h.createAdapter).toHaveBeenCalledOnce();
    h.firstPort.emitMessage(settingsSnapshot(true, 3));
    h.firstPort.emitMessage(settingsSnapshot(true, 4));
    expect(h.createAdapter).toHaveBeenCalledTimes(2);
  });

  it("passes through the documented initialization interval and cannot report active", () => {
    const h = harness();

    expect(h.content.getStatus()).toEqual({
      state: "initializing",
      application: "chatgpt",
      protectionEnabled: null,
    });
    expect(h.controller.register).not.toHaveBeenCalled();
    expect(h.adapter.interceptor).toBeNull();
    expect(h.firstPort.postMessage).toHaveBeenCalledOnce();
    expect(h.firstPort.postMessage).toHaveBeenCalledWith({
      type: "content.handshake",
      descriptor: CHATGPT_ADAPTER_DESCRIPTOR,
    });

    h.firstPort.emitMessage({ type: "settings.snapshot", envelope: {} });
    expect(h.content.getStatus().state).toBe("initializing");
    expect(h.controller.register).not.toHaveBeenCalled();
    expect(h.firstPort.postMessage).toHaveBeenCalledOnce();

    h.firstPort.emitMessage(settingsSnapshot());
    expect(h.controller.register).toHaveBeenCalledOnce();
    expect(h.content.getStatus()).toEqual({
      state: "active",
      application: "chatgpt",
      protectionEnabled: true,
    });
    expect(h.firstPort.postMessage).toHaveBeenLastCalledWith({
      type: "status.snapshot",
      generation: 0,
      status: expect.objectContaining({ state: "active" }),
    });
  });

  it("disconnects a port whose handshake post fails and reconnects cleanly", () => {
    const firstPort = createPort();
    const secondPort = createPort();
    const scheduler = createScheduler();
    vi.mocked(firstPort.postMessage).mockImplementationOnce(() => {
      throw new Error("extension context invalidated");
    });
    const runtime: ContentRuntime = {
      connect: vi
        .fn<() => ContentRuntimePort>()
        .mockReturnValueOnce(firstPort)
        .mockReturnValueOnce(secondPort),
      sendMessage: vi.fn(),
    };

    const content = bootstrapContent({
      document,
      runtime,
      scheduler,
      createAdapter: () => new FakeAdapter(),
    });

    expect(firstPort.disconnect).toHaveBeenCalledOnce();
    expect(firstPort.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(content.getStatus()).toEqual({
      state: "unavailable",
      application: "chatgpt",
      protectionEnabled: null,
    });

    scheduler.runNext();

    expect(secondPort.postMessage).toHaveBeenCalledWith({
      type: "content.handshake",
      descriptor: CHATGPT_ADAPTER_DESCRIPTOR,
    });
    expect(content.getStatus().state).toBe("initializing");
    secondPort.emitMessage(settingsSnapshot(false));
    expect(content.getStatus().state).toBe("disabled");
    expect(firstPort.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    content.dispose();
  });

  it("updates atomically, disposes on disable, and recreates on enable", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    const controllerOptions = h.getControllerOptions();
    expect(controllerOptions?.settings().protectionEnabled).toBe(true);

    h.firstPort.emitMessage(settingsSnapshot(false, 1));
    expect(h.controller.cancelActiveAttempt).toHaveBeenCalledOnce();
    expect(controllerOptions?.settings().protectionEnabled).toBe(false);
    expect(h.content.getStatus().state).toBe("disabled");
    expect(h.controller.register).toHaveBeenCalledOnce();

    h.firstPort.emitMessage(settingsSnapshot(true, 2));
    expect(h.content.getStatus().state).toBe("active");
    expect(h.controller.register).toHaveBeenCalledTimes(2);
    expect(h.controller.cancelActiveAttempt).toHaveBeenCalledOnce();
    expect(h.controller.dispose).toHaveBeenCalledOnce();
  });

  it.each(ENFORCEMENT_POLICY_CHANGES)(
    "increments the enforcement revision and cancels active work for a %s policy change",
    (_label, overrides) => {
      const h = harness();
      h.firstPort.emitMessage(settingsSnapshot(true, 0));
      const controllerOptions = h.getControllerOptions() as
        | (SubmissionControllerOptions & { currentRevision?: () => number })
        | undefined;

      expect(controllerOptions?.currentRevision?.()).toBe(1);
      h.firstPort.emitMessage(settingsSnapshot(true, 1, overrides));

      expect(controllerOptions?.currentRevision?.()).toBe(2);
      expect(h.controller.cancelActiveAttempt).toHaveBeenCalledOnce();
    },
  );

  it("preserves the enforcement revision and active attempt for an audit retention-only update", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot(true, 0));
    const controllerOptions = h.getControllerOptions() as
      | (SubmissionControllerOptions & { currentRevision?: () => number })
      | undefined;

    h.firstPort.emitMessage(
      settingsSnapshot(true, 1, { auditRetentionLimit: 99 }),
    );

    expect(controllerOptions?.currentRevision?.()).toBe(1);
    expect(h.controller.cancelActiveAttempt).not.toHaveBeenCalled();
    expect(h.content.getSettings()?.auditRetentionLimit).toBe(99);
  });

  it("preserves the enforcement revision and active attempt for an identical normalized settings snapshot", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot(true, 0));
    const controllerOptions = h.getControllerOptions() as
      | (SubmissionControllerOptions & { currentRevision?: () => number })
      | undefined;

    h.firstPort.emitMessage(settingsSnapshot(true, 1));

    expect(controllerOptions?.currentRevision?.()).toBe(1);
    expect(h.controller.cancelActiveAttempt).not.toHaveBeenCalled();
  });

  it("disposes interception on disconnect and needs a fresh reconnect snapshot", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    h.firstPort.emitDisconnect();

    expect(h.controller.cancelActiveAttempt).toHaveBeenCalledOnce();
    expect(h.registrationDispose).toHaveBeenCalledOnce();
    expect(h.controller.dispose).toHaveBeenCalledOnce();
    expect(h.dialog.dispose).toHaveBeenCalledOnce();
    expect(h.adapter.dispose).toHaveBeenCalledOnce();
    expect(h.content.getStatus()).toEqual({
      state: "unavailable",
      application: "chatgpt",
      protectionEnabled: null,
    });

    h.scheduler.runNext();
    expect(h.content.getStatus().state).toBe("initializing");
    expect(h.controller.register).toHaveBeenCalledOnce();
    h.secondPort.emitMessage(settingsSnapshot());
    expect(h.controller.register).toHaveBeenCalledTimes(2);
    expect(h.content.getStatus().state).toBe("active");
  });

  it.each([
    ["email", "person@example.com", { emailAction: "block" }],
    ["phone", "+1 415 555 2671", { phoneAction: "block" }],
    ["attachment", "clean", { attachmentAction: "block" }, true],
  ] as const)(
    "makes a stale %s warning inert and blocks a new submission through the production runtime",
    async (
      _name,
      prompt,
      changedSettings,
      attachmentPresent: boolean = false,
    ) => {
      const h = enforcementIntegrationHarness({
        prompt,
        initial: { attachmentAction: "warn" },
        attachmentPresent,
      });
      h.adapter.submit("first");
      await vi.waitFor(() =>
        expect(h.dialog.show).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "warn" }),
        ),
      );

      h.port.emitMessage(settingsSnapshot(true, 1, changedSettings));
      h.settleWarning();
      await vi.waitFor(() =>
        expect(h.audits).toContainEqual(
          expect.objectContaining({
            kind: "decision",
            policyAction: "warn",
            resolution: "cancelled",
          }),
        ),
      );

      expect(h.adapter.resumeSubmission).not.toHaveBeenCalled();
      expect(
        h.audits.filter(
          (event) =>
            event.kind === "decision" &&
            event.policyAction === "warn" &&
            event.resolution === "cancelled",
        ),
      ).toHaveLength(1);

      h.adapter.submit("second");
      await vi.waitFor(() =>
        expect(h.dialog.show).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: "block" }),
        ),
      );
      expect(h.adapter.resumeSubmission).not.toHaveBeenCalled();
      h.content.dispose();
    },
  );

  it("makes a stale protected-keyword warning inert and evaluates a resubmission under the replacement keyword set", async () => {
    const h = enforcementIntegrationHarness({
      prompt: "project atlas",
      initial: { protectedKeywords: ["project atlas"] },
    });
    h.adapter.submit("first");
    await vi.waitFor(() =>
      expect(h.dialog.show).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "warn" }),
      ),
    );

    h.port.emitMessage(
      settingsSnapshot(true, 1, { protectedKeywords: ["other project"] }),
    );
    h.settleWarning();
    await vi.waitFor(() =>
      expect(h.audits).toContainEqual(
        expect.objectContaining({
          kind: "decision",
          policyAction: "warn",
          resolution: "cancelled",
        }),
      ),
    );
    expect(h.adapter.resumeSubmission).not.toHaveBeenCalled();

    h.adapter.submit("second");
    await vi.waitFor(() =>
      expect(h.adapter.resumeSubmission).toHaveBeenCalledOnce(),
    );
    h.content.dispose();
  });

  it("wires content-free health audit, degraded status, and dialog failure", async () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    h.getAdapterOptions()?.onHealthTransition?.({
      status: "degraded",
      healthCode: "composer_not_found",
    });

    expect(h.content.getStatus().state).toBe("degraded");
    expect(h.runtime.sendMessage).toHaveBeenCalledWith({
      type: "audit.append",
      event: expect.objectContaining({
        kind: "adapter_health",
        status: "degraded",
        healthCode: "composer_not_found",
      }) as AuditEvent,
    });
    expect(
      JSON.stringify(vi.mocked(h.runtime.sendMessage).mock.calls),
    ).not.toContain("prompt");

    h.getAdapterOptions()?.onHealthTransition?.({ status: "healthy" });
    expect(h.content.getStatus().state).toBe("active");
    h.getDialogFailure()?.();
    expect(h.controller.reportDialogRenderFailure).toHaveBeenCalledOnce();
    await Promise.resolve();
  });

  it("reports waiting without a health audit until composer health is confirmed", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    h.getAdapterOptions()?.onHealthTransition?.({
      status: "waiting_for_composer",
    });

    expect(h.content.getStatus()).toEqual({
      state: "waiting_for_composer",
      application: "chatgpt",
      protectionEnabled: true,
    });
    expect(h.runtime.sendMessage).not.toHaveBeenCalled();

    h.getAdapterOptions()?.onHealthTransition?.({ status: "healthy" });
    expect(h.content.getStatus().state).toBe("active");
  });

  it("fails safe on interceptor errors even when audit and guidance reporters fail", async () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    vi.mocked(h.runtime.sendMessage).mockRejectedValueOnce(
      new Error("runtime unavailable"),
    );
    vi.mocked(h.dialog.show).mockRejectedValueOnce(
      new Error("dialog unavailable"),
    );

    expect(() =>
      h
        .getAdapterOptions()
        ?.onAdapterError?.(new ChatGptAdapterError("interceptor_failure")),
    ).not.toThrow();
    expect(h.controller.cancelActiveAttempt).toHaveBeenCalledOnce();
    expect(h.content.getStatus().state).toBe("degraded");
    expect(h.dialog.show).toHaveBeenCalledWith({
      kind: "error",
      errorCode: "extension_context_invalidated",
    });
    expect(h.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.runtime.sendMessage).toHaveBeenCalledWith({
      type: "audit.append",
      event: expect.objectContaining({
        kind: "enforcement_error",
        errorCode: "extension_context_invalidated",
      }) as AuditEvent,
    });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("contains synchronous runtime, dialog, and status reporter failures", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    vi.mocked(h.runtime.sendMessage).mockImplementationOnce(() => {
      throw new Error("runtime failed synchronously");
    });
    vi.mocked(h.dialog.show).mockImplementationOnce(() => {
      throw new Error("dialog failed synchronously");
    });
    vi.mocked(h.firstPort.postMessage).mockImplementationOnce(() => {
      throw new Error("status port failed synchronously");
    });
    vi.mocked(h.controller.cancelActiveAttempt).mockImplementation(() => {
      throw new Error("controller cancellation failed synchronously");
    });

    expect(() =>
      h
        .getAdapterOptions()
        ?.onAdapterError?.(new ChatGptAdapterError("interceptor_failure")),
    ).not.toThrow();
    expect(h.runtime.sendMessage).toHaveBeenCalledOnce();
    expect(h.dialog.show).toHaveBeenCalledOnce();
    expect(h.firstPort.postMessage).toHaveBeenLastCalledWith({
      type: "status.snapshot",
      generation: 0,
      status: {
        state: "degraded",
        application: "chatgpt",
        protectionEnabled: true,
      },
    });
    expect(h.content.getStatus().state).toBe("unavailable");
    expect(h.firstPort.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
  });

  it("disposes every owned resource once and ignores late callbacks", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    h.content.dispose();
    h.content.dispose();

    expect(h.registrationDispose).toHaveBeenCalledOnce();
    expect(h.controller.dispose).toHaveBeenCalledOnce();
    expect(h.dialog.dispose).toHaveBeenCalledOnce();
    expect(h.adapter.dispose).toHaveBeenCalledOnce();
    expect(h.content.getStatus().state).toBe("unavailable");

    h.getAdapterOptions()?.onHealthTransition?.({
      status: "degraded",
      healthCode: "unsupported_dom_variant",
    } as AdapterHealthTransition);
    expect(h.content.getStatus().state).toBe("unavailable");
  });

  it("attempts every cleanup and clears reconnect work when disposers throw", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    h.registrationDispose.mockImplementation(() => {
      throw new Error("registration cleanup failed");
    });
    vi.mocked(h.controller.dispose).mockImplementation(() => {
      throw new Error("controller cleanup failed");
    });
    vi.mocked(h.dialog.dispose).mockImplementation(() => {
      throw new Error("dialog cleanup failed");
    });
    h.adapter.dispose.mockImplementation(() => {
      throw new Error("adapter cleanup failed");
    });

    h.firstPort.emitDisconnect();
    expect(h.firstPort.listenerCounts()).toEqual({ message: 0, disconnect: 0 });
    expect(() => h.content.dispose()).not.toThrow();
    expect(h.controller.dispose).toHaveBeenCalledOnce();
    expect(h.dialog.dispose).toHaveBeenCalledOnce();
    expect(h.adapter.dispose).toHaveBeenCalledOnce();
    expect(h.content.getSettings()).toBeNull();
    expect(h.content.getStatus().state).toBe("unavailable");

    const connectCount = vi.mocked(h.runtime.connect).mock.calls.length;
    h.scheduler.runNext();
    expect(h.runtime.connect).toHaveBeenCalledTimes(connectCount);
  });
});
