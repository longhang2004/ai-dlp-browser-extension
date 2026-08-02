import type { AdapterHealthCode } from "@ai-dlp/shared-types";

import {
  CLAUDE_COMPOSER_SELECTORS,
  CLAUDE_ORIGIN,
  CLAUDE_SELECTORS,
} from "./selectors.js";

export type SubmissionResolutionStrategy =
  "semantic_textarea" | "semantic_contenteditable";

export type ResolvedSubmissionElements = {
  composer: HTMLElement;
  sendControl: HTMLElement;
  submissionRegion: HTMLElement;
  strategy: SubmissionResolutionStrategy;
};

export type SubmissionResolutionDiagnosis =
  | { context: ResolvedSubmissionElements; healthCode: null }
  | { context: null; healthCode: AdapterHealthCode };

export type TargetSubmissionResolution =
  | { kind: "resolved"; context: ResolvedSubmissionElements }
  | {
      kind: "strong_candidate_unresolved";
      healthCode: AdapterHealthCode;
    }
  | { kind: "not_a_submission_candidate" };

export type SubmissionContextOwnership =
  | { kind: "none"; sawComposerCandidate: boolean }
  | { kind: "unique"; context: ResolvedSubmissionElements }
  | { kind: "ambiguous" };

export function isExactClaudeOrigin(serializedOrigin: string): boolean {
  return serializedOrigin === CLAUDE_ORIGIN;
}

export function isClaudeUrl(url: URL): boolean {
  return isExactClaudeOrigin(url.origin);
}

function isElementVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current !== null) {
    if (
      current.hidden ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

function hasEditableContentAttribute(element: HTMLElement): boolean {
  const value = element.getAttribute("contenteditable");
  return value === "true" || value === "plaintext-only";
}

export function isUsableComposer(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (
    !isElementVisible(element) ||
    element.getAttribute("aria-disabled") === "true" ||
    element.getAttribute("aria-readonly") === "true"
  ) {
    return false;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  return hasEditableContentAttribute(element);
}

export function isUsableSendControl(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (
    !isElementVisible(element) ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }
  return (
    !(
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement
    ) || !element.disabled
  );
}

function uniqueElements(
  root: ParentNode,
  selector: string,
  predicate: (element: Element) => element is HTMLElement,
): HTMLElement[] {
  const result: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const candidate of root.querySelectorAll(selector)) {
    if (predicate(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}

function semanticRegionFor(element: HTMLElement): HTMLElement | null {
  const region = element.closest(CLAUDE_SELECTORS.composerRegion);
  return region instanceof HTMLElement ? region : null;
}

function sendCandidatesFor(
  document: Document,
  region: HTMLElement,
): HTMLElement[] {
  const semantic = uniqueElements(
    region,
    CLAUDE_SELECTORS.send,
    isUsableSendControl,
  );
  if (semantic.length > 0) return semantic;

  const form = region instanceof HTMLFormElement ? region : null;
  if (form === null) return [];
  return uniqueElements(
    document,
    CLAUDE_SELECTORS.nativeSubmit,
    (candidate): candidate is HTMLElement => {
      if (!isUsableSendControl(candidate)) return false;
      return (
        (candidate instanceof HTMLButtonElement ||
          candidate instanceof HTMLInputElement) &&
        candidate.form === form
      );
    },
  );
}

function strategyForComposer(
  composer: HTMLElement,
): SubmissionResolutionStrategy {
  return composer instanceof HTMLTextAreaElement
    ? "semantic_textarea"
    : "semantic_contenteditable";
}

function completeContext(
  composer: HTMLElement,
  sendControl: HTMLElement,
  region: HTMLElement,
): ResolvedSubmissionElements | null {
  if (
    !region.contains(composer) ||
    !region.contains(sendControl) ||
    !isUsableComposer(composer) ||
    !isUsableSendControl(sendControl)
  ) {
    return null;
  }
  return {
    composer,
    sendControl,
    submissionRegion: region,
    strategy: strategyForComposer(composer),
  };
}

function composerCandidates(document: Document): HTMLElement[] {
  return uniqueElements(
    document,
    CLAUDE_COMPOSER_SELECTORS.join(", "),
    (candidate): candidate is HTMLElement => candidate instanceof HTMLElement,
  );
}

export function collectSubmissionContexts(
  document: Document,
  serializedOrigin: string = CLAUDE_ORIGIN,
  sendControl?: HTMLElement,
): SubmissionContextOwnership {
  if (!isExactClaudeOrigin(serializedOrigin)) {
    return { kind: "none", sawComposerCandidate: false };
  }
  const candidates = composerCandidates(document);
  const contexts: ResolvedSubmissionElements[] = [];
  for (const composer of candidates) {
    const region = semanticRegionFor(composer);
    if (region === null) continue;
    const sends = sendCandidatesFor(document, region);
    if (sends.length !== 1) continue;
    if (sendControl !== undefined && sends[0] !== sendControl) continue;
    const context = completeContext(composer, sends[0]!, region);
    if (context !== null) contexts.push(context);
  }
  if (contexts.length === 0) {
    return { kind: "none", sawComposerCandidate: candidates.length > 0 };
  }
  if (contexts.length !== 1) return { kind: "ambiguous" };
  return { kind: "unique", context: contexts[0]! };
}

export function resolveComposerSubmissionFromTarget(
  document: Document,
  target: Element,
  serializedOrigin: string = CLAUDE_ORIGIN,
): TargetSubmissionResolution {
  if (!isExactClaudeOrigin(serializedOrigin)) {
    return { kind: "not_a_submission_candidate" };
  }
  const composer = target.closest(CLAUDE_SELECTORS.composer);
  if (!(composer instanceof HTMLElement)) {
    return { kind: "not_a_submission_candidate" };
  }
  if (!isUsableComposer(composer)) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "unsupported_dom_variant",
    };
  }
  const region = semanticRegionFor(composer);
  if (region === null) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "unsupported_dom_variant",
    };
  }
  const sends = sendCandidatesFor(document, region);
  if (sends.length === 0) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "send_control_not_found",
    };
  }
  if (sends.length > 1) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    };
  }
  const ownership = collectSubmissionContexts(
    document,
    serializedOrigin,
    sends[0],
  );
  if (ownership.kind === "ambiguous") {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    };
  }
  return ownership.kind === "unique" && ownership.context.composer === composer
    ? { kind: "resolved", context: ownership.context }
    : {
        kind: "strong_candidate_unresolved",
        healthCode: "unsupported_dom_variant",
      };
}

export function resolveSendSubmissionFromTarget(
  document: Document,
  target: Element,
  serializedOrigin: string = CLAUDE_ORIGIN,
): TargetSubmissionResolution {
  if (!isExactClaudeOrigin(serializedOrigin)) {
    return { kind: "not_a_submission_candidate" };
  }
  const send = target.closest(CLAUDE_SELECTORS.send);
  if (!(send instanceof HTMLElement)) {
    return { kind: "not_a_submission_candidate" };
  }
  if (!isUsableSendControl(send)) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "send_control_not_found",
    };
  }
  const ownership = collectSubmissionContexts(document, serializedOrigin, send);
  if (ownership.kind === "unique")
    return { kind: "resolved", context: ownership.context };
  return {
    kind: "strong_candidate_unresolved",
    healthCode:
      ownership.kind === "ambiguous"
        ? "ambiguous_submission_context"
        : ownership.sawComposerCandidate
          ? "unsupported_dom_variant"
          : "composer_not_found",
  };
}

export function diagnoseSubmissionElements(
  document: Document,
  serializedOrigin: string = CLAUDE_ORIGIN,
): SubmissionResolutionDiagnosis {
  const ownership = collectSubmissionContexts(document, serializedOrigin);
  if (ownership.kind === "unique")
    return { context: ownership.context, healthCode: null };
  if (ownership.kind === "ambiguous") {
    return { context: null, healthCode: "ambiguous_submission_context" };
  }
  if (!ownership.sawComposerCandidate) {
    return { context: null, healthCode: "composer_not_found" };
  }
  const usable = composerCandidates(document).some(isUsableComposer);
  return {
    context: null,
    healthCode: usable ? "send_control_not_found" : "unsupported_dom_variant",
  };
}

export function resolveSubmissionElements(
  document: Document,
  serializedOrigin: string = CLAUDE_ORIGIN,
): ResolvedSubmissionElements | null {
  return diagnoseSubmissionElements(document, serializedOrigin).context;
}

export function isSubmissionContextUsable(
  document: Document,
  context: Pick<
    ResolvedSubmissionElements,
    "composer" | "sendControl" | "submissionRegion"
  >,
  serializedOrigin: string = CLAUDE_ORIGIN,
): boolean {
  if (
    !isExactClaudeOrigin(serializedOrigin) ||
    !isUsableComposer(context.composer) ||
    !isUsableSendControl(context.sendControl)
  ) {
    return false;
  }
  const current = resolveComposerSubmissionFromTarget(
    document,
    context.composer,
    serializedOrigin,
  );
  return (
    current.kind === "resolved" &&
    current.context.composer === context.composer &&
    current.context.sendControl === context.sendControl &&
    current.context.submissionRegion === context.submissionRegion
  );
}
