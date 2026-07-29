import {
  createDisplayFinding,
  createProtectionDialogModel,
} from "@ai-dlp/shared-types";
import type {
  ProtectionDialogModel,
  SensitiveDataFinding,
} from "@ai-dlp/shared-types";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtectionDialog } from "./ProtectionDialog.js";

afterEach(cleanup);

function createWarning(canRedact = true): ProtectionDialogModel {
  return createProtectionDialogModel({
    kind: "warn",
    findings: [
      createDisplayFinding("email", "high"),
      createDisplayFinding("protected_keyword", "medium"),
    ],
    reasonCode: "policy_match",
    attachmentPresent: false,
    canRedact,
  });
}

describe("ProtectionDialog", () => {
  it("renders only sanitized category metadata and a placeholder preview", () => {
    render(<ProtectionDialog request={createWarning()} onIntent={vi.fn()} />);

    expect(
      screen.getByRole("dialog", { name: "Review protected information" }),
    ).not.toBeNull();
    expect(screen.getByText("Email address")).not.toBeNull();
    expect(screen.getByText("Protected keyword")).not.toBeNull();
    expect(
      screen.getByText("… [EMAIL] … [PROTECTED_KEYWORD] …"),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("matchedText");
  });

  it("returns typed warning intents and hides unavailable redaction", async () => {
    const user = userEvent.setup();
    const onIntent = vi.fn();
    const { rerender } = render(
      <ProtectionDialog request={createWarning()} onIntent={onIntent} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Redact and continue" }),
    );
    await user.click(screen.getByRole("button", { name: "Send anyway" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onIntent.mock.calls).toEqual([["redact"], ["bypass"], ["cancel"]]);

    rerender(
      <ProtectionDialog request={createWarning(false)} onIntent={onIntent} />,
    );
    expect(
      screen.queryByRole("button", { name: "Redact and continue" }),
    ).toBeNull();
  });

  it("never provides a bypass for block or enforcement-error dialogs", () => {
    const block = createProtectionDialogModel({
      kind: "block",
      findings: [createDisplayFinding("payment_card", "high")],
      reasonCode: "policy_match",
      attachmentPresent: false,
      canRedact: false,
    });
    const { rerender } = render(
      <ProtectionDialog request={block} onIntent={vi.fn()} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Submission blocked" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Send anyway" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Redact and continue" }),
    ).toBeNull();

    rerender(
      <ProtectionDialog
        request={{ kind: "error", errorCode: "prompt_too_large" }}
        onIntent={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Prompt could not be inspected" }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "This prompt is too large to inspect safely. Split it into smaller prompts and try again.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Send anyway" })).toBeNull();

    rerender(
      <ProtectionDialog
        request={{ kind: "error", errorCode: "unsupported_attachment" }}
        onIntent={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "This submission contains an attachment. Attachment inspection is not supported yet. Remove it and try again.",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Send anyway" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Redact and continue" }),
    ).toBeNull();
  });

  it("renders attachment-only warn and block actions with fixed accessible copy", async () => {
    const user = userEvent.setup();
    const onIntent = vi.fn();
    const warning = createProtectionDialogModel({
      kind: "warn",
      findings: [],
      reasonCode: "unsupported_attachment",
      attachmentPresent: true,
      canRedact: false,
    });
    const { rerender } = render(
      <ProtectionDialog request={warning} onIntent={onIntent} />,
    );

    expect(
      screen.getByRole("dialog", { name: "Unscanned attachment" }),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "Attached file contents are not inspected in this version.",
      ),
    ).not.toBeNull();
    const send = screen.getByRole("button", {
      name: "Send attachment without inspection",
    });
    expect(send.textContent).toBe("Send unscanned attachment");
    expect(
      screen.queryByRole("button", { name: "Redact and continue" }),
    ).toBeNull();
    await user.click(send);
    expect(onIntent).toHaveBeenCalledWith("bypass");

    const blocked = createProtectionDialogModel({
      kind: "block",
      findings: [],
      reasonCode: "unsupported_attachment",
      attachmentPresent: true,
      canRedact: false,
    });
    rerender(<ProtectionDialog request={blocked} onIntent={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Send attachment without inspection",
      }),
    ).toBeNull();
  });

  it("renders combined warnings with categories, attachment limitation, and one generic bypass", () => {
    const combined = createProtectionDialogModel({
      kind: "warn",
      findings: [createDisplayFinding("email", "high")],
      reasonCode: "unsupported_attachment",
      attachmentPresent: true,
      canRedact: false,
    });
    render(<ProtectionDialog request={combined} onIntent={vi.fn()} />);

    expect(screen.getByText("Email address")).not.toBeNull();
    expect(
      screen.getByText(
        "Attached file contents are not inspected in this version.",
      ),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send anyway" })).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Send attachment without inspection",
      }),
    ).toBeNull();
  });
});

declare const sensitiveFinding: SensitiveDataFinding;

const assertPrivacyTypeBoundary = (): void => {
  void (
    <ProtectionDialog
      // @ts-expect-error Sensitive detector findings cannot enter React props.
      request={sensitiveFinding}
      onIntent={() => undefined}
    />
  );
  void (
    <ProtectionDialog
      // @ts-expect-error Raw prompt fields cannot enter React props.
      request={{ kind: "error", errorCode: "ui_failure", prompt: "secret" }}
      onIntent={() => undefined}
    />
  );
};

void assertPrivacyTypeBoundary;
