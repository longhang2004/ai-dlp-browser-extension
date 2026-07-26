import type { AuditEvent } from "@ai-dlp/shared-types";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  getInstalledPageRuntime,
  sendPageRequest,
  type ExtensionPageRuntime,
} from "../ui/page-runtime.js";

const ERROR_COPY = {
  prompt_too_large: "Prompt too large",
  detector_failure: "Detector failure",
  policy_failure: "Policy failure",
  ui_failure: "Dialog failure",
  resume_failure: "Submission resume failure",
  extension_context_invalidated: "Extension context unavailable",
} as const;

const HEALTH_COPY = {
  composer_not_found: "Composer not found",
  send_control_not_found: "Send control not found",
  unsupported_dom_variant: "Unsupported page layout",
} as const;

function eventTitle(event: AuditEvent): string {
  switch (event.kind) {
    case "enforcement_error":
      return ERROR_COPY[event.errorCode];
    case "adapter_health":
      return HEALTH_COPY[event.healthCode];
    case "decision":
      return `${event.policyAction} · ${event.resolution}`;
  }
}

function EventDetails({ event }: { event: AuditEvent }) {
  if (event.kind !== "decision") {
    return <p className="muted">ChatGPT adapter v{event.adapterVersion}</p>;
  }
  return (
    <div className="event-details">
      <span>{event.findingCount} findings</span>
      <span>{event.detectorCategories.join(", ")}</span>
      {event.maskedExcerpt === undefined ? null : (
        <code>{event.maskedExcerpt}</code>
      )}
    </div>
  );
}

export function App({ runtime }: { runtime?: ExtensionPageRuntime }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [notice, setNotice] = useState("Loading audit events…");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const clearInFlight = useRef(false);

  useEffect(() => {
    let current = true;
    void Promise.resolve()
      .then(() =>
        sendPageRequest(runtime ?? getInstalledPageRuntime(), {
          type: "audit.read",
        }),
      )
      .then(
        (response) => {
          if (!current) return;
          if (response.type === "audit.result") {
            setEvents(structuredClone(response.envelope.events));
            setNotice("");
          } else {
            setNotice("The audit log is currently unavailable.");
          }
        },
        () => {
          if (current) setNotice("The audit log is currently unavailable.");
        },
      );
    return () => {
      current = false;
    };
  }, [runtime]);

  useEffect(() => {
    if (confirmationOpen) confirmButtonRef.current?.focus();
  }, [confirmationOpen]);

  function openConfirmation(): void {
    if (events === null || events.length === 0 || clearing) return;
    setClearError("");
    setConfirmationOpen(true);
  }

  function closeConfirmation(): void {
    if (clearing) return;
    setConfirmationOpen(false);
    setClearError("");
    queueMicrotask(() => clearButtonRef.current?.focus());
  }

  function handleConfirmationKeys(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape" && !clearing) {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab") return;
    const confirm = confirmButtonRef.current;
    const cancel = cancelButtonRef.current;
    if (confirm === null || cancel === null) return;
    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault();
      confirm.focus();
    } else if (!event.shiftKey && document.activeElement === confirm) {
      event.preventDefault();
      cancel.focus();
    }
  }

  async function confirmClear(): Promise<void> {
    if (clearInFlight.current) return;
    clearInFlight.current = true;
    setClearing(true);
    setClearError("");
    try {
      const response = await sendPageRequest(
        runtime ?? getInstalledPageRuntime(),
        { type: "audit.clear" },
      );
      if (response.type !== "audit.cleared") throw new Error("Clear failed.");
      setEvents([]);
      setNotice("Audit log cleared.");
      setConfirmationOpen(false);
    } catch {
      setClearError("The audit log could not be cleared.");
    } finally {
      clearInFlight.current = false;
      setClearing(false);
    }
  }

  return (
    <main className="page-shell wide-shell">
      <div className="heading-row">
        <div>
          <p className="eyebrow">AI DLP</p>
          <h1>Audit log</h1>
          <p className="lede">Privacy-safe protection decisions and errors.</p>
        </div>
        <button
          ref={clearButtonRef}
          className="button danger"
          type="button"
          disabled={events === null || events.length === 0 || confirmationOpen}
          onClick={openConfirmation}
        >
          Clear audit log
        </button>
      </div>
      {events === null ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : events.length === 0 ? (
        <>
          <p role="status" className="empty-state">
            No protection events yet.
          </p>
          {notice === "" ? null : (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
        </>
      ) : (
        <ol className="event-list">
          {events.map((event) => (
            <li key={event.id} className="card event-card">
              <div>
                <strong>{eventTitle(event)}</strong>
                <time dateTime={event.timestamp}>
                  {new Date(event.timestamp).toLocaleString()}
                </time>
              </div>
              <EventDetails event={event} />
            </li>
          ))}
        </ol>
      )}
      {events !== null && events.length > 0 && notice !== "" ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {confirmationOpen ? (
        <div className="confirmation-backdrop">
          <div
            className="confirmation-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-audit-title"
            aria-describedby="clear-audit-description"
            onKeyDown={handleConfirmationKeys}
          >
            <h2 id="clear-audit-title">Clear audit log?</h2>
            <p id="clear-audit-description">
              This permanently removes all stored privacy-safe audit events from
              this browser.
            </p>
            {clearError === "" ? null : (
              <p role="alert" aria-label={clearError} className="clear-error">
                {clearError}
              </p>
            )}
            <div className="confirmation-actions">
              <button
                ref={cancelButtonRef}
                className="button secondary"
                type="button"
                disabled={clearing}
                onClick={closeConfirmation}
              >
                Cancel
              </button>
              <button
                ref={confirmButtonRef}
                className="button danger"
                type="button"
                disabled={clearing}
                onClick={() => void confirmClear()}
              >
                {clearing ? "Clearing…" : "Confirm clear"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
