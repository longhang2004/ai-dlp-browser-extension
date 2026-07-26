import type { ProtectionStatusSnapshot } from "@ai-dlp/shared-types";
import { useEffect, useState } from "react";

import {
  getInstalledPageRuntime,
  sendPageRequest,
  type ExtensionPageRuntime,
} from "../ui/page-runtime.js";

const STATUS_COPY = {
  initializing: "Protection is initializing",
  active: "Protection is active",
  disabled: "Protection is disabled",
  degraded: "Protection is degraded",
  unavailable: "Protection is unavailable",
} as const;

const INITIAL_STATUS: ProtectionStatusSnapshot = {
  state: "initializing",
  application: "chatgpt",
  protectionEnabled: null,
  recentEventCount: 0,
};

const UNAVAILABLE_STATUS: ProtectionStatusSnapshot = {
  state: "unavailable",
  application: "chatgpt",
  protectionEnabled: null,
  recentEventCount: 0,
};

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
              ? response.status
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

  return (
    <main className="page-shell popup-shell">
      <p className="eyebrow">AI DLP</p>
      <h1>{STATUS_COPY[status.state]}</h1>
      <p className={`status-pill status-${status.state}`}>
        {status.state === "initializing"
          ? "Waiting for validated settings"
          : status.state === "unavailable"
            ? "No protected ChatGPT tab is reporting"
            : "ChatGPT · local inspection only"}
      </p>
      <p className="muted">
        {status.recentEventCount} recent protection events
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
