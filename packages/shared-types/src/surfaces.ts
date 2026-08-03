import type { PromptFreeBoundary } from "./privacy.js";

export const AI_SURFACE_IDS = Object.freeze([
  "chatgpt_web",
  "claude_web",
  "gemini_web",
  "perplexity_web",
  "deepseek_web",
  "copilot_web",
] as const);

export type AiSurfaceId = (typeof AI_SURFACE_IDS)[number];

export const ADAPTER_IDS = Object.freeze(["chatgpt", "claude"] as const);

export type AdapterId = (typeof ADAPTER_IDS)[number];

export const ADAPTER_TRUST_LEVELS = Object.freeze([
  "verified",
  "discovered",
  "unsupported",
] as const);

export type AdapterTrust = (typeof ADAPTER_TRUST_LEVELS)[number];

export const CAPABILITY_SUPPORT_LEVELS = Object.freeze([
  "verified",
  "unsupported",
  "not_applicable",
] as const);

export type CapabilitySupport = (typeof CAPABILITY_SUPPORT_LEVELS)[number];

export const ADAPTER_CAPABILITY_KEYS = Object.freeze([
  "submissionDetection",
  "promptRead",
  "attachmentDetection",
  "attachmentInspection",
  "promptReplacement",
  "submissionResume",
] as const);

export type AdapterCapabilities = PromptFreeBoundary & {
  readonly submissionDetection: CapabilitySupport;
  readonly promptRead: CapabilitySupport;
  readonly attachmentDetection: CapabilitySupport;
  readonly attachmentInspection: CapabilitySupport;
  readonly promptReplacement: CapabilitySupport;
  readonly submissionResume: CapabilitySupport;
};

export type AdapterDescriptor = PromptFreeBoundary & {
  readonly adapterId: AdapterId;
  readonly surfaceId: AiSurfaceId;
  readonly version: string;
  readonly trust: AdapterTrust;
  readonly origins: readonly string[];
  readonly capabilities: AdapterCapabilities;
  readonly entryPoint: string;
};
