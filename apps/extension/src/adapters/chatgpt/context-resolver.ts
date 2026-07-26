import type { AdapterHealthCode } from "@ai-dlp/shared-types";

import { CHATGPT_SELECTORS, ORDERED_COMPOSER_SELECTORS } from "./selectors.js";

export type SubmissionResolutionStrategy =
  | "prompt_textarea"
  | "native_form"
  | "semantic_contenteditable"
  | "aria_composer"
  | "stable_data_composer";

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
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false;
  }
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
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false;
  }
  if (
    !isElementVisible(element) ||
    element.getAttribute("aria-disabled") === "true"
  ) {
    return false;
  }
  if (
    (element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement) &&
    element.disabled
  ) {
    return false;
  }
  return true;
}

function nativeFormOwner(element: HTMLElement): HTMLFormElement | null {
  if (element instanceof HTMLTextAreaElement) {
    return element.form;
  }
  const form = element.closest(CHATGPT_SELECTORS.nativeForm);
  return form instanceof HTMLFormElement ? form : null;
}

function firstUsable(
  root: ParentNode,
  selector: string,
  predicate: (candidate: Element) => candidate is HTMLElement,
): HTMLElement | null {
  for (const candidate of root.querySelectorAll(selector)) {
    if (predicate(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findFormSubmitControl(
  document: Document,
  form: HTMLFormElement,
): HTMLElement | null {
  for (const candidate of document.querySelectorAll(
    CHATGPT_SELECTORS.nativeSubmit,
  )) {
    const ownedByForm =
      (candidate instanceof HTMLButtonElement ||
        candidate instanceof HTMLInputElement) &&
      candidate.form === form;
    if (ownedByForm && isUsableSendControl(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findAssociatedSendControl(
  document: Document,
  composer: HTMLElement,
): HTMLElement | null {
  const form = nativeFormOwner(composer);
  if (form !== null) {
    const stableDataSend = firstUsable(
      form,
      CHATGPT_SELECTORS.stableDataSend,
      isUsableSendControl,
    );
    if (stableDataSend !== null) return stableDataSend;
    const ariaSend = firstUsable(
      form,
      CHATGPT_SELECTORS.ariaSend,
      isUsableSendControl,
    );
    if (ariaSend !== null) return ariaSend;
    return findFormSubmitControl(document, form);
  }

  const region = composer.closest(CHATGPT_SELECTORS.composerRegion);
  if (!(region instanceof HTMLElement)) {
    return null;
  }
  const stableDataSend = firstUsable(
    region,
    CHATGPT_SELECTORS.stableDataSend,
    isUsableSendControl,
  );
  if (stableDataSend !== null) return stableDataSend;
  const ariaSend = firstUsable(
    region,
    CHATGPT_SELECTORS.ariaSend,
    isUsableSendControl,
  );
  if (ariaSend !== null) {
    return ariaSend;
  }
  return region.matches(CHATGPT_SELECTORS.semanticRoleFormRegion)
    ? firstUsable(region, CHATGPT_SELECTORS.nativeSubmit, isUsableSendControl)
    : null;
}

function resolveSubmissionRegion(
  composer: HTMLElement,
  sendControl: HTMLElement,
): HTMLElement | null {
  for (const selector of [
    CHATGPT_SELECTORS.stableComposerRoot,
    CHATGPT_SELECTORS.semanticComposerRegion,
  ]) {
    const region = composer.closest(selector);
    if (
      region instanceof HTMLElement &&
      region.contains(composer) &&
      region.contains(sendControl)
    ) {
      return region;
    }
  }
  const form = nativeFormOwner(composer);
  return form !== null && form.contains(composer) && form.contains(sendControl)
    ? form
    : null;
}

function completeSubmissionElements(
  composer: HTMLElement,
  sendControl: HTMLElement,
): ResolvedSubmissionElements | null {
  const submissionRegion = resolveSubmissionRegion(composer, sendControl);
  return submissionRegion === null
    ? null
    : {
        composer,
        sendControl,
        submissionRegion,
        strategy: strategyForComposer(composer),
      };
}

function strategyFor(selectorIndex: number): SubmissionResolutionStrategy {
  if (selectorIndex === 0) {
    return "prompt_textarea";
  }
  if (selectorIndex === 1) {
    return "native_form";
  }
  if (selectorIndex === 2) {
    return "semantic_contenteditable";
  }
  if (selectorIndex === 3) {
    return "aria_composer";
  }
  return "stable_data_composer";
}

function strategyForComposer(
  composer: HTMLElement,
): SubmissionResolutionStrategy {
  const selectorIndex = ORDERED_COMPOSER_SELECTORS.findIndex((selector) =>
    composer.matches(selector),
  );
  return strategyFor(
    selectorIndex < 0 ? ORDERED_COMPOSER_SELECTORS.length : selectorIndex,
  );
}

function closestStrongComposer(target: Element): HTMLElement | null {
  const candidate = target.closest(ORDERED_COMPOSER_SELECTORS.join(", "));
  return candidate instanceof HTMLElement ? candidate : null;
}

export function resolveComposerSubmissionFromTarget(
  document: Document,
  target: Element,
): TargetSubmissionResolution {
  const composer = closestStrongComposer(target);
  if (composer === null) {
    return { kind: "not_a_submission_candidate" };
  }
  if (!isUsableComposer(composer)) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "unsupported_dom_variant",
    };
  }
  const sendControl = findAssociatedSendControl(document, composer);
  if (sendControl === null) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "send_control_not_found",
    };
  }
  const context = completeSubmissionElements(composer, sendControl);
  return context === null
    ? {
        kind: "strong_candidate_unresolved",
        healthCode: "unsupported_dom_variant",
      }
    : { kind: "resolved", context };
}

export function resolveSendSubmissionFromTarget(
  document: Document,
  target: Element,
): TargetSubmissionResolution {
  const sendCandidate = target.closest(CHATGPT_SELECTORS.knownSendCandidate);
  if (!(sendCandidate instanceof HTMLElement)) {
    return { kind: "not_a_submission_candidate" };
  }
  if (!isUsableSendControl(sendCandidate)) {
    return {
      kind: "strong_candidate_unresolved",
      healthCode: "send_control_not_found",
    };
  }

  let sawAssociatedComposerCandidate = false;
  for (const selector of ORDERED_COMPOSER_SELECTORS) {
    for (const candidate of document.querySelectorAll(selector)) {
      if (!(candidate instanceof HTMLElement)) continue;
      const associatedSend = findAssociatedSendControl(document, candidate);
      if (associatedSend !== sendCandidate) continue;
      sawAssociatedComposerCandidate = true;
      if (!isUsableComposer(candidate)) continue;
      const context = completeSubmissionElements(candidate, sendCandidate);
      if (context === null) continue;
      return {
        kind: "resolved",
        context,
      };
    }
  }
  return {
    kind: "strong_candidate_unresolved",
    healthCode: sawAssociatedComposerCandidate
      ? "unsupported_dom_variant"
      : "composer_not_found",
  };
}

export function diagnoseSubmissionElements(
  document: Document,
): SubmissionResolutionDiagnosis {
  let sawComposerCandidate = false;
  let sawUsableComposer = false;

  for (const [
    selectorIndex,
    selector,
  ] of ORDERED_COMPOSER_SELECTORS.entries()) {
    for (const candidate of document.querySelectorAll(selector)) {
      sawComposerCandidate = true;
      if (!isUsableComposer(candidate)) {
        continue;
      }
      sawUsableComposer = true;
      const sendControl = findAssociatedSendControl(document, candidate);
      if (sendControl !== null) {
        const context = completeSubmissionElements(candidate, sendControl);
        if (context === null) {
          continue;
        }
        return {
          context: { ...context, strategy: strategyFor(selectorIndex) },
          healthCode: null,
        };
      }
    }
  }

  if (!sawComposerCandidate) {
    return { context: null, healthCode: "composer_not_found" };
  }
  if (sawUsableComposer) {
    return { context: null, healthCode: "send_control_not_found" };
  }
  return { context: null, healthCode: "unsupported_dom_variant" };
}

export function resolveSubmissionElements(
  document: Document,
): ResolvedSubmissionElements | null {
  return diagnoseSubmissionElements(document).context;
}

export function isSubmissionContextUsable(
  document: Document,
  context: Pick<
    ResolvedSubmissionElements,
    "composer" | "sendControl" | "submissionRegion"
  >,
): boolean {
  if (
    !isUsableComposer(context.composer) ||
    !isUsableSendControl(context.sendControl)
  ) {
    return false;
  }
  const resolution = resolveComposerSubmissionFromTarget(
    document,
    context.composer,
  );
  const current = resolution.kind === "resolved" ? resolution.context : null;
  return (
    current?.composer === context.composer &&
    current.sendControl === context.sendControl &&
    current.submissionRegion === context.submissionRegion
  );
}
