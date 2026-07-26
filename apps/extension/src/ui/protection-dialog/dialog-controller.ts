/// <reference types="vite/client" />

import { isProtectionDialogRequest } from "@ai-dlp/shared-types";
import type {
  ProtectionDialogIntent,
  ProtectionDialogRequest,
} from "@ai-dlp/shared-types";
import { createElement } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import dialogCss from "./protection-dialog.css?inline";
import { ProtectionDialog } from "./ProtectionDialog.js";

type DialogRenderer = (root: Root, node: ReactNode) => void;

type ActiveDialog = {
  generation: number;
  previousFocus: HTMLElement | null;
  resolve: (intent: ProtectionDialogIntent) => void;
};

export type ProtectionDialogController = {
  show(request: ProtectionDialogRequest): Promise<ProtectionDialogIntent>;
  cancel(): void;
  dispose(): void;
};

export type ProtectionDialogControllerOptions = {
  renderer?: DialogRenderer;
  onRenderFailure?: () => void;
};

const defaultRenderer: DialogRenderer = (root, node) => {
  flushSync(() => root.render(node));
};

function safelyCloneRequest(request: ProtectionDialogRequest): unknown {
  try {
    return structuredClone(request);
  } catch {
    return undefined;
  }
}

function restoreFocus(element: HTMLElement | null): void {
  if (element?.isConnected) {
    try {
      element.focus();
    } catch {
      // Focus restoration is best effort and must not prevent settlement.
    }
  }
}

export function createProtectionDialogController(
  documentValue: Document = document,
  options: ProtectionDialogControllerOptions = {},
): ProtectionDialogController {
  const renderer = options.renderer ?? defaultRenderer;
  const onRenderFailure = options.onRenderFailure;
  let host: HTMLElement | null = null;
  let hostParent: HTMLElement | null = null;
  let shadowRoot: ShadowRoot | null = null;
  let styleElement: HTMLStyleElement | null = null;
  let mountPoint: HTMLElement | null = null;
  let root: Root | null = null;
  let mutationObserver: MutationObserver | null = null;
  let generation = 0;
  let active: ActiveDialog | null = null;
  let disposed = false;
  let resettingInfrastructure = false;

  function reportRenderFailure(): void {
    try {
      onRenderFailure?.();
    } catch {
      // Reporting is prompt-free and must not break the safe fallback path.
    }
  }

  function isInfrastructureConnected(): boolean {
    return (
      host !== null &&
      host.isConnected &&
      hostParent !== null &&
      hostParent.isConnected &&
      host.parentNode === hostParent &&
      host.shadowRoot === shadowRoot &&
      shadowRoot?.host === host &&
      styleElement !== null &&
      styleElement.isConnected &&
      styleElement.parentNode === shadowRoot &&
      mountPoint !== null &&
      mountPoint.isConnected &&
      mountPoint.parentNode === shadowRoot
    );
  }

  function disconnectMutationObserver(): void {
    mutationObserver?.disconnect();
    mutationObserver = null;
  }

  function resolveActiveWithoutRendering(
    intent: ProtectionDialogIntent,
    restorePreviousFocus: boolean,
  ): void {
    const settling = active;
    active = null;
    if (settling === null) {
      return;
    }
    if (restorePreviousFocus) {
      restoreFocus(settling.previousFocus);
    }
    settling.resolve(intent);
  }

  function teardownInfrastructure(removeOwnedHost: boolean): void {
    const ownedHost = host;
    disconnectMutationObserver();
    unmountReactRoot();
    clearMountPoint();
    if (removeOwnedHost && ownedHost?.isConnected) {
      ownedHost.remove();
    }
    host = null;
    hostParent = null;
    shadowRoot = null;
    styleElement = null;
    mountPoint = null;
  }

  function handleInfrastructureLoss(): void {
    if (disposed || resettingInfrastructure || isInfrastructureConnected()) {
      return;
    }

    resettingInfrastructure = true;
    try {
      teardownInfrastructure(true);
      resolveActiveWithoutRendering("cancel", true);
    } finally {
      resettingInfrastructure = false;
    }
  }

  function ensureHost(): void {
    if (host !== null) {
      if (isInfrastructureConnected()) {
        return;
      }
      handleInfrastructureLoss();
    }

    host = documentValue.createElement("div");
    host.setAttribute("data-ai-dlp-protection-dialog-host", "");
    shadowRoot = host.attachShadow({ mode: "open" });

    styleElement = documentValue.createElement("style");
    styleElement.textContent = dialogCss;
    mountPoint = documentValue.createElement("div");
    mountPoint.setAttribute("data-ai-dlp-protection-dialog-mount", "");
    shadowRoot.append(styleElement, mountPoint);
    hostParent = documentValue.body ?? documentValue.documentElement;
    hostParent.append(host);

    const Observer = documentValue.defaultView?.MutationObserver;
    if (Observer === undefined) {
      throw new Error("Protection dialog observer unavailable.");
    }
    mutationObserver = new Observer(() => {
      handleInfrastructureLoss();
    });
    mutationObserver.observe(hostParent, { childList: true });
    if (hostParent !== documentValue.documentElement) {
      mutationObserver.observe(documentValue.documentElement, {
        childList: true,
      });
    }
    mutationObserver.observe(shadowRoot, { childList: true });
  }

  function ensureReactRoot(): Root {
    ensureHost();
    if (root === null) {
      if (mountPoint === null) {
        throw new Error("Protection dialog mount unavailable.");
      }
      root = createRoot(mountPoint);
    }
    return root;
  }

  function clearMountPoint(): void {
    mountPoint?.replaceChildren();
  }

  function unmountReactRoot(): void {
    const currentRoot = root;
    root = null;
    if (currentRoot === null) {
      return;
    }
    try {
      currentRoot.unmount();
    } catch {
      // A failed React tree is abandoned before fallback or host removal.
    }
  }

  function settle(
    intent: ProtectionDialogIntent,
    restorePreviousFocus: boolean,
  ): void {
    const settling = active;
    if (settling === null) {
      return;
    }
    active = null;

    if (root !== null) {
      try {
        defaultRenderer(root, null);
      } catch {
        unmountReactRoot();
        clearMountPoint();
      }
    } else {
      clearMountPoint();
    }

    if (restorePreviousFocus) {
      restoreFocus(settling.previousFocus);
    }
    settling.resolve(intent);
  }

  function handleIntent(
    expectedGeneration: number,
    intent: ProtectionDialogIntent,
  ): void {
    if (active?.generation !== expectedGeneration) {
      return;
    }
    settle(intent, true);
  }

  function showFallback(expectedGeneration: number): void {
    if (active?.generation !== expectedGeneration) {
      return;
    }
    unmountReactRoot();
    clearMountPoint();
    if (!isInfrastructureConnected() || mountPoint === null) {
      handleInfrastructureLoss();
      return;
    }

    const dialog = documentValue.createElement("section");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Protection dialog unavailable");
    dialog.className = "ai-dlp-dialog ai-dlp-dialog-fallback";

    const title = documentValue.createElement("h2");
    title.textContent = "Protection dialog unavailable";
    const guidance = documentValue.createElement("p");
    guidance.textContent =
      "Close this message, then reload the page and try again.";
    const close = documentValue.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      handleIntent(expectedGeneration, "cancel");
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleIntent(expectedGeneration, "cancel");
      } else if (event.key === "Tab") {
        event.preventDefault();
        close.focus();
      }
    });
    dialog.append(title, guidance, close);
    mountPoint.append(dialog);
    close.focus();
  }

  return {
    show(request) {
      if (disposed) {
        throw new Error("Protection dialog controller is disposed.");
      }

      const snapshot = safelyCloneRequest(request);
      if (!isProtectionDialogRequest(snapshot)) {
        throw new Error("Invalid protection dialog request.");
      }

      const previousFocus =
        active?.previousFocus ??
        (documentValue.activeElement instanceof HTMLElement
          ? documentValue.activeElement
          : null);
      if (active !== null) {
        settle("cancel", false);
      }
      if (host !== null && !isInfrastructureConnected()) {
        handleInfrastructureLoss();
      }

      generation += 1;
      const currentGeneration = generation;
      let resolveIntent!: (intent: ProtectionDialogIntent) => void;
      const result = new Promise<ProtectionDialogIntent>((resolve) => {
        resolveIntent = resolve;
      });
      active = {
        generation: currentGeneration,
        previousFocus,
        resolve: resolveIntent,
      };

      try {
        const currentRoot = ensureReactRoot();
        renderer(
          currentRoot,
          createElement(ProtectionDialog, {
            request: snapshot,
            onIntent: (intent) => handleIntent(currentGeneration, intent),
          }),
        );
        if (!isInfrastructureConnected()) {
          handleInfrastructureLoss();
        }
      } catch {
        reportRenderFailure();
        showFallback(currentGeneration);
      }

      return result;
    },

    cancel() {
      settle("cancel", true);
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      settle("cancel", true);
      teardownInfrastructure(true);
    },
  };
}
