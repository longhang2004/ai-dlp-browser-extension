import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionPageRuntime } from "../ui/page-runtime.js";
import { App } from "./App.js";

afterEach(cleanup);

const settings = {
  protectionEnabled: true,
  surfaces: [
    { surfaceId: "chatgpt_web" as const, enabled: true },
    { surfaceId: "claude_web" as const, enabled: false },
  ],
  emailAction: "warn" as const,
  phoneAction: "warn" as const,
  attachmentAction: "warn" as const,
  protectedKeywords: ["internal"],
  auditRetentionLimit: 100,
};

describe("options App", () => {
  it("does not render or submit an invalid redact runtime response", async () => {
    const legacySettings = {
      ...settings,
      emailAction: "redact" as const,
      phoneAction: "redact" as const,
    };
    const sendMessage = vi.fn().mockResolvedValueOnce({
      type: "settings.result",
      envelope: { schemaVersion: 1, settings: legacySettings },
    });

    render(<App runtime={{ sendMessage }} />);

    expect(
      await screen.findByText("Settings are currently unavailable."),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Email action")).toBeNull();
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("exposes only Milestone 1 settings and saves normalized values", async () => {
    const user = userEvent.setup();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        type: "settings.result",
        envelope: { schemaVersion: 3, settings },
      })
      .mockImplementation(async (request: unknown) => {
        const candidate = request as { settings: typeof settings };
        return {
          type: "settings.saved",
          envelope: { schemaVersion: 3, settings: candidate.settings },
        };
      });
    const runtime: ExtensionPageRuntime = { sendMessage };

    render(<App runtime={runtime} />);
    await screen.findByRole("heading", { name: "Protection settings" });

    expect(screen.queryByLabelText(/API secret/u)).toBeNull();
    expect(
      screen
        .getAllByRole("option")
        .some((option) => option.getAttribute("value") === "redact"),
    ).toBe(false);
    await user.selectOptions(screen.getByLabelText("Email action"), "allow");
    await user.selectOptions(screen.getByLabelText("Phone action"), "block");
    await user.selectOptions(
      screen.getByLabelText("Attachment handling"),
      "allow",
    );
    expect(
      screen.getByText(
        "Files may contain sensitive information that the extension cannot detect.",
      ),
    ).not.toBeNull();
    await user.clear(screen.getByLabelText("Protected keywords"));
    await user.type(
      screen.getByLabelText("Protected keywords"),
      "  Internal only  \n customer data ",
    );
    await user.clear(screen.getByLabelText("Audit retention limit"));
    await user.type(screen.getByLabelText("Audit retention limit"), "25");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "settings.save",
      settings: {
        protectionEnabled: true,
        surfaces: [
          { surfaceId: "chatgpt_web", enabled: true },
          { surfaceId: "claude_web", enabled: false },
        ],
        emailAction: "allow",
        phoneAction: "block",
        attachmentAction: "allow",
        protectedKeywords: ["Internal only", "customer data"],
        auditRetentionLimit: 25,
      },
    });
    expect(await screen.findByText("Settings saved.")).not.toBeNull();
  });

  it("shows content-free validation and transport errors", async () => {
    const user = userEvent.setup();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        type: "settings.result",
        envelope: { schemaVersion: 3, settings },
      })
      .mockResolvedValueOnce({
        type: "error",
        errorCode: "validation_failure",
        fieldErrors: [{ field: "auditRetentionLimit", code: "out_of_range" }],
      });
    render(<App runtime={{ sendMessage }} />);
    await screen.findByDisplayValue("100");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(
      await screen.findByText("Audit retention limit is invalid."),
    ).not.toBeNull();
  });
});
