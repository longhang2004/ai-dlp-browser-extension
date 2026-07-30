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
            application: state === "unavailable" ? null : "chatgpt",
            surfaceId: state === "unavailable" ? null : "chatgpt_web",
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
    expect(screen.queryByText(/ChatGPT/u)).toBeNull();

    resolveResponse({ type: "status.result", status: { state: "active" } });
    await waitFor(() => {
      expect(screen.getByText("Protection is unavailable")).not.toBeNull();
    });
    expect(screen.queryByText("Protection is active")).toBeNull();
    expect(screen.queryByText(/ChatGPT/u)).toBeNull();
  });

  it.each([
    ["unknown identity", "unknown", "chatgpt_web"],
    ["mismatched identity", "chatgpt", "claude_web"],
  ])(
    "does not name an application for %s",
    async (_label, application, surfaceId) => {
      const runtime = runtimeWith({
        type: "status.result",
        status: {
          state: "active",
          application,
          surfaceId,
          protectionEnabled: true,
          recentEventCount: 0,
        },
      });

      render(<App runtime={runtime} />);

      expect(
        await screen.findByText("Protection is unavailable"),
      ).not.toBeNull();
      expect(screen.queryByText(/ChatGPT/u)).toBeNull();
      expect(runtime.sendMessage).toHaveBeenCalledOnce();
      expect(runtime.sendMessage).toHaveBeenCalledWith({ type: "status.read" });
    },
  );

  it("rejects page-derived copy instead of displaying it", async () => {
    render(
      <App
        runtime={runtimeWith({
          type: "status.result",
          status: {
            state: "active",
            application: "chatgpt",
            surfaceId: "chatgpt_web",
            protectionEnabled: true,
            recentEventCount: 0,
            title: "Conversation title must not render",
            url: "https://chatgpt.com/c/private",
            filename: "private-plan.pdf",
          },
        })}
      />,
    );

    expect(await screen.findByText("Protection is unavailable")).not.toBeNull();
    expect(screen.queryByText(/Conversation title/u)).toBeNull();
    expect(screen.queryByText(/private-plan/u)).toBeNull();
  });

  it("does not advertise ChatGPT prompt replacement support", async () => {
    render(
      <App
        runtime={runtimeWith({
          type: "status.result",
          status: {
            state: "active",
            application: "chatgpt",
            surfaceId: "chatgpt_web",
            protectionEnabled: true,
            recentEventCount: 0,
          },
        })}
      />,
    );

    expect(await screen.findByText("Protection is active")).not.toBeNull();
    expect(screen.queryByText(/prompt replacement/iu)).toBeNull();
    expect(screen.queryByText(/replace prompts?/iu)).toBeNull();
  });
});
