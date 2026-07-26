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
  strategy: SubmissionResolutionStrategy;
};

export type SubmissionResolutionDiagnosis =
  | { context: ResolvedSubmissionElements; healthCode: null }
  | { context: null; healthCode: AdapterHealthCode };

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
        return {
          context: {
            composer: candidate,
            sendControl,
            strategy: strategyFor(selectorIndex),
          },
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
  context: Pick<ResolvedSubmissionElements, "composer" | "sendControl">,
): boolean {
  if (
    !isUsableComposer(context.composer) ||
    !isUsableSendControl(context.sendControl)
  ) {
    return false;
  }
  const current = resolveSubmissionElements(document);
  return (
    current?.composer === context.composer &&
    current.sendControl === context.sendControl
  );
}
