/// <reference types="node" />

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CLAUDE_ADAPTER_DESCRIPTOR } from "./claude-adapter.js";

describe("ClaudeAdapter source and descriptor privacy", () => {
  it("does not retain prompt-bearing instance fields or text assignments", () => {
    const source = readFileSync(
      new URL("./claude-adapter.ts", import.meta.url),
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
      /this\.#\w+\s*=\s*(?:prompt|text|matchedText|redactedText)\b/u,
    );
  });

  it("keeps the Claude descriptor exact and prompt-free", () => {
    expect(CLAUDE_ADAPTER_DESCRIPTOR.origins).toEqual(["https://claude.ai"]);
    expect(CLAUDE_ADAPTER_DESCRIPTOR.capabilities.promptReplacement).toBe(
      "unsupported",
    );
    expect(CLAUDE_ADAPTER_DESCRIPTOR.capabilities.attachmentInspection).toBe(
      "unsupported",
    );
    expect(JSON.stringify(CLAUDE_ADAPTER_DESCRIPTOR)).not.toMatch(
      /conversation|filename|attachment-meta|\?[^\s"]+/iu,
    );
  });
});
