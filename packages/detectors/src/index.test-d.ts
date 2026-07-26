import type { AnalyzePromptOptions } from "./index.js";
import * as publicApi from "./index.js";

const options = {
  protectedKeywords: ["project-code"],
} satisfies AnalyzePromptOptions;
void options;

// @ts-expect-error Individual detectors are intentionally not public exports.
void publicApi.detectEmails;

// @ts-expect-error Package export maps intentionally block implementation subpaths.
type PrivateFindingModule = typeof import("@ai-dlp/detectors/finding");
declare const privateFindingModule: PrivateFindingModule;
void privateFindingModule;
