import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionPageRuntime } from "../ui/page-runtime.js";
import { App } from "./App.js";

afterEach(cleanup);

function runtimeWith(response: unknown): ExtensionPageRuntime {
  return { sendMessage: vi.fn().mockResolvedValue(response) };
}

describe("popup App", () => {
  it.each([
    ["initializing", "Protection is initializing"],
    ["active", "Protection is active"],
    ["waiting_for_composer", "Protection is waiting for ChatGPT"],
    ["disabled", "Protection is disabled"],
    ["degraded", "Protection is degraded"],
    ["unavailable", "Protection is unavailable"],
  ] as const)("truthfully renders %s status", async (state, label) => {
    render(
      <App
        runtime={runtimeWith({
          type: "status.result",
          status: {
            state,
            application: "chatgpt",
            protectionEnabled:
              state === "active" ||
              state === "degraded" ||
              state === "waiting_for_composer"
                ? true
                : state === "disabled"
                  ? false
                  : null,
            recentEventCount: 3,
          },
        })}
      />,
    );

    expect(await screen.findByText(label)).not.toBeNull();
    expect(screen.getByText("3 recent protection events")).not.toBeNull();
    expect(
      screen.getByText(
        "Attached file contents are not inspected in this version.",
      ),
    ).not.toBeNull();
  });

  it("never claims active while status is loading or invalid", async () => {
    let resolveResponse: (value: unknown) => void = () => undefined;
    const response = new Promise<unknown>((resolve) => {
      resolveResponse = resolve;
    });
    const runtime = { sendMessage: vi.fn().mockReturnValue(response) };
    render(<App runtime={runtime} />);

    expect(screen.getByText("Protection is initializing")).not.toBeNull();
    expect(screen.queryByText("Protection is active")).toBeNull();

    resolveResponse({ type: "status.result", status: { state: "active" } });
    await waitFor(() => {
      expect(screen.getByText("Protection is unavailable")).not.toBeNull();
    });
    expect(screen.queryByText("Protection is active")).toBeNull();
  });
});
