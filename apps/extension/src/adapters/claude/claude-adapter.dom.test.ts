import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConsumedSubmissionAuthorization } from "../chat-application-adapter.js";
import {
  CLAUDE_ADAPTER_DESCRIPTOR,
  ClaudeAdapter,
  ClaudeAdapterError,
} from "./claude-adapter.js";
import {
  CLAUDE_DATA_COMPOSER_FIXTURE,
  CLAUDE_NATIVE_BUTTON_SUBMIT_FIXTURE,
  CLAUDE_NATIVE_INPUT_SUBMIT_FIXTURE,
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

async function updateTextNode(node: Text, value: string): Promise<void> {
  node.data = value;
  await flushMutations();
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
  it.each([
    ["button", CLAUDE_NATIVE_BUTTON_SUBMIT_FIXTURE, "#native-button-submit"],
    ["input", CLAUDE_NATIVE_INPUT_SUBMIT_FIXTURE, "#native-input-submit"],
  ])(
    "intercepts a direct native %s submit click for its owned composer",
    (_kind, fixture, sendSelector) => {
      renderFixture(fixture);
      const adapter = createAdapter();
      const handler = vi.fn(() => "intercept" as const);
      adapter.registerSubmitInterceptor(handler);
      const context = adapter.resolveCurrentSubmissionContext();
      const send = document.querySelector(sendSelector);
      expect(context).not.toBeNull();
      expect(send).toBeInstanceOf(HTMLElement);
      if (context === null || !(send instanceof HTMLElement)) {
        throw new Error("Missing native submit interception fixture.");
      }

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      send.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
      expect(handler).toHaveBeenCalledWith({
        id: "claude-submit-1",
        source: "click",
        contextIdentity: context.contextIdentity,
        initialContextVersion: context.contextVersion,
      });
    },
  );

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

  it("tracks every attachment mutation class only inside the owned region", async () => {
    const promptBefore = "claude-prompt-private-before";
    const promptAfter = "claude-prompt-private-after";
    const attachmentBefore = "claude-attachment-private-before";
    const attachmentAfter = "claude-attachment-private-after";
    const outsideBefore = "claude-outside-private-before";
    const outsideAfter = "claude-outside-private-after";
    renderFixture(`
      <div data-testid="attachment-chip" id="outside-evidence">${outsideBefore}</div>
      <section data-testid="chat-composer" id="attachment-region">
        <textarea data-testid="chat-input" aria-label="Message Claude" id="prompt">${promptBefore}</textarea>
        <div id="unrelated">unrelated-before</div>
        <button type="button" data-testid="send-button" aria-label="Send">Send</button>
      </section>
    `);
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor(() => "intercept");
    const context = adapter.resolveCurrentSubmissionContext();
    const prompt = document.querySelector("#prompt")?.firstChild;
    const outside = document.querySelector("#outside-evidence")?.firstChild;
    const unrelated = document.querySelector("#unrelated")?.firstChild;
    if (
      context === null ||
      !(prompt instanceof Text) ||
      !(outside instanceof Text) ||
      !(unrelated instanceof Text)
    ) {
      throw new Error("Expected attachment lifecycle fixture.");
    }

    const absent = adapter.inspectSubmissionCapabilities(context);
    expect(absent.attachmentPresent).toBe(false);
    const unchanged = adapter.inspectSubmissionCapabilities(context);
    expect(unchanged.attachmentStateFingerprint).toBe(
      absent.attachmentStateFingerprint,
    );

    const evidence = document.createElement("div");
    evidence.dataset.testid = "attachment-chip";
    const directText = document.createTextNode(attachmentBefore);
    const nestedText = document.createTextNode("nested-before");
    const nested = document.createElement("span");
    nested.append(nestedText);
    evidence.append(directText, nested);
    context.submissionRegion.prepend(evidence);
    await flushMutations();
    const added = adapter.inspectSubmissionCapabilities(context);
    expect(added.attachmentPresent).toBe(true);
    expect(added.attachmentStateFingerprint).not.toBe(
      absent.attachmentStateFingerprint,
    );

    evidence.setAttribute("data-state", "opaque-private-state");
    await flushMutations();
    const attributeChanged = adapter.inspectSubmissionCapabilities(context);
    expect(attributeChanged.attachmentStateFingerprint).not.toBe(
      added.attachmentStateFingerprint,
    );

    await updateTextNode(directText, attachmentAfter);
    const directTextChanged = adapter.inspectSubmissionCapabilities(context);
    expect(directTextChanged.attachmentStateFingerprint).not.toBe(
      attributeChanged.attachmentStateFingerprint,
    );

    await updateTextNode(nestedText, "nested-after");
    const nestedTextChanged = adapter.inspectSubmissionCapabilities(context);
    expect(nestedTextChanged.attachmentStateFingerprint).not.toBe(
      directTextChanged.attachmentStateFingerprint,
    );

    await updateTextNode(prompt, promptAfter);
    await updateTextNode(unrelated, "unrelated-after");
    const afterUnrelated = adapter.inspectSubmissionCapabilities(context);
    expect(afterUnrelated.attachmentStateFingerprint).toBe(
      nestedTextChanged.attachmentStateFingerprint,
    );

    await updateTextNode(outside, outsideAfter);
    const afterOutside = adapter.inspectSubmissionCapabilities(context);
    expect(afterOutside.attachmentStateFingerprint).toBe(
      afterUnrelated.attachmentStateFingerprint,
    );

    const replacement = evidence.cloneNode(true);
    evidence.replaceWith(replacement);
    await flushMutations();
    const replaced = adapter.inspectSubmissionCapabilities(context);
    expect(replaced.attachmentPresent).toBe(true);
    expect(replaced.attachmentStateFingerprint).not.toBe(
      afterOutside.attachmentStateFingerprint,
    );

    if (!(replacement instanceof Element)) {
      throw new Error("Expected replacement attachment element.");
    }
    replacement.remove();
    await flushMutations();
    const removed = adapter.inspectSubmissionCapabilities(context);
    expect(removed.attachmentPresent).toBe(false);
    expect(removed.attachmentStateFingerprint).not.toBe(
      replaced.attachmentStateFingerprint,
    );
    expect(Reflect.ownKeys(removed.attachmentStateFingerprint)).toEqual([]);

    const serializedBoundary = JSON.stringify({
      diagnostics: adapter.getDiagnosticsForTesting(),
      fingerprints: [
        absent.attachmentStateFingerprint,
        added.attachmentStateFingerprint,
        attributeChanged.attachmentStateFingerprint,
        directTextChanged.attachmentStateFingerprint,
        nestedTextChanged.attachmentStateFingerprint,
        afterUnrelated.attachmentStateFingerprint,
        afterOutside.attachmentStateFingerprint,
        replaced.attachmentStateFingerprint,
        removed.attachmentStateFingerprint,
      ],
    });
    for (const value of [
      promptBefore,
      promptAfter,
      attachmentBefore,
      attachmentAfter,
      outsideBefore,
      outsideAfter,
    ]) {
      expect(serializedBoundary).not.toContain(value);
    }
  });

  it("disconnects the scoped attachment observer on unregister and dispose", async () => {
    renderFixture(CLAUDE_DATA_COMPOSER_FIXTURE);
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const adapter = createAdapter();
    const dispose = adapter.registerSubmitInterceptor(() => "intercept");
    expect(observe).toHaveBeenCalled();
    expect(adapter.getDiagnosticsForTesting().retainsObserver).toBe(true);

    const context = adapter.resolveCurrentSubmissionContext();
    if (context === null) throw new Error("Expected context.");
    adapter.inspectSubmissionCapabilities(context);
    const evidence = document.createElement("div");
    evidence.dataset.testid = "attachment-chip";
    context.submissionRegion.append(evidence);
    await flushMutations();

    dispose();
    expect(disconnect).toHaveBeenCalled();
    expect(adapter.getDiagnosticsForTesting()).toMatchObject({
      retainsObserver: false,
      retainsInterceptor: false,
      retainsDisposer: false,
      retainsHealthTimer: false,
    });

    const observeCallsAfterUnregister = observe.mock.calls.length;
    evidence.setAttribute("data-state", "after-unregister");
    await flushMutations();
    expect(observe).toHaveBeenCalledTimes(observeCallsAfterUnregister);

    adapter.dispose();
    expect(adapter.getDiagnosticsForTesting()).toMatchObject({
      disposed: true,
      retainsDocument: false,
      retainsObserver: false,
    });
  });

  it("observes only the exact submission region for attachment mutations", () => {
    renderFixture(CLAUDE_DATA_COMPOSER_FIXTURE);
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor(() => "intercept");
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected context.");

    adapter.inspectSubmissionCapabilities(context);

    const regionCalls = observe.mock.calls.filter(
      ([target]) => target === context.submissionRegion,
    );
    expect(regionCalls).toHaveLength(1);
    expect(regionCalls[0]?.[1]).toEqual({
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    const documentCalls = observe.mock.calls.filter(
      ([target]) => target === document || target === document.documentElement,
    );
    expect(documentCalls.length).toBeGreaterThan(0);
    expect(
      documentCalls.every(([, options]) =>
        Array.isArray((options as MutationObserverInit).attributeFilter),
      ),
    ).toBe(true);
    expect(
      documentCalls.some(
        ([, options]) =>
          !Array.isArray((options as MutationObserverInit).attributeFilter),
      ),
    ).toBe(false);
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
