import type { PromptFreeBoundary } from "./privacy.js";

export const PROTECTION_STATUSES = Object.freeze([
  "initializing",
  "active",
  "disabled",
  "degraded",
  "unavailable",
] as const);

export type ProtectionStatus = (typeof PROTECTION_STATUSES)[number];

type StatusSnapshotBase = PromptFreeBoundary & {
  application: "chatgpt";
  recentEventCount: number;
};

export type ProtectionStatusSnapshot =
  | (StatusSnapshotBase & {
      state: "initializing" | "unavailable";
      protectionEnabled: null;
    })
  | (StatusSnapshotBase & {
      state: "active" | "degraded";
      protectionEnabled: true;
    })
  | (StatusSnapshotBase & {
      state: "disabled";
      protectionEnabled: false;
    });
