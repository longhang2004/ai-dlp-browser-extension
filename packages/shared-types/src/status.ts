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

export type ContentProtectionStatus =
  | (PromptFreeBoundary & {
      state: "initializing";
      application: "chatgpt";
      protectionEnabled: null;
    })
  | (PromptFreeBoundary & {
      state: "active" | "degraded";
      application: "chatgpt";
      protectionEnabled: true;
    })
  | (PromptFreeBoundary & {
      state: "disabled";
      application: "chatgpt";
      protectionEnabled: false;
    });
