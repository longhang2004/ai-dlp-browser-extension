import type { ProtectionStatusSnapshot } from "@ai-dlp/shared-types";
import { useEffect, useState } from "react";

import {
  getInstalledPageRuntime,
  sendPageRequest,
  type ExtensionPageRuntime,
} from "../ui/page-runtime.js";

const STATUS_COPY = {
  initializing: "Protection is initializing",
  waiting_for_composer: "Protection is waiting for ChatGPT",
  active: "Protection is active",
  disabled: "Protection is disabled",
  degraded: "Protection is degraded",
  unavailable: "Protection is unavailable",
} as const;

const INITIAL_STATUS: ProtectionStatusSnapshot = {
  state: "initializing",
  application: null,
  surfaceId: null,
  protectionEnabled: null,
  recentEventCount: 0,
};

const UNAVAILABLE_STATUS: ProtectionStatusSnapshot = {
  state: "unavailable",
  application: null,
  surfaceId: null,
  protectionEnabled: null,
  recentEventCount: 0,
};

function normalizePopupStatus(
  status: ProtectionStatusSnapshot,
): ProtectionStatusSnapshot {
  if (status.application === null && status.surfaceId === null) return status;
  return status.application === "chatgpt" && status.surfaceId === "chatgpt_web"
    ? status
    : UNAVAILABLE_STATUS;
}

export function App({ runtime }: { runtime?: ExtensionPageRuntime }) {
  const [status, setStatus] =
    useState<ProtectionStatusSnapshot>(INITIAL_STATUS);

  useEffect(() => {
    let current = true;
    void Promise.resolve()
      .then(() =>
        sendPageRequest(runtime ?? getInstalledPageRuntime(), {
          type: "status.read",
        }),
      )
      .then(
        (response) => {
          if (!current) return;
          setStatus(
            response.type === "status.result"
              ? normalizePopupStatus(response.status)
              : UNAVAILABLE_STATUS,
          );
        },
        () => {
          if (current) setStatus(UNAVAILABLE_STATUS);
        },
      );
    return () => {
      current = false;
    };
  }, [runtime]);

  const applicationName =
    status.application === "chatgpt" && status.surfaceId === "chatgpt_web"
      ? "ChatGPT"
      : null;

  return (
    <main className="page-shell popup-shell">
      <p className="eyebrow">AI DLP</p>
      <h1>{STATUS_COPY[status.state]}</h1>
      <p className={`status-pill status-${status.state}`}>
        {status.state === "initializing"
          ? applicationName === null
            ? "Waiting for a validated content connection"
            : `Waiting for validated ${applicationName} settings`
          : status.state === "waiting_for_composer"
            ? `Waiting for the ${applicationName ?? "supported"} composer`
            : status.state === "unavailable"
              ? "No validated protected surface is reporting"
              : `${applicationName ?? "Supported surface"} · local inspection only`}
      </p>
      <p className="muted">
        {status.recentEventCount} recent protection events
      </p>
      <p className="muted">
        Attached file contents are not inspected in this version.
      </p>
      <nav className="page-actions" aria-label="Extension pages">
        <a className="button primary" href="/options.html" target="_blank">
          Settings
        </a>
        <a className="button secondary" href="/audit.html" target="_blank">
          Audit log
        </a>
      </nav>
    </main>
  );
}
