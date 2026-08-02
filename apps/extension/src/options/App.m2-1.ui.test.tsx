import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  CLAUDE_PERMISSION_SCOPE,
  type PermissionApi,
} from "@ai-dlp/shared-types/permissions";
import type { ExtensionPageRuntime } from "../ui/page-runtime.js";
import { App } from "./App.js";

afterEach(cleanup);

describe("M2.2 Claude options presentation", () => {
  it("shows the candidate disclosure, exact origin, and separate access controls", async () => {
    const runtime: ExtensionPageRuntime = {
      sendMessage: vi.fn().mockResolvedValue({
        type: "settings.result",
        envelope: {
          schemaVersion: 3,
          settings: {
            protectionEnabled: true,
            surfaces: [
              { surfaceId: "chatgpt_web", enabled: true },
              { surfaceId: "claude_web", enabled: false },
            ],
            emailAction: "warn",
            phoneAction: "warn",
            attachmentAction: "warn",
            protectedKeywords: [],
            auditRetentionLimit: 100,
          },
        },
      }),
    };

    render(<App runtime={runtime} />);

    expect(
      await screen.findByText("Claude verification candidate"),
    ).not.toBeNull();
    expect(screen.getByText("https://claude.ai:443/*")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Grant Claude access" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove Claude access" }),
    ).not.toBeNull();
    const claudeToggle = screen.getByRole("checkbox", {
      name: "Enable Claude protection",
    });
    expect((claudeToggle as HTMLInputElement).disabled).toBe(true);
    expect(
      screen.queryByText(/verified Claude|active Claude protection/iu),
    ).toBeNull();
  });

  it("requests the exact joint scope and removes both scopes", async () => {
    const request = vi.fn().mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    const permissions: PermissionApi = {
      contains: vi.fn().mockResolvedValue(false),
      request,
      remove,
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const runtime: ExtensionPageRuntime = {
      permissions,
      sendMessage: vi.fn().mockResolvedValue({
        type: "settings.result",
        envelope: {
          schemaVersion: 3,
          settings: {
            protectionEnabled: true,
            surfaces: [
              { surfaceId: "chatgpt_web", enabled: true },
              { surfaceId: "claude_web", enabled: false },
            ],
            emailAction: "warn",
            phoneAction: "warn",
            attachmentAction: "warn",
            protectedKeywords: [],
            auditRetentionLimit: 100,
          },
        },
      }),
    };
    const user = userEvent.setup();

    render(<App runtime={runtime} />);
    await user.click(
      await screen.findByRole("button", { name: "Grant Claude access" }),
    );
    expect(request).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
    expect(await screen.findByText("Claude access is granted.")).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Remove Claude access" }),
    );
    expect(remove).toHaveBeenNthCalledWith(1, {
      permissions: [],
      origins: [CLAUDE_HOST_PERMISSION_PATTERN],
    });
    expect(remove).toHaveBeenNthCalledWith(2, {
      permissions: ["scripting"],
      origins: [],
    });
  });
});
