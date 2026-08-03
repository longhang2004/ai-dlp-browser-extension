import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionPageRuntime } from "../ui/page-runtime.js";
import { App } from "./App.js";

afterEach(cleanup);

describe("M2.1 reserved Claude options presentation", () => {
  it("shows only the inactive support copy and no activation or trust claim", async () => {
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
      await screen.findByText(
        "Claude support is not installed in this release.",
      ),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /grant|enable Claude|permission/iu,
      }),
    ).toBeNull();
    expect(
      screen.queryByText(/verified Claude|active Claude protection/iu),
    ).toBeNull();
  });
});
