import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_PERMISSION_SCOPE,
  type PermissionApi,
} from "@ai-dlp/shared-types/permissions";
import type { ExtensionPageRuntime } from "../ui/page-runtime.js";
import { App } from "./App.js";

afterEach(cleanup);

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

  it("requests the exact joint scope and delegates removal to the background", async () => {
    let host = false;
    let named = false;
    const request = vi.fn(async () => {
      host = true;
      named = true;
      return true;
    });
    const contains = vi.fn(async (scope) => {
      if (scope.permissions.length > 0 && scope.origins.length > 0) {
        return host && named;
      }
      return scope.origins.length > 0 ? host : named;
    });
    const permissions: PermissionApi = {
      contains,
      request,
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValue({
        type: "permissions.claude.removed",
        removed: true,
      });
    const runtime: ExtensionPageRuntime = {
      permissions,
      sendMessage,
    };
    const user = userEvent.setup();

    render(<App runtime={runtime} />);
    await user.click(
      await screen.findByRole("button", { name: "Grant Claude access" }),
    );
    expect(request).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
    expect(await screen.findByText("Access is granted.")).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Remove Claude access" }),
    );
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "permissions.claude.remove",
    });
    expect(permissions.remove).not.toHaveBeenCalled();
    expect(contains).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
  });

  it("requeries the exact joint scope after grant and reflects partial live state", async () => {
    let host = false;
    let named = false;
    const contains = vi.fn(async (scope) => {
      if (scope.permissions.length > 0 && scope.origins.length > 0) {
        return host && named;
      }
      return scope.origins.length > 0 ? host : named;
    });
    const request = vi.fn(async () => {
      host = true;
      named = false;
      return false;
    });
    const permissions: PermissionApi = {
      contains,
      request,
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const sendMessage = vi.fn().mockResolvedValue({
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
    });
    render(<App runtime={{ permissions, sendMessage }} />);
    const grant = await screen.findByRole("button", {
      name: "Grant Claude access",
    });
    await userEvent.setup().click(grant);
    await screen.findByText("Access is partially granted.");
    expect(contains).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Enable Claude protection",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("requeries truthful state after a failed background removal", async () => {
    const host = true;
    const named = false;
    const contains = vi.fn(async (scope) => {
      if (scope.permissions.length > 0 && scope.origins.length > 0) {
        return host && named;
      }
      return scope.origins.length > 0 ? host : named;
    });
    const permissions: PermissionApi = {
      contains,
      request: vi.fn().mockResolvedValue(false),
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        type: "settings.result",
        envelope: {
          schemaVersion: 3,
          settings: {
            protectionEnabled: true,
            surfaces: [
              { surfaceId: "chatgpt_web", enabled: true },
              { surfaceId: "claude_web", enabled: true },
            ],
            emailAction: "warn",
            phoneAction: "warn",
            attachmentAction: "warn",
            protectedKeywords: [],
            auditRetentionLimit: 100,
          },
        },
      })
      .mockResolvedValue({
        type: "permissions.claude.removed",
        removed: false,
      });
    render(<App runtime={{ permissions, sendMessage }} />);
    await screen.findByRole("button", { name: "Remove Claude access" });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Remove Claude access" }));
    await screen.findByText("Access is partially granted.");
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "permissions.claude.remove",
    });
    expect(permissions.remove).not.toHaveBeenCalled();
    expect(contains).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Enable Claude protection",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it("refreshes on permission events and removes listeners on cleanup", async () => {
    let host = false;
    let named = false;
    let addedListener: ((change: unknown) => void) | undefined;
    let removedListener: ((change: unknown) => void) | undefined;
    const addListener = vi.fn((listener: (change: unknown) => void) => {
      addedListener = listener;
    });
    const removeListener = vi.fn((listener: (change: unknown) => void) => {
      if (addedListener === listener) addedListener = undefined;
      if (removedListener === listener) removedListener = undefined;
    });
    const contains = vi.fn(async (scope) =>
      scope.permissions.length > 0 ? named : host,
    );
    const permissions: PermissionApi = {
      contains,
      request: vi.fn().mockResolvedValue(false),
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener, removeListener },
      onRemoved: {
        addListener: vi.fn((listener) => {
          removedListener = listener;
        }),
        removeListener,
      },
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
    const { unmount } = render(<App runtime={runtime} />);
    await screen.findByRole("button", { name: "Grant Claude access" });
    const initialCalls = contains.mock.calls.length;
    host = true;
    named = true;
    addedListener?.({ kind: "joint" });
    await waitFor(() =>
      expect(contains.mock.calls.length).toBeGreaterThan(initialCalls),
    );
    expect(screen.getByText("Access is granted.")).not.toBeNull();
    unmount();
    expect(removeListener).toHaveBeenCalledTimes(2);
  });

  it("uses a generic global access label", async () => {
    const runtime: ExtensionPageRuntime = {
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true),
        remove: vi.fn().mockResolvedValue(true),
        onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
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
    expect(await screen.findByText("Access is granted.")).not.toBeNull();
    expect(screen.queryByText("Claude access is granted.")).toBeNull();
  });

  it("ignores a grant completion after a newer permission read", async () => {
    let host = false;
    let named = false;
    let joint = false;
    let addedListener: ((change: unknown) => void) | undefined;
    const requestStarted = deferred<void>();
    const requestCompletion = deferred<boolean>();
    const contains = vi.fn(async (scope) => {
      if (scope.permissions.length > 0 && scope.origins.length > 0) {
        return joint;
      }
      return scope.origins.length > 0 ? host : named;
    });
    const permissions: PermissionApi = {
      contains,
      request: vi.fn(() => {
        requestStarted.resolve();
        return requestCompletion.promise;
      }),
      remove: vi.fn().mockResolvedValue(true),
      onAdded: {
        addListener: vi.fn((listener) => {
          addedListener = listener;
        }),
        removeListener: vi.fn(),
      },
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
    const grant = await screen.findByRole("button", {
      name: "Grant Claude access",
    });
    const initialContainsCalls = contains.mock.calls.length;
    const click = user.click(grant);
    await requestStarted.promise;

    // A revoke/read that starts after the request makes the request completion stale.
    addedListener?.({ kind: "joint" });
    await waitFor(() =>
      expect(contains.mock.calls.length).toBeGreaterThan(initialContainsCalls),
    );
    host = true;
    named = true;
    joint = true;
    requestCompletion.resolve(true);
    await click;
    await waitFor(() =>
      expect(contains.mock.calls.length).toBeGreaterThan(
        initialContainsCalls + 3,
      ),
    );
    expect(screen.getByText("Access is not granted.")).not.toBeNull();
  });

  it("does not let a stale remove completion disable Claude after a newer revoke read", async () => {
    let host = true;
    let named = true;
    let joint = true;
    let removedListener: ((change: unknown) => void) | undefined;
    const removeStarted = deferred<void>();
    const removeCompletion = deferred<{
      type: "permissions.claude.removed";
      removed: boolean;
    }>();
    const contains = vi.fn(async (scope) => {
      if (scope.permissions.length > 0 && scope.origins.length > 0) {
        return joint;
      }
      return scope.origins.length > 0 ? host : named;
    });
    const permissions: PermissionApi = {
      contains,
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    permissions.onRemoved.addListener = vi.fn((listener) => {
      removedListener = listener;
    });
    const runtime: ExtensionPageRuntime = {
      permissions,
      sendMessage: vi.fn((message) => {
        if (message.type === "settings.read") {
          return Promise.resolve({
            type: "settings.result",
            envelope: {
              schemaVersion: 3,
              settings: {
                protectionEnabled: true,
                surfaces: [
                  { surfaceId: "chatgpt_web", enabled: true },
                  { surfaceId: "claude_web", enabled: true },
                ],
                emailAction: "warn",
                phoneAction: "warn",
                attachmentAction: "warn",
                protectedKeywords: [],
                auditRetentionLimit: 100,
              },
            },
          });
        }
        removeStarted.resolve();
        return removeCompletion.promise;
      }),
    };

    const user = userEvent.setup();
    render(<App runtime={runtime} />);
    const remove = await screen.findByRole("button", {
      name: "Remove Claude access",
    });
    const checkbox = screen.getByRole("checkbox", {
      name: "Enable Claude protection",
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    const initialContainsCalls = contains.mock.calls.length;
    const click = user.click(remove);
    await removeStarted.promise;
    // Let the test know the background request has been entered before revoking.
    host = false;
    named = false;
    joint = false;
    removedListener?.({ kind: "joint" });
    await waitFor(() =>
      expect(contains.mock.calls.length).toBeGreaterThan(initialContainsCalls),
    );
    removeCompletion.resolve({
      type: "permissions.claude.removed",
      removed: true,
    });
    await click;
    await waitFor(() =>
      expect(contains.mock.calls.length).toBeGreaterThan(
        initialContainsCalls + 3,
      ),
    );
    expect(checkbox.checked).toBe(true);
  });

  it("preserves an unrelated form edit when removal completes", async () => {
    let host = true;
    let named = true;
    let joint = true;
    const removeStarted = deferred<void>();
    const removeCompletion = deferred<{
      type: "permissions.claude.removed";
      removed: boolean;
    }>();
    const contains = vi.fn(async (scope) => {
      if (scope.permissions.length > 0 && scope.origins.length > 0) {
        return joint;
      }
      return scope.origins.length > 0 ? host : named;
    });
    const permissions: PermissionApi = {
      contains,
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    const runtime: ExtensionPageRuntime = {
      permissions,
      sendMessage: vi.fn((message) => {
        if (message.type === "settings.read") {
          return Promise.resolve({
            type: "settings.result",
            envelope: {
              schemaVersion: 3,
              settings: {
                protectionEnabled: true,
                surfaces: [
                  { surfaceId: "chatgpt_web", enabled: true },
                  { surfaceId: "claude_web", enabled: true },
                ],
                emailAction: "warn",
                phoneAction: "warn",
                attachmentAction: "warn",
                protectedKeywords: ["initial keyword"],
                auditRetentionLimit: 100,
              },
            },
          });
        }
        removeStarted.resolve();
        return removeCompletion.promise;
      }),
    };

    const user = userEvent.setup();
    render(<App runtime={runtime} />);
    const remove = await screen.findByRole("button", {
      name: "Remove Claude access",
    });
    const checkbox = screen.getByRole("checkbox", {
      name: "Enable Claude protection",
    }) as HTMLInputElement;
    const keywords = screen.getByRole("textbox", {
      name: "Protected keywords",
    }) as HTMLTextAreaElement;
    expect(checkbox.checked).toBe(true);
    expect(keywords.value).toBe("initial keyword");

    const click = user.click(remove);
    await removeStarted.promise;
    await user.clear(keywords);
    await user.type(keywords, "edited while removal was pending");

    host = false;
    named = false;
    joint = false;
    removeCompletion.resolve({
      type: "permissions.claude.removed",
      removed: true,
    });
    await click;
    await waitFor(() => expect(checkbox.checked).toBe(false));
    expect(keywords.value).toBe("edited while removal was pending");
  });

  it("ignores an in-flight grant completion after unmount", async () => {
    const requestStarted = deferred<void>();
    const requestCompletion = deferred<boolean>();
    const permissions: PermissionApi = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn(() => {
        requestStarted.resolve();
        return requestCompletion.promise;
      }),
      remove: vi.fn().mockResolvedValue(true),
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
    const { unmount } = render(<App runtime={runtime} />);
    const click = user.click(
      await screen.findByRole("button", { name: "Grant Claude access" }),
    );
    await requestStarted.promise;
    unmount();
    requestCompletion.resolve(true);
    await expect(click).resolves.toBeUndefined();
    expect(screen.queryByText("Access is granted.")).toBeNull();
  });

  it("does not restore Claude enabled state when a save completes after permission revoke", async () => {
    let host = true;
    let named = true;
    let joint = true;
    let removedListener: ((change: unknown) => void) | undefined;
    const saveCompletion = deferred<{
      type: "settings.saved";
      envelope: {
        schemaVersion: 3;
        settings: {
          protectionEnabled: boolean;
          surfaces: Array<{
            surfaceId: "chatgpt_web" | "claude_web";
            enabled: boolean;
          }>;
          emailAction: "warn";
          phoneAction: "warn";
          attachmentAction: "warn";
          protectedKeywords: string[];
          auditRetentionLimit: number;
        };
      };
    }>();
    const contains = vi.fn(async (scope) => {
      if (scope.permissions.length > 0 && scope.origins.length > 0) {
        return joint;
      }
      return scope.origins.length > 0 ? host : named;
    });
    const permissions: PermissionApi = {
      contains,
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: {
        addListener: vi.fn((listener) => {
          removedListener = listener;
        }),
        removeListener: vi.fn(),
      },
    };
    const settings = {
      protectionEnabled: true,
      surfaces: [
        { surfaceId: "chatgpt_web" as const, enabled: true },
        { surfaceId: "claude_web" as const, enabled: true },
      ],
      emailAction: "warn" as const,
      phoneAction: "warn" as const,
      attachmentAction: "warn" as const,
      protectedKeywords: [],
      auditRetentionLimit: 100,
    };
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === "settings.read") {
        return Promise.resolve({
          type: "settings.result" as const,
          envelope: { schemaVersion: 3 as const, settings },
        });
      }
      return saveCompletion.promise;
    });
    const user = userEvent.setup();
    render(<App runtime={{ permissions, sendMessage }} />);
    const checkbox = (await screen.findByRole("checkbox", {
      name: "Enable Claude protection",
    })) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const saveClick = user.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    await waitFor(() =>
      expect(sendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "settings.save" }),
      ),
    );
    host = false;
    named = false;
    joint = false;
    removedListener?.({ kind: "joint" });
    saveCompletion.resolve({
      type: "settings.saved",
      envelope: { schemaVersion: 3, settings },
    });
    await saveClick;
    await waitFor(() => expect(checkbox.checked).toBe(false));
  });

  it("does not commit an in-flight settings save after unmount", async () => {
    const saveCompletion = deferred<{
      type: "settings.saved";
      envelope: {
        schemaVersion: 3;
        settings: {
          protectionEnabled: boolean;
          surfaces: Array<{
            surfaceId: "chatgpt_web" | "claude_web";
            enabled: boolean;
          }>;
          emailAction: "warn";
          phoneAction: "warn";
          attachmentAction: "warn";
          protectedKeywords: string[];
          auditRetentionLimit: number;
        };
      };
    }>();
    const settings = {
      protectionEnabled: true,
      surfaces: [
        { surfaceId: "chatgpt_web" as const, enabled: true },
        { surfaceId: "claude_web" as const, enabled: false },
      ],
      emailAction: "warn" as const,
      phoneAction: "warn" as const,
      attachmentAction: "warn" as const,
      protectedKeywords: [],
      auditRetentionLimit: 100,
    };
    const sendMessage = vi.fn((message: { type: string }) =>
      message.type === "settings.read"
        ? Promise.resolve({
            type: "settings.result" as const,
            envelope: { schemaVersion: 3 as const, settings },
          })
        : saveCompletion.promise,
    );
    const user = userEvent.setup();
    const { unmount } = render(<App runtime={{ sendMessage }} />);
    await screen.findByRole("button", { name: "Save settings" });
    const saveClick = user.click(
      screen.getByRole("button", { name: "Save settings" }),
    );
    await waitFor(() =>
      expect(sendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "settings.save" }),
      ),
    );
    unmount();
    saveCompletion.resolve({
      type: "settings.saved",
      envelope: { schemaVersion: 3, settings },
    });
    await expect(saveClick).resolves.toBeUndefined();
    expect(screen.queryByText("Settings saved.")).toBeNull();
  });
});
