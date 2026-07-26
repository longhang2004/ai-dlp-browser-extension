import {
  CHATGPT_ADAPTER_VERSION,
  type AdapterHealthCode,
} from "@ai-dlp/shared-types";

import type {
  CapturedSubmitAttempt,
  ChatApplicationAdapter,
  ConsumedSubmissionAuthorization,
  LiveSubmissionContext,
  PromptReplacementCapability,
  PromptReplacementResult,
  SubmissionContentCapabilities,
  SubmitInterceptor,
} from "../chat-application-adapter.js";
import {
  diagnoseSubmissionElements,
  isSubmissionContextUsable,
  isUsableComposer,
  resolveComposerSubmissionFromTarget,
  resolveSendSubmissionFromTarget,
  type ResolvedSubmissionElements,
} from "./context-resolver.js";
import { CHATGPT_SELECTORS } from "./selectors.js";

export type AdapterHealthTransition =
  | { status: "waiting_for_composer" }
  | { status: "healthy" }
  | { status: "degraded"; healthCode: AdapterHealthCode };

export const DEFAULT_HEALTH_GRACE_PERIOD_MS = 10_000;

export const CHATGPT_ADAPTER_ERROR_CODES = Object.freeze([
  "adapter_disposed",
  "interceptor_failure",
  "interceptor_already_registered",
  "prompt_context_invalid",
  "resume_context_invalid",
  "resume_in_progress",
  "resume_operation_failed",
] as const);

export type ChatGptAdapterErrorCode =
  (typeof CHATGPT_ADAPTER_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<ChatGptAdapterErrorCode, string>> =
  Object.freeze({
    adapter_disposed: "The ChatGPT adapter has been disposed.",
    interceptor_failure:
      "The ChatGPT submit interceptor could not process the attempt.",
    interceptor_already_registered:
      "A ChatGPT submit interceptor is already registered.",
    prompt_context_invalid: "The ChatGPT prompt context is no longer valid.",
    resume_context_invalid:
      "The ChatGPT submission context is no longer valid.",
    resume_in_progress: "A ChatGPT submission resume is already in progress.",
    resume_operation_failed: "The ChatGPT submission could not be resumed.",
  });

export class ChatGptAdapterError extends Error {
  readonly code: ChatGptAdapterErrorCode;

  constructor(code: ChatGptAdapterErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ChatGptAdapterError";
    this.code = code;
  }
}

export type ChatGptAdapterOptions = {
  document: Document;
  getCurrentUrl?: () => URL;
  onHealthTransition?: (transition: AdapterHealthTransition) => void;
  onAdapterError?: (error: ChatGptAdapterError) => void;
  healthGracePeriodMs?: number;
};

export type ChatGptAdapterDiagnostics = {
  disposed: boolean;
  promptCacheSlots: 0;
  retainsDocument: boolean;
  retainsUrlReader: boolean;
  retainsHealthReporter: boolean;
  retainsErrorReporter: boolean;
  retainsComposerIdentity: boolean;
  retainsInterceptor: boolean;
  retainsDisposer: boolean;
  retainsObserver: boolean;
  retainsHealthTimer: boolean;
  resumeInProgress: boolean;
};

const CONTENTEDITABLE_BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
  "PRE",
]);

function targetElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

function isSubmitKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

function cancelCapturedEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function applicationLocation(applicationUrl: URL): string {
  return `${applicationUrl.origin}${applicationUrl.pathname}${applicationUrl.search}${applicationUrl.hash}`;
}

function readStructuredContentEditable(composer: HTMLElement): string {
  const renderedText = composer.innerText;
  if (typeof renderedText === "string") {
    return renderedText;
  }

  let result = "";
  const appendLineBreak = (): void => {
    if (!result.endsWith("\n")) {
      result += "\n";
    }
  };
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.nodeValue ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) {
      return;
    }
    if (node.tagName === "BR") {
      appendLineBreak();
      return;
    }
    const isBlock = CONTENTEDITABLE_BLOCK_ELEMENTS.has(node.tagName);
    if (isBlock && result.length > 0) {
      appendLineBreak();
    }
    for (const child of node.childNodes) {
      visit(child);
    }
    if (isBlock) {
      appendLineBreak();
    }
  };

  for (const child of composer.childNodes) {
    visit(child);
  }
  return result.replace(/\n+$/u, "");
}

export class ChatGptAdapter implements ChatApplicationAdapter {
  readonly id = "chatgpt" as const;
  readonly version = CHATGPT_ADAPTER_VERSION;

  #document: Document | null;
  #getCurrentUrl: (() => URL) | null;
  #onHealthTransition: ((transition: AdapterHealthTransition) => void) | null;
  #onAdapterError: ((error: ChatGptAdapterError) => void) | null;
  #contextVersion = 0;
  #lastApplicationLocation: string | null = null;
  #composerIdentities: WeakMap<
    HTMLElement,
    { identity: number; submissionRegion: WeakRef<HTMLElement> }
  > | null = new WeakMap();
  #identityContexts = new Map<
    number,
    {
      composer: WeakRef<HTMLElement>;
      submissionRegion: WeakRef<HTMLElement>;
    }
  >();
  #identitySequence = 0;
  #attemptSequence = 0;
  #interceptor: SubmitInterceptor | null = null;
  #interceptorDisposer: (() => void) | null = null;
  #observer: MutationObserver | null = null;
  #healthCheckQueued = false;
  #lastHealth: "waiting_for_composer" | "healthy" | AdapterHealthCode | null =
    null;
  #lastHealthApplicationLocation: string | null = null;
  #healthGraceTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #healthGracePeriodMs: number;
  #resumeInProgress = false;
  #disposed = false;

  constructor(options: ChatGptAdapterOptions) {
    this.#document = options.document;
    this.#getCurrentUrl =
      options.getCurrentUrl ??
      (() =>
        new URL(options.document.defaultView?.location.href ?? "about:blank"));
    this.#onHealthTransition = options.onHealthTransition ?? null;
    this.#onAdapterError = options.onAdapterError ?? null;
    this.#healthGracePeriodMs =
      options.healthGracePeriodMs ?? DEFAULT_HEALTH_GRACE_PERIOD_MS;
  }

  matches(url: URL): boolean {
    return url.origin === "https://chatgpt.com";
  }

  /** @internal Exposes prompt-free lifecycle state for privacy tests only. */
  getDiagnosticsForTesting(): ChatGptAdapterDiagnostics {
    return {
      disposed: this.#disposed,
      promptCacheSlots: 0,
      retainsDocument: this.#document !== null,
      retainsUrlReader: this.#getCurrentUrl !== null,
      retainsHealthReporter: this.#onHealthTransition !== null,
      retainsErrorReporter: this.#onAdapterError !== null,
      retainsComposerIdentity: this.#identityContexts.size > 0,
      retainsInterceptor: this.#interceptor !== null,
      retainsDisposer: this.#interceptorDisposer !== null,
      retainsObserver: this.#observer !== null,
      retainsHealthTimer: this.#healthGraceTimer !== null,
      resumeInProgress: this.#resumeInProgress,
    };
  }

  resolveCurrentSubmissionContext(): LiveSubmissionContext | null {
    if (this.#disposed) {
      return null;
    }
    const document = this.#requireDocument();
    const applicationUrl = this.#currentUrl();
    if (!this.matches(applicationUrl)) {
      return null;
    }
    const resolved = diagnoseSubmissionElements(document).context;
    if (resolved === null) {
      return null;
    }
    return this.#createLiveContext(applicationUrl, resolved);
  }

  resolveSubmissionContext(
    contextIdentity: number,
  ): LiveSubmissionContext | null {
    if (this.#disposed || !Number.isSafeInteger(contextIdentity)) {
      return null;
    }
    const stored = this.#identityContexts.get(contextIdentity);
    const composer = stored?.composer.deref();
    const submissionRegion = stored?.submissionRegion.deref();
    if (
      composer === undefined ||
      submissionRegion === undefined ||
      !composer.isConnected ||
      !submissionRegion.isConnected
    ) {
      this.#identityContexts.delete(contextIdentity);
      return null;
    }
    const applicationUrl = this.#currentUrl();
    if (!this.matches(applicationUrl)) {
      return null;
    }
    const resolution = resolveComposerSubmissionFromTarget(
      this.#requireDocument(),
      composer,
    );
    if (
      resolution.kind !== "resolved" ||
      resolution.context.composer !== composer ||
      resolution.context.submissionRegion !== submissionRegion
    ) {
      return null;
    }
    const context = this.#createLiveContext(applicationUrl, resolution.context);
    return context.contextIdentity === contextIdentity ? context : null;
  }

  readPrompt(context: LiveSubmissionContext): string {
    this.#assertPromptContext(context);
    return context.composer instanceof HTMLTextAreaElement
      ? context.composer.value
      : readStructuredContentEditable(context.composer);
  }

  inspectSubmissionCapabilities(
    context: LiveSubmissionContext,
  ): SubmissionContentCapabilities {
    this.#assertPromptContext(context);
    return {
      hasUnsupportedAttachment:
        context.submissionRegion.querySelector(
          CHATGPT_SELECTORS.attachmentEvidence,
        ) !== null,
    };
  }

  getPromptReplacementCapability(
    context: LiveSubmissionContext,
  ): PromptReplacementCapability {
    this.#assertPromptContext(context);
    return "unsupported";
  }

  replacePrompt(
    context: LiveSubmissionContext,
    text: string,
  ): PromptReplacementResult {
    this.#assertPromptContext(context);
    void text;
    return { ok: false, reason: "unsupported_editor" };
  }

  registerSubmitInterceptor(handler: SubmitInterceptor): () => void {
    if (this.#disposed) {
      throw new ChatGptAdapterError("adapter_disposed");
    }
    if (this.#interceptor !== null) {
      if (this.#interceptor === handler && this.#interceptorDisposer !== null) {
        return this.#interceptorDisposer;
      }
      throw new ChatGptAdapterError("interceptor_already_registered");
    }

    const document = this.#requireDocument();
    const dispose = (): void => {
      this.#unregisterInterceptor(dispose);
    };
    this.#interceptor = handler;
    this.#interceptorDisposer = dispose;
    document.addEventListener("click", this.#onClick, true);
    document.addEventListener("keydown", this.#onKeyDown, true);
    try {
      this.#startHealthObserver();
    } catch (error) {
      dispose();
      throw error;
    }
    return dispose;
  }

  resumeSubmission(
    context: LiveSubmissionContext,
    authorization: ConsumedSubmissionAuthorization,
  ): void {
    if (this.#disposed) {
      throw new ChatGptAdapterError("adapter_disposed");
    }
    if (this.#resumeInProgress) {
      throw new ChatGptAdapterError("resume_in_progress");
    }
    if (
      authorization.attemptId.length === 0 ||
      !this.#isResumeContextValid(context)
    ) {
      throw new ChatGptAdapterError("resume_context_invalid");
    }

    this.#resumeInProgress = true;
    try {
      context.sendControl.click();
    } catch {
      throw new ChatGptAdapterError("resume_operation_failed");
    } finally {
      this.#resumeInProgress = false;
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#interceptorDisposer?.();
    this.#observer?.disconnect();
    this.#clearHealthGrace();
    this.#observer = null;
    this.#interceptor = null;
    this.#interceptorDisposer = null;
    this.#composerIdentities = null;
    this.#identityContexts.clear();
    this.#lastApplicationLocation = null;
    this.#lastHealth = null;
    this.#lastHealthApplicationLocation = null;
    this.#healthCheckQueued = false;
    this.#resumeInProgress = false;
    this.#onHealthTransition = null;
    this.#onAdapterError = null;
    this.#getCurrentUrl = null;
    this.#document = null;
    this.#disposed = true;
  }

  readonly #onClick = (event: MouseEvent): void => {
    if (this.#resumeInProgress || this.#interceptor === null) {
      return;
    }
    const target = targetElement(event.target);
    if (target === null || !this.matches(this.#currentUrl())) {
      return;
    }
    const resolution = resolveSendSubmissionFromTarget(
      this.#requireDocument(),
      target,
    );
    if (resolution.kind === "not_a_submission_candidate") {
      return;
    }
    if (resolution.kind === "strong_candidate_unresolved") {
      this.#reportTargetResolutionFailure(resolution.healthCode);
      this.#capture(event, "click", 0, this.#contextVersion);
      return;
    }
    const context = this.#createLiveContext(
      this.#currentUrl(),
      resolution.context,
    );
    this.#capture(
      event,
      "click",
      context.contextIdentity,
      context.contextVersion,
    );
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (
      this.#resumeInProgress ||
      this.#interceptor === null ||
      !isSubmitKey(event) ||
      !this.matches(this.#currentUrl())
    ) {
      return;
    }
    const target = targetElement(event.target);
    if (target === null) {
      return;
    }
    const resolution = resolveComposerSubmissionFromTarget(
      this.#requireDocument(),
      target,
    );
    if (resolution.kind === "not_a_submission_candidate") {
      return;
    }
    if (resolution.kind === "strong_candidate_unresolved") {
      this.#reportTargetResolutionFailure(resolution.healthCode);
      this.#capture(event, "enter", 0, this.#contextVersion);
      return;
    }
    const context = this.#createLiveContext(
      this.#currentUrl(),
      resolution.context,
    );
    this.#capture(
      event,
      "enter",
      context.contextIdentity,
      context.contextVersion,
    );
  };

  #capture(
    event: MouseEvent | KeyboardEvent,
    source: CapturedSubmitAttempt["source"],
    contextIdentity: number,
    initialContextVersion: number,
  ): void {
    const interceptor = this.#interceptor;
    if (interceptor === null) {
      return;
    }
    this.#attemptSequence += 1;
    let disposition: ReturnType<SubmitInterceptor>;
    try {
      disposition = interceptor({
        id: `chatgpt-submit-${this.#attemptSequence.toString(10)}`,
        source,
        contextIdentity,
        initialContextVersion,
      });
    } catch {
      cancelCapturedEvent(event);
      this.#reportAdapterError("interceptor_failure");
      return;
    }
    if (disposition === "pass_through") {
      return;
    }
    cancelCapturedEvent(event);
  }

  #assertPromptContext(context: LiveSubmissionContext): void {
    if (
      this.#disposed ||
      !isUsableComposer(context.composer) ||
      !this.matches(context.applicationUrl) ||
      this.#currentUrl().href !== context.applicationUrl.href
    ) {
      throw new ChatGptAdapterError("prompt_context_invalid");
    }
    const current = this.resolveSubmissionContext(context.contextIdentity);
    if (
      current === null ||
      current.contextIdentity !== context.contextIdentity ||
      current.composer !== context.composer ||
      current.sendControl !== context.sendControl ||
      current.submissionRegion !== context.submissionRegion ||
      current.contextVersion !== context.contextVersion
    ) {
      throw new ChatGptAdapterError("prompt_context_invalid");
    }
  }

  #reportAdapterError(code: ChatGptAdapterErrorCode): void {
    const error = new ChatGptAdapterError(code);
    try {
      this.#onAdapterError?.(error);
    } catch {
      // Adapter callbacks cannot reopen a synchronously stopped submission.
    }
  }

  #unregisterInterceptor(dispose: () => void): void {
    if (this.#interceptorDisposer !== dispose) {
      return;
    }
    this.#document?.removeEventListener("click", this.#onClick, true);
    this.#document?.removeEventListener("keydown", this.#onKeyDown, true);
    this.#observer?.disconnect();
    this.#clearHealthGrace();
    this.#observer = null;
    this.#interceptor = null;
    this.#interceptorDisposer = null;
    this.#healthCheckQueued = false;
  }

  #isResumeContextValid(context: LiveSubmissionContext): boolean {
    const document = this.#requireDocument();
    const currentUrl = this.#currentUrl();
    if (
      !this.matches(currentUrl) ||
      currentUrl.href !== context.applicationUrl.href ||
      !isSubmissionContextUsable(document, context)
    ) {
      return false;
    }
    const current = this.resolveSubmissionContext(context.contextIdentity);
    return (
      current !== null &&
      current.composer === context.composer &&
      current.sendControl === context.sendControl &&
      current.submissionRegion === context.submissionRegion &&
      current.contextVersion === context.contextVersion
    );
  }

  #updateNavigationVersion(applicationUrl: URL): void {
    const location = applicationLocation(applicationUrl);
    if (this.#contextVersion === 0) {
      this.#contextVersion = 1;
    } else if (this.#lastApplicationLocation !== location) {
      this.#contextVersion += 1;
    }
    this.#lastApplicationLocation = location;
  }

  #identityFor(composer: HTMLElement, submissionRegion: HTMLElement): number {
    const identities = this.#composerIdentities;
    if (identities === null) {
      throw new ChatGptAdapterError("adapter_disposed");
    }
    const existing = identities.get(composer);
    if (
      existing !== undefined &&
      existing.submissionRegion.deref() === submissionRegion
    ) {
      return existing.identity;
    }
    const identity = ++this.#identitySequence;
    identities.set(composer, {
      identity,
      submissionRegion: new WeakRef(submissionRegion),
    });
    this.#identityContexts.set(identity, {
      composer: new WeakRef(composer),
      submissionRegion: new WeakRef(submissionRegion),
    });
    return identity;
  }

  #createLiveContext(
    applicationUrl: URL,
    resolved: ResolvedSubmissionElements,
  ): LiveSubmissionContext {
    this.#updateNavigationVersion(applicationUrl);
    return {
      composer: resolved.composer,
      sendControl: resolved.sendControl,
      submissionRegion: resolved.submissionRegion,
      applicationUrl,
      contextIdentity: this.#identityFor(
        resolved.composer,
        resolved.submissionRegion,
      ),
      contextVersion: this.#contextVersion,
    };
  }

  #startHealthObserver(): void {
    if (this.#observer !== null) {
      return;
    }
    const MutationObserverConstructor =
      this.#requireDocument().defaultView?.MutationObserver;
    if (MutationObserverConstructor === undefined) {
      this.#runHealthCheck();
      return;
    }
    this.#observer = new MutationObserverConstructor(() => {
      this.#queueHealthCheck();
    });
    const observationRoot = this.#requireDocument().documentElement;
    this.#observer.observe(observationRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-disabled",
        "aria-hidden",
        "aria-label",
        "aria-readonly",
        "class",
        "contenteditable",
        "data-testid",
        "disabled",
        "form",
        "hidden",
        "inert",
        "readonly",
        "role",
        "style",
        "type",
      ],
    });
    this.#runHealthCheck();
  }

  #queueHealthCheck(): void {
    if (this.#healthCheckQueued || this.#disposed) {
      return;
    }
    this.#healthCheckQueued = true;
    queueMicrotask(() => {
      this.#healthCheckQueued = false;
      if (!this.#disposed && this.#interceptor !== null) {
        this.#runHealthCheck();
      }
    });
  }

  #runHealthCheck(forceDegraded = false): void {
    const currentLocation = applicationLocation(this.#currentUrl());
    if (this.#lastHealthApplicationLocation !== currentLocation) {
      this.#clearHealthGrace();
      this.#lastHealth = null;
      this.#lastHealthApplicationLocation = currentLocation;
      forceDegraded = false;
    }
    const diagnosis = diagnoseSubmissionElements(this.#requireDocument());
    if (diagnosis.context !== null) {
      this.#clearHealthGrace();
      this.#updateNavigationVersion(this.#currentUrl());
      if (this.#lastHealth !== "healthy") {
        this.#lastHealth = "healthy";
        this.#onHealthTransition?.({ status: "healthy" });
      }
      return;
    }
    if (forceDegraded) {
      this.#clearHealthGrace();
      if (this.#lastHealth !== diagnosis.healthCode) {
        this.#lastHealth = diagnosis.healthCode;
        this.#onHealthTransition?.({
          status: "degraded",
          healthCode: diagnosis.healthCode,
        });
      }
      return;
    }
    if (
      this.#lastHealth !== null &&
      this.#lastHealth !== "healthy" &&
      this.#lastHealth !== "waiting_for_composer"
    ) {
      return;
    }
    if (this.#lastHealth !== "waiting_for_composer") {
      this.#lastHealth = "waiting_for_composer";
      this.#onHealthTransition?.({ status: "waiting_for_composer" });
    }
    if (this.#healthGraceTimer === null) {
      this.#healthGraceTimer = setTimeout(() => {
        this.#healthGraceTimer = null;
        if (!this.#disposed && this.#interceptor !== null) {
          this.#runHealthCheck(true);
        }
      }, this.#healthGracePeriodMs);
    }
  }

  #reportTargetResolutionFailure(healthCode: AdapterHealthCode): void {
    this.#clearHealthGrace();
    if (this.#lastHealth === healthCode) {
      return;
    }
    this.#lastHealth = healthCode;
    this.#onHealthTransition?.({
      status: "degraded",
      healthCode,
    });
  }

  #clearHealthGrace(): void {
    if (this.#healthGraceTimer === null) {
      return;
    }
    clearTimeout(this.#healthGraceTimer);
    this.#healthGraceTimer = null;
  }

  #requireDocument(): Document {
    if (this.#document === null) {
      throw new ChatGptAdapterError("adapter_disposed");
    }
    return this.#document;
  }

  #currentUrl(): URL {
    if (this.#getCurrentUrl === null) {
      throw new ChatGptAdapterError("adapter_disposed");
    }
    return this.#getCurrentUrl();
  }
}
