import type { DetectorId } from "@ai-dlp/shared-types";

export const DETECTOR_PRIORITY = Object.freeze({
  "private-key": 0,
  "aws-access-key": 1,
  "payment-card": 2,
  "api-secret": 3,
  email: 4,
  phone: 5,
  "protected-keyword": 6,
} as const satisfies Record<DetectorId, number>);

export function compareDetectorPriority(left: DetectorId, right: DetectorId) {
  return DETECTOR_PRIORITY[left] - DETECTOR_PRIORITY[right];
}
