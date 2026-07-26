import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ConsumedSubmissionAuthorization,
  LiveSubmissionContext,
} from "../chat-application-adapter.js";
import {
  ChatGptAdapter,
  ChatGptAdapterError,
  type AdapterHealthTransition,
} from "./chatgpt-adapter.js";
import {
  CONTENTEDITABLE_COMPOSER_FIXTURE,
  MULTI_COMPOSER_FIXTURE,
  NATIVE_TEXTAREA_COMPOSER_FIXTURE,
  PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE,
  REVIEWER_MULTI_COMPOSER_FIXTURE,
} from "./fixtures.js";

const CHATGPT_URL = new URL("https://chatgpt.com/");
const createdAdapters: ChatGptAdapter[] = [];

function createAdapter(
  options: Omit<
    ConstructorParameters<typeof ChatGptAdapter>[0],
    "document"
  > = {},
): ChatGptAdapter {
  const adapter = new ChatGptAdapter({
    document,
    getCurrentUrl: () => new URL(CHATGPT_URL.href),
    ...options,
  });
  createdAdapters.push(adapter);
  return adapter;
}

function renderFixture(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
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

afterEach(() => {
  for (const adapter of createdAdapters.splice(0)) {
    adapter.dispose();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ChatGptAdapter prompt operations", () => {
  it("does not treat direct ProseMirror DOM mutation as acknowledged editor state", () => {
    renderFixture(PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE);
    const composer = document.querySelector("#prompt-textarea");
    expect(composer).toBeInstanceOf(HTMLElement);
    if (!(composer instanceof HTMLElement)) throw new Error("Missing editor.");
    const editorModel = "Example prompt";
    composer.addEventListener("input", () => {
      // A ProseMirror-like model intentionally ignores foreign DOM mutation.
      composer.textContent = editorModel;
    });
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected context.");
    const replacementAdapter = adapter as unknown as {
      getPromptReplacementCapability(
        value: LiveSubmissionContext,
      ): "supported" | "unsupported";
      replacePrompt(
        value: LiveSubmissionContext,
        text: string,
      ): { ok: boolean };
    };

    expect(replacementAdapter.getPromptReplacementCapability(context)).toBe(
      "unsupported",
    );
    expect(replacementAdapter.replacePrompt(context, "[EMAIL]")).toEqual({
      ok: false,
      reason: "unsupported_editor",
    });
    expect(editorModel).toBe("Example prompt");
    expect(adapter.readPrompt(context)).toBe("Example prompt");
  });

  it("does not treat native textarea DOM value replacement as application-state proof", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected context.");
    const original = adapter.readPrompt(context);

    expect(adapter.getPromptReplacementCapability(context)).toBe("unsupported");
    expect(adapter.replacePrompt(context, "[EMAIL]")).toEqual({
      ok: false,
      reason: "unsupported_editor",
    });
    expect(adapter.readPrompt(context)).toBe(original);
  });

  it("reports every current ChatGPT editor variant as replacement unsupported", () => {
    for (const fixture of [
      NATIVE_TEXTAREA_COMPOSER_FIXTURE,
      CONTENTEDITABLE_COMPOSER_FIXTURE,
      PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE,
    ]) {
      renderFixture(fixture);
      const adapter = createAdapter();
      const context = adapter.resolveCurrentSubmissionContext();
      if (context === null) throw new Error("Expected context.");

      expect(adapter.getPromptReplacementCapability(context)).toBe(
        "unsupported",
      );
    }
  });

  it("detects only composer-scoped attachment evidence, not upload capability", () => {
    renderFixture(`
      <div data-testid="composer-attachment" id="outside">outside</div>
      <form aria-label="Chat composer">
        <textarea></textarea>
        <input type="file" />
        <div data-testid="composer-attachment" id="inside">
          <button aria-label="Remove attachment">Remove</button>
        </div>
        <button type="submit">Send</button>
      </form>
    `);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected context.");
    const inspect = (
      adapter as unknown as {
        inspectSubmissionCapabilities(value: LiveSubmissionContext): {
          hasUnsupportedAttachment: boolean;
        };
      }
    ).inspectSubmissionCapabilities;

    expect(inspect.call(adapter, context)).toEqual({
      hasUnsupportedAttachment: true,
    });
    document.querySelector("#inside")?.remove();
    expect(inspect.call(adapter, context)).toEqual({
      hasUnsupportedAttachment: false,
    });
  });

  it("detects an attachment sibling outside the nearest composer form", () => {
    renderFixture(`
      <section data-testid="composer-root">
        <div data-testid="composer-attachment">
          <button aria-label="Remove attachment">Remove</button>
        </div>
        <form>
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
          <button data-testid="send-button" aria-label="Send prompt">Send</button>
        </form>
      </section>
    `);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    if (context === null) throw new Error("Expected submission context.");

    expect(adapter.inspectSubmissionCapabilities(context)).toEqual({
      hasUnsupportedAttachment: true,
    });
  });

  it("detects ChatGPT attachment removal controls with dynamic labels", () => {
    renderFixture(`
      <form>
        <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
        <button aria-label="Remove file 1: pasted-content.txt" type="button">
          Remove
        </button>
        <button data-testid="send-button" aria-label="Send prompt">Send</button>
      </form>
    `);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    if (context === null) throw new Error("Expected submission context.");

    expect(adapter.inspectSubmissionCapabilities(context)).toEqual({
      hasUnsupportedAttachment: true,
    });
  });

  it.each(["before", "after"] as const)(
    "detects multiple attachment chips %s the form in the owned root",
    (position) => {
      const attachments = `
        <div data-testid="composer-attachment"></div>
        <div data-testid="attachment-chip"></div>
      `;
      const form = `
        <form>
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
          <input type="file" />
          <button data-testid="send-button" aria-label="Send prompt">Send</button>
        </form>
      `;
      renderFixture(`
        <section data-testid="composer-root">
          ${position === "before" ? attachments : ""}
          ${form}
          ${position === "after" ? attachments : ""}
        </section>
      `);
      const adapter = createAdapter();
      const context = adapter.resolveCurrentSubmissionContext();
      if (context === null) throw new Error("Expected submission context.");

      expect(context.submissionRegion).toBe(
        document.querySelector('[data-testid="composer-root"]'),
      );
      expect(adapter.inspectSubmissionCapabilities(context)).toEqual({
        hasUnsupportedAttachment: true,
      });
    },
  );

  it("scans only the exact event-targeted composer attachment region", () => {
    renderFixture(`
      <section data-testid="composer-root" id="composer-a">
        <div data-testid="composer-attachment"></div>
        <div contenteditable="true" role="textbox" aria-label="Message ChatGPT"></div>
        <button data-testid="send-button" aria-label="Send prompt">Send A</button>
      </section>
      <section data-testid="composer-root" id="composer-b">
        <form>
          <div id="prompt-b" contenteditable="true" role="textbox" aria-label="Message ChatGPT"></div>
          <input type="file" />
          <button data-testid="send-button" aria-label="Send prompt">Send B</button>
        </form>
      </section>
    `);
    const adapter = createAdapter();
    let capturedIdentity = 0;
    adapter.registerSubmitInterceptor((attempt) => {
      capturedIdentity = attempt.contextIdentity;
      return "intercept";
    });
    const composerB = document.querySelector("#prompt-b");
    if (composerB === null) throw new Error("Missing composer B.");

    dispatchEnter(composerB);
    const contextB = adapter.resolveSubmissionContext(capturedIdentity);
    if (contextB === null) throw new Error("Expected composer B context.");

    expect(contextB.submissionRegion).toBe(
      document.querySelector("#composer-b"),
    );
    expect(adapter.inspectSubmissionCapabilities(contextB)).toEqual({
      hasUnsupportedAttachment: false,
    });
    contextB.submissionRegion.insertAdjacentHTML(
      "afterbegin",
      '<div data-testid="file-preview"></div>',
    );
    expect(adapter.inspectSubmissionCapabilities(contextB)).toEqual({
      hasUnsupportedAttachment: true,
    });
  });

  it("fails closed when attachment ownership cannot be bounded to one region", () => {
    renderFixture(`
      <section data-testid="composer-root">
        <form id="chat-form">
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
        </form>
      </section>
      <button
        form="chat-form"
        data-testid="send-button"
        aria-label="Send prompt"
      >Send outside</button>
    `);
    const adapter = createAdapter();
    const attempts: unknown[] = [];
    adapter.registerSubmitInterceptor((attempt) => {
      attempts.push(attempt);
      return "intercept";
    });
    const composer = document.querySelector("#prompt-textarea");
    if (composer === null) throw new Error("Missing composer.");

    const enter = dispatchEnter(composer);

    expect(enter.defaultPrevented).toBe(true);
    expect(attempts).toEqual([
      expect.objectContaining({ contextIdentity: 0, source: "enter" }),
    ]);
  });

  it("reads structured text from the production prompt-textarea", () => {
    renderFixture(PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();

    expect(context?.composer).toBe(document.querySelector("#prompt-textarea"));
    expect(context && adapter.readPrompt(context)).toBe("Example prompt");
  });

  it("reads a native textarea prompt without retaining it", () => {
    const markup = NATIVE_TEXTAREA_COMPOSER_FIXTURE;
    renderFixture(markup);
    const textarea = document.querySelector("textarea");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Expected textarea.");
    }
    const prompt = "private composer sentinel";
    textarea.value = prompt;
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected a submission context.");
    }

    expect(adapter.readPrompt(context)).toBe(prompt);

    expect(adapter.getDiagnosticsForTesting()).toMatchObject({
      disposed: false,
      promptCacheSlots: 0,
    });
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

  it("reads structured contenteditable DOM as exact multiline plain text", () => {
    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);
    const composer = document.querySelector('[role="textbox"]');
    expect(composer).toBeInstanceOf(HTMLElement);
    if (!(composer instanceof HTMLElement)) {
      throw new Error("Expected contenteditable fixture.");
    }
    const first = document.createElement("p");
    first.textContent = "first line";
    const second = document.createElement("div");
    second.append("second line", document.createElement("br"), "continued");
    const third = document.createElement("p");
    third.textContent = "third line";
    composer.replaceChildren(first, second, third);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected context.");
    }

    expect(adapter.readPrompt(context)).toBe(
      "first line\nsecond line\ncontinued\nthird line",
    );
    expect(adapter.getDiagnosticsForTesting().promptCacheSlots).toBe(0);
  });

  it("matches only the exact secure ChatGPT origin", () => {
    const adapter = createAdapter();
    expect(adapter.matches(new URL("https://chatgpt.com/"))).toBe(true);
    expect(adapter.matches(new URL("https://chatgpt.com/c/one"))).toBe(true);
    expect(adapter.matches(new URL("http://chatgpt.com/"))).toBe(false);
    expect(adapter.matches(new URL("https://evil.chatgpt.com/"))).toBe(false);
  });
});

describe("ChatGptAdapter interception", () => {
  it("anchors Enter and Send interception to the second same-priority composer", () => {
    renderFixture(MULTI_COMPOSER_FIXTURE);
    const attempts: unknown[] = [];
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor((attempt) => {
      attempts.push(attempt);
      return "intercept";
    });
    const composerB = document.querySelector("#prompt-b");
    const sendB = document.querySelector("#composer-b button");
    expect(composerB).not.toBeNull();
    expect(sendB).not.toBeNull();
    if (composerB === null || sendB === null) {
      throw new Error("Missing second composer fixture.");
    }

    const enter = dispatchEnter(composerB);
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    sendB.dispatchEvent(click);

    expect(enter.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(attempts).toHaveLength(2);
  });

  it("anchors events to reviewer-shaped composer B regardless of selector priority", () => {
    renderFixture(REVIEWER_MULTI_COMPOSER_FIXTURE);
    const attempts: unknown[] = [];
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor((attempt) => {
      attempts.push(attempt);
      return "intercept";
    });
    const composerB = document.querySelector("#prompt-textarea");
    const sendB = document.querySelector("#composer-b button");
    if (composerB === null || sendB === null) {
      throw new Error("Missing reviewer multi-composer fixture.");
    }

    const enter = dispatchEnter(composerB);
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    sendB.dispatchEvent(click);

    expect(enter.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(attempts).toHaveLength(2);
  });

  it("fails closed for unresolved composer B even while composer A is valid", () => {
    renderFixture(`
      <section data-testid="composer-root" id="composer-a">
        <div contenteditable="true" role="textbox" aria-label="Message ChatGPT"></div>
        <button data-testid="send-button" aria-label="Send prompt">Send A</button>
      </section>
      <section data-testid="composer-root" id="composer-b">
        <div id="prompt-b" contenteditable="true" role="textbox" aria-label="Message ChatGPT"></div>
      </section>
    `);
    const transitions: AdapterHealthTransition[] = [];
    const adapter = createAdapter({
      healthGracePeriodMs: 1_000,
      onHealthTransition: (transition) => transitions.push(transition),
    });
    const attempts: unknown[] = [];
    adapter.registerSubmitInterceptor((attempt) => {
      attempts.push(attempt);
      return "intercept";
    });
    const composerB = document.querySelector("#prompt-b");
    if (composerB === null) throw new Error("Missing composer B.");

    const enter = dispatchEnter(composerB);

    expect(enter.defaultPrevented).toBe(true);
    expect(attempts).toEqual([
      expect.objectContaining({ source: "enter", contextIdentity: 0 }),
    ]);
    expect(transitions).toContainEqual({
      status: "degraded",
      healthCode: "send_control_not_found",
    });
  });

  it("fails closed for unresolved Send B even while composer A is valid", () => {
    renderFixture(`
      <section data-testid="composer-root" id="composer-a">
        <div contenteditable="true" role="textbox" aria-label="Message ChatGPT"></div>
        <button data-testid="send-button" aria-label="Send prompt">Send A</button>
      </section>
      <section data-testid="composer-root" id="composer-b">
        <button id="send-b" data-testid="send-button" aria-label="Send prompt">Send B</button>
      </section>
    `);
    const adapter = createAdapter();
    const attempts: unknown[] = [];
    adapter.registerSubmitInterceptor((attempt) => {
      attempts.push(attempt);
      return "intercept";
    });
    const sendB = document.querySelector("#send-b");
    if (sendB === null) throw new Error("Missing Send B.");
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    sendB.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(attempts).toEqual([
      expect.objectContaining({ source: "click", contextIdentity: 0 }),
    ]);
  });

  it("intercepts production prompt-textarea Enter and Send but ignores tools", () => {
    renderFixture(PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE);
    const handler = vi.fn(() => "intercept" as const);
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor(handler);
    const composer = document.querySelector("#prompt-textarea");
    const send = document.querySelector('[data-testid="send-button"]');
    const tools = document.querySelector('[aria-label="Open tools"]');
    expect(composer).not.toBeNull();
    expect(send).not.toBeNull();
    expect(tools).not.toBeNull();
    if (composer === null || send === null || tools === null) {
      throw new Error("Missing production-shaped composer fixture.");
    }

    const enter = dispatchEnter(composer);
    const shiftEnter = dispatchEnter(composer, { shiftKey: true });
    const composingEnter = dispatchEnter(composer, { isComposing: true });
    const sendClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    send.dispatchEvent(sendClick);
    const toolsClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    tools.dispatchEvent(toolsClick);

    expect(enter.defaultPrevented).toBe(true);
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(sendClick.defaultPrevented).toBe(true);
    expect(toolsClick.defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("fails closed on a known prompt-textarea whose send control is unresolved", () => {
    renderFixture(`
      <form aria-label="Chat composer">
        <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
      </form>
    `);
    const handler = vi.fn(() => "intercept" as const);
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor(handler);
    const composer = document.querySelector("#prompt-textarea");
    expect(composer).not.toBeNull();
    if (composer === null) throw new Error("Missing composer.");

    const enter = dispatchEnter(composer);

    expect(enter.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("captures associated clicks and Enter once, with metadata only", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const attempts: unknown[] = [];
    adapter.registerSubmitInterceptor((attempt) => {
      attempts.push(attempt);
      return "intercept";
    });
    const textarea = document.querySelector("textarea");
    const send = document.querySelector("button");
    expect(textarea).not.toBeNull();
    expect(send).not.toBeNull();
    if (textarea === null || send === null) {
      throw new Error("Missing fixture controls.");
    }

    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    send.querySelector("span")?.dispatchEvent(click);
    const enter = dispatchEnter(textarea);

    expect(click.defaultPrevented).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
    expect(attempts).toEqual([
      {
        id: "chatgpt-submit-1",
        source: "click",
        contextIdentity: 1,
        initialContextVersion: 1,
      },
      {
        id: "chatgpt-submit-2",
        source: "enter",
        contextIdentity: 1,
        initialContextVersion: 1,
      },
    ]);
  });

  it("passes through disabled-protection dispositions and non-submit keys", () => {
    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const handler = vi.fn(() => "pass_through" as const);
    adapter.registerSubmitInterceptor(handler);
    const textarea = document.querySelector('[role="textbox"]');
    const send = document.querySelector("button");
    expect(textarea).not.toBeNull();
    expect(send).not.toBeNull();
    if (textarea === null || send === null) {
      throw new Error("Missing fixture controls.");
    }
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    send.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);

    for (const init of [
      { shiftKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
    ]) {
      expect(dispatchEnter(textarea, init).defaultPrevented).toBe(false);
    }
    const legacyImeEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(legacyImeEnter, "keyCode", { value: 229 });
    textarea.dispatchEvent(legacyImeEnter);
    expect(legacyImeEnter.defaultPrevented).toBe(false);
    const outside = document.createElement("input");
    document.body.append(outside);
    expect(dispatchEnter(outside).defaultPrevented).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fails closed with a fixed prompt-free error when the interceptor throws", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const errors: ChatGptAdapterError[] = [];
    const adapter = createAdapter({
      onAdapterError: (error) => errors.push(error),
    });
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected context.");
    }
    adapter.replacePrompt(context, "handler failure prompt sentinel");
    adapter.registerSubmitInterceptor(() => {
      throw new Error("handler failure prompt sentinel");
    });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    context.sendControl.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "interceptor_failure" });
    expect(String(errors[0])).not.toContain("handler failure prompt sentinel");
  });

  it("intercepts an implicit submit in a known degraded composer form", () => {
    renderFixture(`
      <form aria-label="Chat composer">
        <textarea readonly></textarea>
        <button aria-label="Send prompt"><span>Send</span></button>
      </form>
    `);
    const handler = vi.fn(() => "intercept" as const);
    const adapter = createAdapter();
    adapter.registerSubmitInterceptor(handler);
    const sendIcon = document.querySelector("button span");
    expect(sendIcon).not.toBeNull();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    sendIcon?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledWith({
      id: "chatgpt-submit-1",
      source: "click",
      contextIdentity: 0,
      initialContextVersion: 0,
    });
  });

  it("recovers from delayed rendering and intercepts the newly available composer", async () => {
    vi.useFakeTimers();
    const transitions: AdapterHealthTransition[] = [];
    const handler = vi.fn(() => "intercept" as const);
    const adapter = createAdapter({
      healthGracePeriodMs: 1_000,
      onHealthTransition: (transition) => transitions.push(transition),
    });
    adapter.registerSubmitInterceptor(handler);
    expect(transitions).toEqual([{ status: "waiting_for_composer" }]);

    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    const send = document.querySelector("button");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    send?.dispatchEvent(click);

    expect(transitions).toContainEqual({ status: "healthy" });
    expect(click.defaultPrevented).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("uses the full ten-second default grace before one coalesced degradation", async () => {
    vi.useFakeTimers();
    const transitions: AdapterHealthTransition[] = [];
    const adapter = createAdapter({
      onHealthTransition: (transition) => transitions.push(transition),
    });
    adapter.registerSubmitInterceptor(() => "intercept");

    expect(transitions).toEqual([{ status: "waiting_for_composer" }]);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(transitions).toEqual([{ status: "waiting_for_composer" }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(transitions).toEqual([
      { status: "waiting_for_composer" },
      { status: "degraded", healthCode: "composer_not_found" },
    ]);
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      transitions.filter((transition) => transition.status === "degraded"),
    ).toHaveLength(1);
  });

  it("restarts the waiting lifecycle after SPA navigation without stale degradation", async () => {
    vi.useFakeTimers();
    let currentUrl = new URL("https://chatgpt.com/c/one");
    const transitions: AdapterHealthTransition[] = [];
    const adapter = createAdapter({
      getCurrentUrl: () => new URL(currentUrl.href),
      onHealthTransition: (transition) => transitions.push(transition),
    });
    adapter.registerSubmitInterceptor(() => "intercept");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transitions.at(-1)).toEqual({
      status: "degraded",
      healthCode: "composer_not_found",
    });

    currentUrl = new URL("https://chatgpt.com/c/two");
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    await Promise.resolve();

    expect(transitions.at(-1)).toEqual({ status: "waiting_for_composer" });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(transitions.at(-1)).toEqual({ status: "waiting_for_composer" });

    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);
    await Promise.resolve();
    await Promise.resolve();
    expect(transitions.at(-1)).toEqual({ status: "healthy" });
  });

  it("does not install duplicate listeners and disposes all interception", () => {
    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const handler = vi.fn(() => "intercept" as const);
    const disposeA = adapter.registerSubmitInterceptor(handler);
    const disposeB = adapter.registerSubmitInterceptor(handler);
    const send = document.querySelector("button");
    expect(send).not.toBeNull();
    send?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(handler).toHaveBeenCalledTimes(1);

    adapter.dispose();
    disposeB();
    disposeA();
    send?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("ChatGptAdapter dynamic context and resume", () => {
  it("changes weak context identity for composer replacement but not send replacement", async () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const first = adapter.resolveCurrentSubmissionContext();
    expect(first?.contextVersion).toBe(1);
    expect(first?.contextIdentity).toBe(1);

    const send = document.querySelector("button");
    const replacementSend = send?.cloneNode(true);
    send?.replaceWith(replacementSend ?? document.createElement("button"));
    await Promise.resolve();
    const second = adapter.resolveCurrentSubmissionContext();
    expect(second?.sendControl).not.toBe(first?.sendControl);
    expect(second?.contextVersion).toBe(1);
    expect(second?.contextIdentity).toBe(first?.contextIdentity);

    const textarea = document.querySelector("textarea");
    const replacementComposer = textarea?.cloneNode(true);
    textarea?.replaceWith(
      replacementComposer ?? document.createElement("textarea"),
    );
    await Promise.resolve();
    const third = adapter.resolveCurrentSubmissionContext();
    expect(third?.contextVersion).toBe(1);
    expect(third?.contextIdentity).not.toBe(first?.contextIdentity);
  });

  it("increments context version when SPA navigation changes the application location", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    let currentUrl = new URL("https://chatgpt.com/c/one");
    const adapter = createAdapter({
      getCurrentUrl: () => new URL(currentUrl.href),
    });
    expect(adapter.resolveCurrentSubmissionContext()?.contextVersion).toBe(1);

    currentUrl = new URL("https://chatgpt.com/c/two");
    expect(adapter.resolveCurrentSubmissionContext()?.contextVersion).toBe(2);
  });

  it("resumes with one guarded click and always clears the guard after errors", () => {
    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const handler = vi.fn(() => "intercept" as const);
    adapter.registerSubmitInterceptor(handler);
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected context.");
    }
    const clickSpy = vi
      .spyOn(context.sendControl, "click")
      .mockImplementationOnce(() => {
        context.sendControl.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        throw new Error("page listener failed");
      });

    expect(() =>
      adapter.resumeSubmission(context, authorization()),
    ).toThrowError(ChatGptAdapterError);
    expect(handler).not.toHaveBeenCalled();

    clickSpy.mockImplementationOnce(() => {
      context.sendControl.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(() =>
      adapter.resumeSubmission(context, authorization("attempt-2")),
    ).not.toThrow();
    expect(clickSpy).toHaveBeenCalledTimes(2);

    context.sendControl.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects disconnected, disabled, or unassociated resume contexts with fixed content-free errors", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected context.");
    }
    adapter.replacePrompt(context, "composer secret sentinel");
    context.sendControl.remove();

    let thrown: unknown;
    try {
      adapter.resumeSubmission(context, authorization());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ChatGptAdapterError);
    expect(thrown).toMatchObject({ code: "resume_context_invalid" });
    expect(String(thrown)).not.toContain("composer secret sentinel");
  });

  it.each([
    [
      "disabled",
      (context: LiveSubmissionContext) => {
        if (!(context.sendControl instanceof HTMLButtonElement)) {
          throw new Error("Expected a button.");
        }
        context.sendControl.disabled = true;
      },
    ],
    [
      "unassociated",
      (context: LiveSubmissionContext) => {
        document.body.append(context.sendControl);
      },
    ],
  ])("rejects a %s send control", (_case, invalidate) => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected context.");
    }
    invalidate(context);

    expect(() =>
      adapter.resumeSubmission(context, authorization()),
    ).toThrowError(expect.objectContaining({ code: "resume_context_invalid" }));
  });

  it("uses fixed prompt-free errors when a selector context becomes stale", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected context.");
    }
    adapter.replacePrompt(context, "selector error sentinel");
    context.composer.remove();

    let thrown: unknown;
    try {
      adapter.readPrompt(context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: "prompt_context_invalid" });
    expect(String(thrown)).not.toContain("selector error sentinel");
  });

  it("keeps a connected exact-identity context valid when another composer appears first", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const adapter = createAdapter();
    const stale = adapter.resolveCurrentSubmissionContext();
    expect(stale).not.toBeNull();
    if (stale === null) {
      throw new Error("Expected context.");
    }
    const staleForm = stale.composer.closest("form");
    expect(staleForm).not.toBeNull();
    renderFixture(
      `${NATIVE_TEXTAREA_COMPOSER_FIXTURE}<aside id="stale"></aside>`,
    );
    document.querySelector("#stale")?.append(staleForm as HTMLFormElement);
    expect(stale.composer.isConnected).toBe(true);

    expect(adapter.readPrompt(stale)).toBe("");
    expect(
      adapter.resolveSubmissionContext(stale.contextIdentity),
    ).toMatchObject({
      composer: stale.composer,
      contextIdentity: stale.contextIdentity,
    });
  });
});

describe("ChatGptAdapter health privacy", () => {
  it("reports prompt-free fixed health transitions and coalesces degradation", async () => {
    vi.useFakeTimers();
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const transitions: AdapterHealthTransition[] = [];
    const adapter = createAdapter({
      healthGracePeriodMs: 1_000,
      onHealthTransition: (transition) => transitions.push(transition),
    });
    const context = adapter.resolveCurrentSubmissionContext();
    expect(context).not.toBeNull();
    if (context === null) {
      throw new Error("Expected context.");
    }
    adapter.replacePrompt(context, "health prompt sentinel");
    adapter.registerSubmitInterceptor(() => "intercept");
    context.composer.remove();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(transitions).toContainEqual({
      status: "degraded",
      healthCode: "composer_not_found",
    });
    expect(JSON.stringify(transitions)).not.toContain("health prompt sentinel");
  });

  it("rechecks health for style and class-based visibility changes without class selectors", async () => {
    vi.useFakeTimers();
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const transitions: AdapterHealthTransition[] = [];
    const adapter = createAdapter({
      healthGracePeriodMs: 1_000,
      onHealthTransition: (transition) => transitions.push(transition),
    });
    adapter.registerSubmitInterceptor(() => "intercept");
    const composer = document.querySelector("textarea");
    expect(composer).toBeInstanceOf(HTMLTextAreaElement);
    if (!(composer instanceof HTMLTextAreaElement)) {
      throw new Error("Expected textarea.");
    }

    composer.style.display = "none";
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transitions.at(-1)).toEqual({
      status: "degraded",
      healthCode: "unsupported_dom_variant",
    });

    const style = document.createElement("style");
    style.textContent = ".fixture-hidden { display: none; }";
    document.head.append(style);
    composer.style.removeProperty("display");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transitions.at(-1)).toEqual({ status: "healthy" });

    composer.className = "fixture-hidden";
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transitions.at(-1)).toEqual({
      status: "degraded",
      healthCode: "unsupported_dom_variant",
    });
  });
});
