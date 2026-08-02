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

function matchesSemanticRegion(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.matches(CLAUDE_SELECTORS.composerRegion)
  );
}

function semanticRegionAncestors(element: Element): HTMLElement[] {
  const regions: HTMLElement[] = [];
  let current: Element | null = element;
  while (current !== null) {
    if (matchesSemanticRegion(current)) regions.push(current);
    current = current.parentElement;
  }
  return regions;
}

function nearestSemanticRegion(element: HTMLElement): HTMLElement | null {
  const region = element.closest(CLAUDE_SELECTORS.composerRegion);
  return region instanceof HTMLElement ? region : null;
}

function composerCandidatesInRegion(region: HTMLElement): HTMLElement[] {
  const candidates = uniqueElements(
    region,
    CLAUDE_COMPOSER_SELECTORS.join(", "),
    (candidate): candidate is HTMLElement => candidate instanceof HTMLElement,
  );
  if (region.matches(CLAUDE_COMPOSER_SELECTORS.join(", "))) {
    candidates.unshift(region);
  }
  return candidates;
}

function directlyOwnedComposers(region: HTMLElement): HTMLElement[] {
  return composerCandidatesInRegion(region).filter(
    (candidate) => nearestSemanticRegion(candidate) === region,
  );
}

function matchingSemanticSendCandidatesInRegion(
  region: HTMLElement,
): HTMLElement[] {
  return uniqueElements(
    region,
    CLAUDE_SELECTORS.send,
    (candidate): candidate is HTMLElement =>
      candidate instanceof HTMLElement &&
      nearestSemanticRegion(candidate) === region,
  );
}

function semanticSendCandidatesInRegion(region: HTMLElement): HTMLElement[] {
  return matchingSemanticSendCandidatesInRegion(region).filter(
    isUsableSendControl,
  );
}

function matchingNativeSendCandidatesInRegion(
  document: Document,
  region: HTMLElement,
): HTMLElement[] {
  const form = region instanceof HTMLFormElement ? region : null;
  if (form === null) return [];
  return uniqueElements(
    document,
    CLAUDE_SELECTORS.nativeSubmit,
    (candidate): candidate is HTMLElement => {
      if (!(
        candidate instanceof HTMLButtonElement ||
        candidate instanceof HTMLInputElement
      )) {
        return false;
      }
      return (
        candidate.form === form && nearestSemanticRegion(candidate) === region
      );
    },
  );
}

function nativeSendCandidatesInRegion(
  document: Document,
  region: HTMLElement,
): HTMLElement[] {
  return matchingNativeSendCandidatesInRegion(document, region).filter(
    isUsableSendControl,
  );
}

function directlyOwnedSendCandidates(
  document: Document,
  region: HTMLElement,
): HTMLElement[] {
  const semantic = semanticSendCandidatesInRegion(region);
  const native = nativeSendCandidatesInRegion(document, region);
  return [...new Set([...semantic, ...native])];
}

function directlyOwnedMatchingSendCandidates(
  document: Document,
  region: HTMLElement,
): HTMLElement[] {
  const semantic = matchingSemanticSendCandidatesInRegion(region);
  const native = matchingNativeSendCandidatesInRegion(document, region);
  return [...new Set([...semantic, ...native])];
}

function hasMatchingSendControlForRegion(region: HTMLElement): boolean {
  return (
    directlyOwnedMatchingSendCandidates(region.ownerDocument, region).length > 0
  );
}

function ownedComposersForRegion(region: HTMLElement): HTMLElement[] {
  return composerCandidatesInRegion(region).filter((candidate) => {
    const nearest = nearestSemanticRegion(candidate);
    if (nearest === region) return true;
    if (nearest === null || hasIndependentSubmissionPairForRegion(nearest)) {
      return false;
    }
    // A nested region with a matching but unusable Send is still an ownership
    // boundary. Falling back to an outer Send would pair unrelated controls.
    return !hasMatchingSendControlForRegion(nearest);
  });
}

// Kept separate from hasIndependentSubmissionPair so candidate enumeration
// cannot recursively walk the same nested region graph.
function hasIndependentSubmissionPairForRegion(region: HTMLElement): boolean {
  const composers = directlyOwnedComposers(region).filter(isUsableComposer);
  const sends = directlyOwnedSendCandidates(region.ownerDocument, region);
  return composers.length === 1 && sends.length === 1;
}

function sendCandidatesFor(
  document: Document,
  region: HTMLElement,
): HTMLElement[] {
  return directlyOwnedSendCandidates(document, region);
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

type TargetOwnershipResolution = {
  contexts: ResolvedSubmissionElements[];
  ambiguous: boolean;
  sawRegion: boolean;
  sawComposerCandidate: boolean;
  sawSendCandidate: boolean;
};

function collectComposerTargetOwnership(
  document: Document,
  composer: HTMLElement,
): TargetOwnershipResolution {
  const regions = semanticRegionAncestors(composer);
  const contexts: ResolvedSubmissionElements[] = [];
  let ambiguous = false;
  let sawComposerCandidate = false;
  let sawSendCandidate = false;

  for (const region of regions) {
    const composerCandidates = ownedComposersForRegion(region);
    if (composerCandidates.length > 0) sawComposerCandidate = true;
    const composers = composerCandidates.filter(isUsableComposer);
    if (!composers.includes(composer)) continue;
    const sends = sendCandidatesFor(document, region);
    if (sends.length > 0) sawSendCandidate = true;
    if (composers.length !== 1 || sends.length !== 1) {
      if (composers.length > 1 || sends.length > 1) ambiguous = true;
      continue;
    }
    const context = completeContext(composer, sends[0]!, region);
    if (context !== null) contexts.push(context);
  }

  return {
    contexts,
    ambiguous: ambiguous || contexts.length > 1,
    sawRegion: regions.length > 0,
    sawComposerCandidate,
    sawSendCandidate,
  };
}

function collectSendTargetOwnership(
  document: Document,
  send: HTMLElement,
): TargetOwnershipResolution {
  const regions = semanticRegionAncestors(send);
  const contexts: ResolvedSubmissionElements[] = [];
  let ambiguous = false;
  let sawComposerCandidate = false;
  let sawSendCandidate = false;

  for (const region of regions) {
    const sends = sendCandidatesFor(document, region);
    if (!sends.includes(send)) continue;
    sawSendCandidate = true;
    const composerCandidates = ownedComposersForRegion(region);
    if (composerCandidates.length > 0) sawComposerCandidate = true;
    const composers = composerCandidates.filter(isUsableComposer);
    if (composers.length !== 1 || sends.length !== 1) {
      if (composers.length > 1 || sends.length > 1) ambiguous = true;
      continue;
    }
    const context = completeContext(composers[0]!, send, region);
    if (context !== null) contexts.push(context);
  }

  return {
    contexts,
    ambiguous: ambiguous || contexts.length > 1,
    sawRegion: regions.length > 0,
    sawComposerCandidate,
    sawSendCandidate,
  };
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
    const ownership = collectComposerTargetOwnership(document, composer);
    if (ownership.ambiguous) return { kind: "ambiguous" };
    for (const context of ownership.contexts) {
      if (sendControl === undefined || context.sendControl === sendControl) {
        contexts.push(context);
      }
    }
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
  const ownership = collectComposerTargetOwnership(document, composer);
  if (ownership.ambiguous) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    };
  }
  if (ownership.contexts.length === 1) {
    return { kind: "resolved", context: ownership.contexts[0]! };
  }
  if (!ownership.sawRegion) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "unsupported_dom_variant",
    };
  }
  return {
    kind: "strong_candidate_unresolved",
    healthCode: ownership.sawSendCandidate
      ? "unsupported_dom_variant"
      : "send_control_not_found",
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
  const send = target.closest(
    `${CLAUDE_SELECTORS.send}, ${CLAUDE_SELECTORS.nativeSubmit}`,
  );
  if (!(send instanceof HTMLElement)) {
    return { kind: "not_a_submission_candidate" };
  }
  if (!isUsableSendControl(send)) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "send_control_not_found",
    };
  }
  const ownership = collectSendTargetOwnership(document, send);
  if (ownership.ambiguous) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    };
  }
  if (ownership.contexts.length === 1) {
    return { kind: "resolved", context: ownership.contexts[0]! };
  }
  return {
    kind: "strong_candidate_unresolved",
    healthCode: ownership.sawComposerCandidate
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
