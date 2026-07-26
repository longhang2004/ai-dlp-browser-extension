import { describe, expect, it } from "vitest";

import * as publicApi from "./index.js";

describe("detector package public API", () => {
  it("exports only the bounded orchestration surface at runtime", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "MAX_PROMPT_CODE_UNITS",
      "analyzePrompt",
      "redactPrompt",
    ]);
  });
});
