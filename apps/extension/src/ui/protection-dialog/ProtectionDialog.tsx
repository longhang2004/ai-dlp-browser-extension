import type {
  EnforcementErrorCode,
  ProtectionDialogIntent,
  ProtectionDialogRequest,
  SensitiveDataCategory,
} from "@ai-dlp/shared-types";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type ProtectionDialogProps = {
  request: ProtectionDialogRequest;
  onIntent: (intent: ProtectionDialogIntent) => void;
};

const CATEGORY_LABELS = Object.freeze({
  email: "Email address",
  phone: "Phone number",
  payment_card: "Payment card",
  aws_access_key: "AWS access key",
  private_key: "Private key",
  api_secret: "API secret",
  protected_keyword: "Protected keyword",
} as const satisfies Record<SensitiveDataCategory, string>);

const ERROR_COPY = Object.freeze({
  prompt_too_large:
    "This prompt is too large to inspect safely. Split it into smaller prompts and try again.",
  detector_failure:
    "The prompt could not be inspected. Close this message and try again.",
  policy_failure:
    "The protection policy could not be evaluated. Close this message and try again.",
  ui_failure:
    "The protection dialog could not be displayed. Reload the page and try again.",
  resume_failure:
    "The submission could not be resumed. Close this message and try again.",
  extension_context_invalidated:
    "Protection was reloaded or updated. Reload the page and try again.",
  unsupported_attachment:
    "This submission contains an attachment. Attachment inspection is not supported yet. Remove it and try again.",
} as const satisfies Record<EnforcementErrorCode, string>);

function activeElementWithin(element: HTMLElement): Element | null {
  const root = element.getRootNode();
  return root instanceof ShadowRoot
    ? root.activeElement
    : element.ownerDocument.activeElement;
}

function focusableButtons(element: HTMLElement): HTMLButtonElement[] {
  return [
    ...element.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];
}

export function ProtectionDialog({
  request,
  onIntent,
}: ProtectionDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLButtonElement>("[data-initial-focus]")
      ?.focus();
  }, [request]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onIntent("cancel");
      return;
    }

    if (event.key !== "Tab" || dialogRef.current === null) {
      return;
    }

    const buttons = focusableButtons(dialogRef.current);
    const first = buttons[0];
    const last = buttons.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }

    const activeElement = activeElementWithin(dialogRef.current);
    if (event.shiftKey && (activeElement === first || activeElement === null)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialogRef.current.contains(activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  if (request.kind === "error") {
    return (
      <div className="ai-dlp-dialog-backdrop">
        <section
          ref={dialogRef}
          className="ai-dlp-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onKeyDown={handleKeyDown}
        >
          <h2 id={titleId}>Prompt could not be inspected</h2>
          <p id={descriptionId}>{ERROR_COPY[request.errorCode]}</p>
          <div className="ai-dlp-dialog-actions">
            <button
              type="button"
              data-initial-focus="true"
              onClick={() => onIntent("cancel")}
            >
              Close
            </button>
          </div>
        </section>
      </div>
    );
  }

  const isWarning = request.kind === "warn";
  const title = isWarning
    ? "Review protected information"
    : "Submission blocked";
  const description = isWarning
    ? "Protected information was detected. Review the categories before continuing."
    : "Your protection policy does not allow this information to be submitted.";

  return (
    <div className="ai-dlp-dialog-backdrop">
      <section
        ref={dialogRef}
        className="ai-dlp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        <ul aria-label="Detected categories">
          {request.findings.map((finding) => (
            <li key={finding.category}>
              <span>{CATEGORY_LABELS[finding.category]}</span>
              <span className="ai-dlp-dialog-confidence">
                {finding.confidence} confidence
              </span>
            </li>
          ))}
        </ul>
        <p className="ai-dlp-dialog-preview" aria-label="Masked preview">
          {request.maskedPreview}
        </p>
        <div className="ai-dlp-dialog-actions">
          <button
            type="button"
            data-initial-focus="true"
            onClick={() => onIntent("cancel")}
          >
            {isWarning ? "Cancel" : "Close"}
          </button>
          {isWarning && request.canRedact ? (
            <button type="button" onClick={() => onIntent("redact")}>
              Redact and continue
            </button>
          ) : null}
          {isWarning ? (
            <button type="button" onClick={() => onIntent("bypass")}>
              Send anyway
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
