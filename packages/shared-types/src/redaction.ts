import type { SensitiveDataFinding } from "./findings.js";

export type RedactionResult = {
  sanitizedText: string;
  appliedFindings: SensitiveDataFinding[];
};
