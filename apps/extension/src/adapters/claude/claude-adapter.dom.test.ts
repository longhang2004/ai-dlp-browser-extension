import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConsumedSubmissionAuthorization } from "../chat-application-adapter.js";
import {
  CLAUDE_ADAPTER_DESCRIPTOR,
  ClaudeAdapter,
  ClaudeAdapterError,
} from "./claude-adapter.js";
import {
  CLAUDE_DATA_COMPOSER_FIXTURE,
  CLAUDE_SEMANTIC_COMPOSER_FIXTURE,
} from "./fixtures.js";

let currentUrl = new URL("https://claude.ai/");
const adapters: ClaudeAdapter[] = [];

function renderFixture(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
}

function createAdapter(
  options: Omit<
    ConstructorParameters<typeof ClaudeAdapter>[0],
    "document" | "getCurrentUrl"
  > = {},
): ClaudeAdapter {
  const adapter = new ClaudeAdapter({
    document,
    getCurrentUrl: () => new URL(currentUrl.href),
    ...options,
  });
  adapters.push(adapter);
  return adapter;
}

function authorization(
  attemptId = "attempt-1",
): ConsumedSubmissionAuthorization {
  return { attemptId } as ConsumedSubmissionAuthorization;
}

function dispatchEnter(
  target: Element,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

async function flushMutations(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.dispose();
  document.body.replaceChildren();
  currentUrl = new URL("https://claude.ai/");
  vi.restoreAllMocks();
});

describe("ClaudeAdapter descriptor and origin", () => {
  it("exposes a frozen exact-origin candidate descriptor", () => {
    expect(CLAUDE_ADAPTER_DESCRIPTOR).toEqual({
      adapterId: "claude",
      surfaceId: "claude_web",
      version: "1",
      trust: "verified",
      origins: ["https://claude.ai"],
      capabilities: {
        submissionDetection: "verified",
        promptRead: "verified",
        attachmentDetection: "verified",
        attachmentInspection: "unsupported",
        promptReplacement: "unsupported",
        submissionResume: "verified",
      },
      entryPoint: "content-claude.js",
    });
    expect(Object.isFrozen(CLAUDE_ADAPTER_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(CLAUDE_ADAPTER_DESCRIPTOR.origins)).toBe(true);
    expect(Object.isFrozen(CLAUDE_ADAPTER_DESCRIPTOR.capabilities)).toBe(true);
  });

  it("matches only the canonical default-port origin", () => {
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    expect(adapter.matches(new URL("https://claude.ai/"))).toBe(true);
    expect(adapter.matches(new URL("https://claude.ai:443/"))).toBe(true);
    expect(adapter.matches(new URL("https://claude.ai:8443/"))).toBe(false);
    expect(adapter.matches(new URL("https://example.test/"))).toBe(false);
  });
});

describe("ClaudeAdapter submission capture", () => {
  it("captures click and unmodified Enter, but passes through Shift+Enter, modifiers, and IME", () => {
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    const composer = document.querySelector('[role="textbox"]');
    const send = document.querySelector("button");
    expect(composer).toBeInstanceOf(HTMLElement);
    expect(send).toBeInstanceOf(HTMLElement);
    if (!(composer instanceof HTMLElement) || !(send instanceof HTMLElement)) {
      throw new Error("Missing synthetic controls.");
    }
    const attempts: Array<{ source: string; contextIdentity: number }> = [];
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor((attempt) => {
      attempts.push({
        source: attempt.source,
        contextIdentity: attempt.contextIdentity,
      });
      return "intercept";
    });

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    send.dispatchEvent(click);
    const enter = dispatchEnter(composer);
    const shiftEnter = dispatchEnter(composer, { shiftKey: true });
    const ctrlEnter = dispatchEnter(composer, { ctrlKey: true });
    const composing = dispatchEnter(composer, {
      isComposing: true,
      keyCode: 229,
    });

    expect(attempts.map(({ source }) => source)).toEqual(["click", "enter"]);
    expect(click.defaultPrevented).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(ctrlEnter.defaultPrevented).toBe(false);
    expect(composing.defaultPrevented).toBe(false);
  });

  it("handles dynamic rendering and SPA location changes without retaining prompt text", async () => {
    const transitions: unknown[] = [];
    const adapter = createAdapter({
      onHealthTransition: (transition) => transitions.push(transition),
      healthGracePeriodMs: 1,
    });
    adapter.registerSubmitInterceptor(() => "intercept");
    expect(adapter.resolveCurrentSubmissionContext()).toBeNull();
    renderFixture(CLAUDE_DATA_COMPOSER_FIXTURE);
    await flushMutations();
    expect(adapter.resolveCurrentSubmissionContext()).not.toBeNull();
    expect(transitions).toContainEqual({ status: "healthy" });
    currentUrl = new URL("https://claude.ai/new");
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    await flushMutations();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context?.contextVersion).toBe(2);
    expect(adapter.getDiagnosticsForTesting().promptCacheSlots).toBe(0);
  });

  it("uses opaque attachment presence fingerprints and invalidates them on mutations", async () => {
    renderFixture(CLAUDE_DATA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected context.");
    const absent = adapter.inspectSubmissionCapabilities(context);
    expect(absent.attachmentPresent).toBe(false);
    expect(Reflect.ownKeys(absent.attachmentStateFingerprint)).toEqual([]);
    const chip = document.createElement("div");
    chip.setAttribute("data-testid", "attachment-chip");
    context.submissionRegion.append(chip);
    await flushMutations();
    const present = adapter.inspectSubmissionCapabilities(context);
    expect(present.attachmentPresent).toBe(true);
    expect(present.attachmentStateFingerprint).not.toBe(
      absent.attachmentStateFingerprint,
    );
    chip.remove();
    await flushMutations();
    const removed = adapter.inspectSubmissionCapabilities(context);
    expect(removed.attachmentPresent).toBe(false);
    expect(removed.attachmentStateFingerprint).not.toBe(
      present.attachmentStateFingerprint,
    );
    expect(JSON.stringify(removed.attachmentStateFingerprint)).not.toContain(
      "attachment",
    );
  });
});

describe("ClaudeAdapter guarded resume and lifecycle", () => {
  it("keeps prompt replacement unsupported and resumes one synchronous click", () => {
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    const send = document.querySelector("button");
    expect(send).toBeInstanceOf(HTMLElement);
    if (!(send instanceof HTMLElement)) throw new Error("Missing Send.");
    const click = vi.spyOn(send, "click");
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected context.");
    expect(adapter.getPromptReplacementCapability(context)).toBe("unsupported");
    expect(adapter.replacePrompt(context, "[REDACTED]")).toEqual({
      ok: false,
      reason: "unsupported_editor",
    });
    adapter.resumeSubmission(context, authorization());
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("rejects stale contexts and makes disposal idempotent", () => {
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected context.");
    const replacement = document.createElement("div");
    replacement.innerHTML = CLAUDE_DATA_COMPOSER_FIXTURE;
    document.body.replaceChildren(...replacement.firstElementChild!.childNodes);
    expect(() =>
      adapter.resumeSubmission(context, authorization()),
    ).toThrowError(new ClaudeAdapterError("resume_context_invalid"));
    adapter.dispose();
    adapter.dispose();
    expect(adapter.getDiagnosticsForTesting()).toEqual({
      disposed: true,
      promptCacheSlots: 0,
      retainsDocument: false,
      retainsUrlReader: false,
      retainsHealthReporter: false,
      retainsErrorReporter: false,
      retainsComposerIdentity: false,
      retainsInterceptor: false,
      retainsDisposer: false,
      retainsObserver: false,
      retainsHealthTimer: false,
      resumeInProgress: false,
    });
  });

  it("reports fixed health degradation for ambiguous ownership", async () => {
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    const transitions: unknown[] = [];
    const adapter = createAdapter({
      onHealthTransition: (transition) => transitions.push(transition),
    });
    adapter.registerSubmitInterceptor(() => "intercept");
    renderFixture(`
      <section data-testid="chat-composer">
        <div role="textbox" contenteditable="true" aria-label="Message Claude"></div>
        <div role="textbox" contenteditable="true" aria-label="Message Claude"></div>
        <button data-testid="send-button" aria-label="Send message">Send</button>
      </section>
    `);
    await flushMutations();
    expect(transitions).toContainEqual({
      status: "degraded",
      healthCode: "ambiguous_submission_context",
    });
  });
});
