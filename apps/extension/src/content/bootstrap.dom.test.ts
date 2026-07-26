import { describe, expect, it, vi } from "vitest";

import {
  SETTINGS_PORT_NAME,
  type AuditEvent,
  type ProtectionSettings,
} from "@ai-dlp/shared-types";

import type {
  ChatApplicationAdapter,
  LiveSubmissionContext,
  SubmitInterceptor,
} from "../adapters/chat-application-adapter.js";
import type {
  AdapterHealthTransition,
  ChatGptAdapterOptions,
} from "../adapters/chatgpt/chatgpt-adapter.js";
import { ChatGptAdapterError } from "../adapters/chatgpt/chatgpt-adapter.js";
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

function settingsSnapshot(enabled = true, generation = 0) {
  const settings: ProtectionSettings = {
    protectionEnabled: enabled,
    emailAction: "warn",
    phoneAction: "warn",
    protectedKeywords: [],
    auditRetentionLimit: 100,
  };
  return {
    type: "settings.snapshot" as const,
    generation,
    envelope: { schemaVersion: 1 as const, settings },
  };
}

class FakeAdapter implements ChatApplicationAdapter {
  readonly id = "chatgpt" as const;
  readonly version = "1";
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
  inspectSubmissionCapabilities() {
    return { hasUnsupportedAttachment: false };
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
  const content = bootstrapContent({
    document,
    runtime,
    scheduler,
    createAdapter(options) {
      adapterOptions = options;
      return adapter;
    },
    createDialog(_document, options) {
      dialogFailure = options.onRenderFailure;
      return dialog;
    },
    createController(options) {
      controllerOptions = options;
      return controller;
    },
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
    getAdapterOptions: () => adapterOptions,
    getDialogFailure: () => dialogFailure,
    getControllerOptions: () => controllerOptions,
  };
}

describe("content bootstrap", () => {
  it("passes through the documented initialization interval and cannot report active", () => {
    const h = harness();

    expect(h.content.getStatus()).toEqual({
      state: "initializing",
      application: "chatgpt",
      protectionEnabled: null,
    });
    expect(h.controller.register).not.toHaveBeenCalled();
    expect(h.adapter.interceptor).toBeNull();
    expect(h.firstPort.postMessage).not.toHaveBeenCalled();

    h.firstPort.emitMessage({ type: "settings.snapshot", envelope: {} });
    expect(h.content.getStatus().state).toBe("initializing");
    expect(h.controller.register).not.toHaveBeenCalled();
    expect(h.firstPort.postMessage).not.toHaveBeenCalled();

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

  it("updates atomically, cancels on disable, and reuses idempotent setup", () => {
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
    expect(h.controller.register).toHaveBeenCalledOnce();
    expect(h.controller.cancelActiveAttempt).toHaveBeenCalledOnce();
  });

  it("disposes interception on disconnect and needs a fresh reconnect snapshot", () => {
    const h = harness();
    h.firstPort.emitMessage(settingsSnapshot());
    h.firstPort.emitDisconnect();

    expect(h.controller.cancelActiveAttempt).toHaveBeenCalledOnce();
    expect(h.registrationDispose).toHaveBeenCalledOnce();
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
