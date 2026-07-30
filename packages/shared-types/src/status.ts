import type { PromptFreeBoundary } from "./privacy.js";
import type { AdapterId, AiSurfaceId } from "./surfaces.js";

export const PROTECTION_STATUSES = Object.freeze([
  "initializing",
  "waiting_for_composer",
  "active",
  "disabled",
  "degraded",
  "unavailable",
] as const);

export type ProtectionStatus = (typeof PROTECTION_STATUSES)[number];

type ReportedSurfaceIdentity = PromptFreeBoundary & {
  application: AdapterId;
  surfaceId: AiSurfaceId;
};

type UnreportedSurfaceIdentity = PromptFreeBoundary & {
  application: null;
  surfaceId: null;
};

type StatusSnapshotBase = PromptFreeBoundary & {
  recentEventCount: number;
};

export type ProtectionStatusSnapshot =
  | (StatusSnapshotBase &
      (ReportedSurfaceIdentity | UnreportedSurfaceIdentity) & {
        state: "initializing";
        protectionEnabled: null;
      })
  | (StatusSnapshotBase &
      UnreportedSurfaceIdentity & {
        state: "unavailable";
        protectionEnabled: null;
      })
  | (StatusSnapshotBase &
      ReportedSurfaceIdentity & {
        state: "waiting_for_composer" | "active" | "degraded";
        protectionEnabled: true;
      })
  | (StatusSnapshotBase &
      ReportedSurfaceIdentity & {
        state: "disabled";
        protectionEnabled: false;
      });

type ContentStatusBase = PromptFreeBoundary & ReportedSurfaceIdentity;

export type ContentProtectionStatus =
  | (ContentStatusBase & {
      state: "initializing";
      protectionEnabled: null;
    })
  | (ContentStatusBase & {
      state: "waiting_for_composer" | "active" | "degraded";
      protectionEnabled: true;
    })
  | (ContentStatusBase & {
      state: "disabled";
      protectionEnabled: false;
    });
