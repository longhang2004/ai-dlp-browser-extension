import { describe, expect, test } from "vitest";

import {
  analyzePrompt,
  MAX_PROMPT_CODE_UNITS,
} from "../../packages/detectors/src/index.js";

const WARMUP_RUNS = 3;
const MEASUREMENT_RUNS = 10;
const CI_LIMIT_MS = 1_000;

type Scenario = {
  name: string;
  prompt: string;
  protectedKeywords: readonly string[];
};

function measure(scenario: Scenario): number[] {
  const options = { protectedKeywords: [...scenario.protectedKeywords] };
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    analyzePrompt(scenario.prompt, options);
  }

  const durations: number[] = [];
  for (let index = 0; index < MEASUREMENT_RUNS; index += 1) {
    const startedAt = performance.now();
    analyzePrompt(scenario.prompt, options);
    durations.push(performance.now() - startedAt);
  }
  return durations;
}

const scenarios: readonly Scenario[] = [
  {
    name: "ordinary prompt",
    prompt: "Please summarize the following local project notes.",
    protectedKeywords: [],
  },
  {
    name: "multiple findings",
    prompt:
      "Contact alice@example.com at +84 (912) 345-678 about card 4111 1111 1111 1111 and NOVA-42.",
    protectedKeywords: ["NOVA-42"],
  },
  {
    name: "Unicode and Vietnamese",
    prompt:
      "Nhờ kiểm tra Dự án Mật cho Nguyễn Văn An; liên hệ +84 (912) 345-678 khi hoàn tất. 🌿",
    protectedKeywords: ["Dự án Mật"],
  },
  {
    name: "exactly 100,000 UTF-16 code units",
    prompt: "a".repeat(MAX_PROMPT_CODE_UNITS),
    protectedKeywords: [],
  },
];

describe("detector performance budget", () => {
  for (const scenario of scenarios) {
    test(`${scenario.name} stays under the CI ceiling`, () => {
      expect(scenario.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CODE_UNITS);
      const durations = measure(scenario);
      const report = {
        scenario: scenario.name,
        measurementsMs: durations.map((duration) =>
          Number(duration.toFixed(3)),
        ),
        maximumMs: Number(Math.max(...durations).toFixed(3)),
      };
      console.info(`[detector-performance] ${JSON.stringify(report)}`);
      expect(durations).toHaveLength(MEASUREMENT_RUNS);
      for (const duration of durations) {
        expect(duration).toBeLessThan(CI_LIMIT_MS);
      }
    });
  }
});
