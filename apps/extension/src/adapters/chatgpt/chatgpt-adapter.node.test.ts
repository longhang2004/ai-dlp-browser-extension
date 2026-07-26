/// <reference types="node" />

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("ChatGptAdapter source privacy invariant", () => {
  it("declares no prompt-bearing instance storage", () => {
    const source = readFileSync(
      new URL("./chatgpt-adapter.ts", import.meta.url),
      "utf8",
    );
    const instanceFields = [...source.matchAll(/^\s*#([A-Za-z]\w*)/gmu)].map(
      (match) => match[1] ?? "",
    );

    expect(
      instanceFields.filter((name) =>
        /^(?:rawPrompt|prompt|promptText|matchedText|redactedText|findings?|promptCache)/iu.test(
          name,
        ),
      ),
    ).toEqual([]);
    expect(source).not.toMatch(
      /this\.#[A-Za-z]\w*\s*=\s*(?:prompt|text|matchedText|redactedText)\b/u,
    );
  });
});
