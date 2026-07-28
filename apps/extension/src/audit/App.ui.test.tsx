import {
  CHATGPT_ADAPTER_VERSION,
  createAuditEventId,
  createAuditTimestamp,
} from "@ai-dlp/shared-types";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionPageRuntime } from "../ui/page-runtime.js";
import { App } from "./App.js";

afterEach(cleanup);

describe("audit App", () => {
  it("renders safe fields and clears only after explicit confirmation", async () => {
    const user = userEvent.setup();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        type: "audit.result",
        envelope: {
          schemaVersion: 2,
          events: [
            {
              kind: "enforcement_error",
              id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
              timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
              application: "chatgpt",
              errorCode: "prompt_too_large",
              adapterVersion: CHATGPT_ADAPTER_VERSION,
            },
          ],
        },
      })
      .mockResolvedValueOnce({ type: "audit.cleared" });
    const runtime: ExtensionPageRuntime = { sendMessage };

    render(<App runtime={runtime} />);
    expect(await screen.findByText("Prompt too large")).not.toBeNull();
    expect(document.body.textContent).not.toContain("matchedText");
    expect(document.body.textContent).not.toContain("prompt");

    const openConfirmation = screen.getByRole("button", {
      name: "Clear audit log",
    });
    await user.click(openConfirmation);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const confirmation = screen.getByRole("alertdialog", {
      name: "Clear audit log?",
    });
    expect(confirmation).not.toBeNull();
    expect(
      screen.getByText(
        "This permanently removes all stored privacy-safe audit events from this browser.",
      ),
    ).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Confirm clear" }),
    );

    await user.click(screen.getByRole("button", { name: "Confirm clear" }));
    expect(await screen.findByText("No protection events yet.")).not.toBeNull();
    expect(screen.getByText("Audit log cleared.")).not.toBeNull();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "audit.clear" });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("cancels confirmation without messaging and restores focus", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue({
      type: "audit.result",
      envelope: {
        schemaVersion: 2,
        events: [
          {
            kind: "enforcement_error",
            id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
            timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
            application: "chatgpt",
            errorCode: "detector_failure",
            adapterVersion: CHATGPT_ADAPTER_VERSION,
          },
        ],
      },
    });
    render(<App runtime={{ sendMessage }} />);
    const clearButton = await screen.findByRole("button", {
      name: "Clear audit log",
    });
    await user.click(clearButton);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(clearButton);
  });

  it("prevents duplicate confirm requests while clear is pending", async () => {
    const user = userEvent.setup();
    let finishClear: (value: unknown) => void = () => undefined;
    const pendingClear = new Promise<unknown>((resolve) => {
      finishClear = resolve;
    });
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        type: "audit.result",
        envelope: {
          schemaVersion: 2,
          events: [
            {
              kind: "enforcement_error",
              id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
              timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
              application: "chatgpt",
              errorCode: "ui_failure",
              adapterVersion: CHATGPT_ADAPTER_VERSION,
            },
          ],
        },
      })
      .mockReturnValueOnce(pendingClear);
    render(<App runtime={{ sendMessage }} />);
    await user.click(
      await screen.findByRole("button", { name: "Clear audit log" }),
    );
    const confirm = screen.getByRole("button", { name: "Confirm clear" });
    await user.dblClick(confirm);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    finishClear({ type: "audit.cleared" });
    expect(await screen.findByText("No protection events yet.")).not.toBeNull();
  });

  it("keeps confirmation available with a content-free failure state", async () => {
    const user = userEvent.setup();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        type: "audit.result",
        envelope: {
          schemaVersion: 2,
          events: [
            {
              kind: "enforcement_error",
              id: createAuditEventId("00000000-0000-4000-8000-000000000001"),
              timestamp: createAuditTimestamp("2026-07-26T12:00:00.000Z"),
              application: "chatgpt",
              errorCode: "policy_failure",
              adapterVersion: CHATGPT_ADAPTER_VERSION,
            },
          ],
        },
      })
      .mockResolvedValueOnce({ type: "error", errorCode: "storage_failure" });
    render(<App runtime={{ sendMessage }} />);
    await user.click(
      await screen.findByRole("button", { name: "Clear audit log" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm clear" }));

    expect(
      await screen.findByRole("alert", {
        name: "The audit log could not be cleared.",
      }),
    ).not.toBeNull();
    expect(screen.getByRole("alertdialog")).not.toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm clear",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByText("Policy failure")).not.toBeNull();
  });

  it("fails closed on malformed runtime responses", async () => {
    render(
      <App
        runtime={{ sendMessage: vi.fn().mockResolvedValue({ prompt: "x" }) }}
      />,
    );
    expect(
      await screen.findByText("The audit log is currently unavailable."),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("x");
  });

  it("renders attachment decisions without findings, category metadata, or filenames", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      type: "audit.result",
      envelope: {
        schemaVersion: 2,
        events: [
          {
            kind: "decision",
            id: createAuditEventId("00000000-0000-4000-8000-000000000002"),
            timestamp: createAuditTimestamp("2026-07-26T12:00:01.000Z"),
            application: "chatgpt",
            policyAction: "warn",
            resolution: "attachment_bypassed",
            detectorCategories: [],
            matchedRuleIds: ["attachment.unsupported"],
            findingCount: 0,
            reasonCode: "unsupported_attachment",
            attachmentPresent: true,
            adapterVersion: CHATGPT_ADAPTER_VERSION,
          },
        ],
      },
    });
    render(<App runtime={{ sendMessage }} />);

    expect(
      await screen.findByText("Attached file contents were not inspected."),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("findings");
    expect(document.body.textContent).not.toContain("filename");
    expect(document.body.textContent).not.toContain("email");
  });
});
