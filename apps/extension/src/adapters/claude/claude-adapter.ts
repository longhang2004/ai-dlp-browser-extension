import type { AdapterHealthCode } from "@ai-dlp/shared-types";

import type {
  AdapterHealthTransition,
  AttachmentStateFingerprint,
  CapturedSubmitAttempt,
  ChatApplicationAdapter,
  ConsumedSubmissionAuthorization,
  LiveSubmissionContext,
  PromptReplacementCapability,
  PromptReplacementResult,
  SubmissionContentCapabilities,
  SubmitInterceptor,
} from "../chat-application-adapter.js";
import { CLAUDE_ADAPTER_DESCRIPTOR } from "../adapter-catalog.js";
import {
  diagnoseSubmissionElements,
  isClaudeUrl,
  isSubmissionContextUsable,
  isUsableComposer,
  resolveComposerSubmissionFromTarget,
  resolveSendSubmissionFromTarget,
  type ResolvedSubmissionElements,
} from "./context-resolver.js";
import { CLAUDE_SELECTORS } from "./selectors.js";

export { CLAUDE_ADAPTER_DESCRIPTOR } from "../adapter-catalog.js";

export const CLAUDE_ADAPTER_ERROR_CODES = Object.freeze([
  "adapter_disposed",
  "interceptor_failure",
  "interceptor_already_registered",
  "prompt_context_invalid",
  "resume_context_invalid",
  "resume_in_progress",
  "resume_operation_failed",
] as const);

export type ClaudeAdapterErrorCode =
  (typeof CLAUDE_ADAPTER_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<ClaudeAdapterErrorCode, string>> =
  Object.freeze({
    adapter_disposed: "The Claude adapter has been disposed.",
    interceptor_failure:
      "The Claude submit interceptor could not process the attempt.",
    interceptor_already_registered:
      "A Claude submit interceptor is already registered.",
    prompt_context_invalid: "The Claude prompt context is no longer valid.",
    resume_context_invalid: "The Claude submission context is no longer valid.",
    resume_in_progress: "A Claude submission resume is already in progress.",
    resume_operation_failed: "The Claude submission could not be resumed.",
  });

export class ClaudeAdapterError extends Error {
  readonly code: ClaudeAdapterErrorCode;

  constructor(code: ClaudeAdapterErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ClaudeAdapterError";
    this.code = code;
  }
}

export type ClaudeAdapterOptions = {
  document: Document;
  getCurrentUrl?: () => URL;
  onHealthTransition?: (transition: AdapterHealthTransition) => void;
  onAdapterError?: (error: ClaudeAdapterError) => void;
  healthGracePeriodMs?: number;
};

export type ClaudeAdapterDiagnostics = {
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

export const DEFAULT_HEALTH_GRACE_PERIOD_MS = 10_000;

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
  const text = composer.innerText;
  return typeof text === "string" ? text : (composer.textContent ?? "");
}

function newAttachmentStateFingerprint(): AttachmentStateFingerprint {
  return Object.freeze(Object.create(null) as AttachmentStateFingerprint);
}

function sameElementIdentity(
  previous: readonly WeakRef<Element>[],
  current: readonly Element[],
): boolean {
  return (
    previous.length === current.length &&
    previous.every((reference, index) => reference.deref() === current[index])
  );
}

function nodeContainsAttachmentEvidence(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(CLAUDE_SELECTORS.attachmentEvidence) ||
      node.querySelector(CLAUDE_SELECTORS.attachmentEvidence) !== null)
  );
}

type AttachmentStateTracker = {
  submissionRegion: WeakRef<HTMLElement>;
  evidence: WeakRef<Element>[];
  mutationVersion: number;
  observedMutationVersion: number;
  fingerprint: AttachmentStateFingerprint;
};

export class ClaudeAdapter implements ChatApplicationAdapter {
  readonly descriptor = CLAUDE_ADAPTER_DESCRIPTOR;

  #document: Document | null;
  #getCurrentUrl: (() => URL) | null;
  #onHealthTransition: ((transition: AdapterHealthTransition) => void) | null;
  #onAdapterError: ((error: ClaudeAdapterError) => void) | null;
  #contextVersion = 0;
  #lastApplicationLocation: string | null = null;
  #composerIdentities: WeakMap<
    HTMLElement,
    { identity: number; submissionRegion: WeakRef<HTMLElement> }
  > | null = new WeakMap();
  #identityContexts = new Map<
    number,
    { composer: WeakRef<HTMLElement>; submissionRegion: WeakRef<HTMLElement> }
  >();
  #identitySequence = 0;
  #attemptSequence = 0;
  #interceptor: SubmitInterceptor | null = null;
  #interceptorDisposer: (() => void) | null = null;
  #observer: MutationObserver | null = null;
  #attachmentStates = new Map<number, AttachmentStateTracker>();
  #healthCheckQueued = false;
  #lastHealth: "waiting_for_composer" | "healthy" | AdapterHealthCode | null =
    null;
  #lastHealthApplicationLocation: string | null = null;
  #healthGraceTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #healthGracePeriodMs: number;
  #resumeInProgress = false;
  #disposed = false;

  constructor(options: ClaudeAdapterOptions) {
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
    return isClaudeUrl(url);
  }

  getDiagnosticsForTesting(): ClaudeAdapterDiagnostics {
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
    if (this.#disposed) return null;
    const applicationUrl = this.#currentUrl();
    if (!this.matches(applicationUrl)) return null;
    const resolved = diagnoseSubmissionElements(
      this.#requireDocument(),
    ).context;
    return resolved === null
      ? null
      : this.#createLiveContext(applicationUrl, resolved);
  }

  resolveSubmissionContext(
    contextIdentity: number,
  ): LiveSubmissionContext | null {
    if (this.#disposed || !Number.isSafeInteger(contextIdentity)) return null;
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
    if (!this.matches(applicationUrl)) return null;
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
    const evidence = [
      ...context.submissionRegion.querySelectorAll(
        CLAUDE_SELECTORS.attachmentEvidence,
      ),
    ];
    let tracker = this.#attachmentStates.get(context.contextIdentity);
    if (
      tracker === undefined ||
      tracker.submissionRegion.deref() !== context.submissionRegion
    ) {
      tracker = {
        submissionRegion: new WeakRef(context.submissionRegion),
        evidence: evidence.map((element) => new WeakRef(element)),
        mutationVersion: 0,
        observedMutationVersion: 0,
        fingerprint: newAttachmentStateFingerprint(),
      };
      this.#attachmentStates.set(context.contextIdentity, tracker);
    } else if (
      !sameElementIdentity(tracker.evidence, evidence) ||
      tracker.observedMutationVersion !== tracker.mutationVersion
    ) {
      tracker.evidence = evidence.map((element) => new WeakRef(element));
      tracker.observedMutationVersion = tracker.mutationVersion;
      tracker.fingerprint = newAttachmentStateFingerprint();
    }
    return {
      attachmentPresent: evidence.length > 0,
      attachmentStateFingerprint: tracker.fingerprint,
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
    if (this.#disposed) throw new ClaudeAdapterError("adapter_disposed");
    if (this.#interceptor !== null) {
      if (this.#interceptor === handler && this.#interceptorDisposer !== null) {
        return this.#interceptorDisposer;
      }
      throw new ClaudeAdapterError("interceptor_already_registered");
    }
    const document = this.#requireDocument();
    const dispose = (): void => this.#unregisterInterceptor(dispose);
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
    if (this.#disposed) throw new ClaudeAdapterError("adapter_disposed");
    if (this.#resumeInProgress)
      throw new ClaudeAdapterError("resume_in_progress");
    if (
      authorization.attemptId.length === 0 ||
      !this.#isResumeContextValid(context)
    ) {
      throw new ClaudeAdapterError("resume_context_invalid");
    }
    this.#resumeInProgress = true;
    try {
      context.sendControl.click();
    } catch {
      throw new ClaudeAdapterError("resume_operation_failed");
    } finally {
      this.#resumeInProgress = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#interceptorDisposer?.();
    this.#observer?.disconnect();
    this.#clearHealthGrace();
    this.#observer = null;
    this.#interceptor = null;
    this.#interceptorDisposer = null;
    this.#composerIdentities = null;
    this.#identityContexts.clear();
    this.#attachmentStates.clear();
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
    if (this.#resumeInProgress || this.#interceptor === null) return;
    const target = targetElement(event.target);
    if (target === null || !this.matches(this.#currentUrl())) return;
    const resolution = resolveSendSubmissionFromTarget(
      this.#requireDocument(),
      target,
    );
    if (resolution.kind === "not_a_submission_candidate") return;
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
    if (target === null) return;
    const resolution = resolveComposerSubmissionFromTarget(
      this.#requireDocument(),
      target,
    );
    if (resolution.kind === "not_a_submission_candidate") return;
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
    if (interceptor === null) return;
    this.#attemptSequence += 1;
    let disposition: ReturnType<SubmitInterceptor>;
    try {
      disposition = interceptor({
        id: `claude-submit-${this.#attemptSequence.toString(10)}`,
        source,
        contextIdentity,
        initialContextVersion,
      });
    } catch {
      cancelCapturedEvent(event);
      this.#reportAdapterError("interceptor_failure");
      return;
    }
    if (disposition !== "pass_through") cancelCapturedEvent(event);
  }

  #assertPromptContext(context: LiveSubmissionContext): void {
    if (
      this.#disposed ||
      !isUsableComposer(context.composer) ||
      !this.matches(context.applicationUrl) ||
      this.#currentUrl().href !== context.applicationUrl.href
    ) {
      throw new ClaudeAdapterError("prompt_context_invalid");
    }
    const current = this.resolveSubmissionContext(context.contextIdentity);
    if (
      current === null ||
      current.composer !== context.composer ||
      current.sendControl !== context.sendControl ||
      current.submissionRegion !== context.submissionRegion ||
      current.contextVersion !== context.contextVersion
    ) {
      throw new ClaudeAdapterError("prompt_context_invalid");
    }
  }

  #reportAdapterError(code: ClaudeAdapterErrorCode): void {
    const error = new ClaudeAdapterError(code);
    try {
      this.#onAdapterError?.(error);
    } catch {
      // Error reporters cannot reopen a synchronously stopped submission.
    }
  }

  #unregisterInterceptor(dispose: () => void): void {
    if (this.#interceptorDisposer !== dispose) return;
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
    const currentUrl = this.#currentUrl();
    if (
      !this.matches(currentUrl) ||
      currentUrl.href !== context.applicationUrl.href ||
      !isSubmissionContextUsable(this.#requireDocument(), context)
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
    if (this.#contextVersion === 0) this.#contextVersion = 1;
    else if (this.#lastApplicationLocation !== location)
      this.#contextVersion += 1;
    this.#lastApplicationLocation = location;
  }

  #identityFor(composer: HTMLElement, submissionRegion: HTMLElement): number {
    const identities = this.#composerIdentities;
    if (identities === null) throw new ClaudeAdapterError("adapter_disposed");
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
    if (this.#observer !== null) return;
    const document = this.#requireDocument();
    const MutationObserverConstructor = document.defaultView?.MutationObserver;
    if (MutationObserverConstructor === undefined) {
      this.#runHealthCheck();
      return;
    }
    this.#observer = new MutationObserverConstructor((records) => {
      this.#markAttachmentMutations(records);
      this.#queueHealthCheck();
    });
    this.#observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "aria-disabled",
        "aria-hidden",
        "aria-label",
        "aria-readonly",
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

  #markAttachmentMutations(records: readonly MutationRecord[]): void {
    for (const tracker of this.#attachmentStates.values()) {
      const region = tracker.submissionRegion.deref();
      if (region === undefined || !region.isConnected) continue;
      const priorEvidence = new Set(
        tracker.evidence
          .map((reference) => reference.deref())
          .filter((element): element is Element => element !== undefined),
      );
      const changed = records.some((record) => {
        const target =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement;
        if (target === null || !region.contains(target)) return false;
        if (
          priorEvidence.has(target) ||
          [...priorEvidence].some((element) => element.contains(target)) ||
          target.matches(CLAUDE_SELECTORS.attachmentEvidence)
        ) {
          return true;
        }
        return [...record.addedNodes, ...record.removedNodes].some(
          nodeContainsAttachmentEvidence,
        );
      });
      if (changed) tracker.mutationVersion += 1;
    }
  }

  #queueHealthCheck(): void {
    if (this.#healthCheckQueued || this.#disposed) return;
    this.#healthCheckQueued = true;
    queueMicrotask(() => {
      this.#healthCheckQueued = false;
      if (!this.#disposed && this.#interceptor !== null) this.#runHealthCheck();
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
    if (
      diagnosis.healthCode === "ambiguous_submission_context" ||
      forceDegraded
    ) {
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
        if (!this.#disposed && this.#interceptor !== null)
          this.#runHealthCheck(true);
      }, this.#healthGracePeriodMs);
    }
  }

  #reportTargetResolutionFailure(healthCode: AdapterHealthCode): void {
    this.#clearHealthGrace();
    if (this.#lastHealth === healthCode) return;
    this.#lastHealth = healthCode;
    this.#onHealthTransition?.({ status: "degraded", healthCode });
  }

  #clearHealthGrace(): void {
    if (this.#healthGraceTimer === null) return;
    clearTimeout(this.#healthGraceTimer);
    this.#healthGraceTimer = null;
  }

  #requireDocument(): Document {
    if (this.#document === null)
      throw new ClaudeAdapterError("adapter_disposed");
    return this.#document;
  }

  #currentUrl(): URL {
    if (this.#getCurrentUrl === null)
      throw new ClaudeAdapterError("adapter_disposed");
    return this.#getCurrentUrl();
  }
}
