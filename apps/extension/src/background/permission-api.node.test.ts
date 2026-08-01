import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_PERMISSION_SCOPE,
  type PermissionScope,
} from "@ai-dlp/shared-types/permissions";

import {
  createPermissionApi,
  type PermissionApiSource,
} from "./permission-api.js";

function source(): PermissionApiSource & {
  added: { emit(value: unknown): void };
  removed: { emit(value: unknown): void };
} {
  let addedListener: ((value: unknown) => void) | undefined;
  let removedListener: ((value: unknown) => void) | undefined;
  return {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    onAdded: {
      addListener(listener) {
        addedListener = listener;
      },
      removeListener() {
        addedListener = undefined;
      },
    },
    onRemoved: {
      addListener(listener) {
        removedListener = listener;
      },
      removeListener() {
        removedListener = undefined;
      },
    },
    added: {
      emit(value: unknown) {
        addedListener?.(value);
      },
    },
    removed: {
      emit(value: unknown) {
        removedListener?.(value);
      },
    },
  };
}

describe("permission API abstraction", () => {
  it("wraps contains/request/remove with the exact closed scope", async () => {
    const raw = source();
    const api = createPermissionApi(raw);

    await expect(api.contains(CLAUDE_PERMISSION_SCOPE)).resolves.toBe(true);
    await expect(api.request(CLAUDE_PERMISSION_SCOPE)).resolves.toBe(true);
    await expect(api.remove(CLAUDE_PERMISSION_SCOPE)).resolves.toBe(true);
    expect(raw.contains).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
    expect(raw.request).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
    expect(raw.remove).toHaveBeenCalledWith(CLAUDE_PERMISSION_SCOPE);
  });

  it("rejects unknown permissions and origins without invoking Chrome", async () => {
    const raw = source();
    const api = createPermissionApi(raw);

    await expect(
      api.contains({
        permissions: ["tabs"],
        origins: [],
      } as unknown as PermissionScope),
    ).resolves.toBe(false);
    await expect(
      api.request({
        permissions: ["scripting"],
        origins: ["https://claude.ai/*"],
      } as unknown as PermissionScope),
    ).resolves.toBe(false);
    expect(raw.contains).not.toHaveBeenCalled();
    expect(raw.request).not.toHaveBeenCalled();
  });

  it("forwards only closed added and removed events", () => {
    const raw = source();
    const api = createPermissionApi(raw);
    const added = vi.fn();
    const removed = vi.fn();
    api.onAdded.addListener(added);
    api.onRemoved.addListener(removed);

    raw.added.emit(CLAUDE_PERMISSION_SCOPE);
    raw.added.emit(CLAUDE_PERMISSION_SCOPE);
    raw.removed.emit({ permissions: ["tabs"], origins: [] });
    raw.removed.emit(CLAUDE_PERMISSION_SCOPE);

    expect(added).toHaveBeenCalledTimes(2);
    expect(added).toHaveBeenLastCalledWith({
      kind: "joint",
      scope: CLAUDE_PERMISSION_SCOPE,
    });
    expect(removed).toHaveBeenCalledWith({
      kind: "joint",
      scope: CLAUDE_PERMISSION_SCOPE,
    });
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it("maps individual closed revocation events without exposing raw arrays", () => {
    const raw = source();
    const api = createPermissionApi(raw);
    const removed = vi.fn();
    api.onRemoved.addListener(removed);

    raw.removed.emit({ permissions: ["scripting"] });
    raw.removed.emit({ origins: ["https://claude.ai:443/*"] });

    expect(removed).toHaveBeenNthCalledWith(1, {
      kind: "named",
      permission: "scripting",
    });
    expect(removed).toHaveBeenNthCalledWith(2, {
      kind: "host",
      originPattern: "https://claude.ai:443/*",
    });
  });
});
