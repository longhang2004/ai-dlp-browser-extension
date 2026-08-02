import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectProductionSource,
  isProductionSourceFile,
} from "./artifact-security-rules.mjs";

test("accepts only the locked ChatGPT production URL identifiers", () => {
  assert.deepEqual(
    inspectProductionSource(
      "apps/extension/src/background/sender-validation.ts",
      'const expectedOrigin = "https://chatgpt.com";',
    ),
    [],
  );
  assert.deepEqual(
    inspectProductionSource(
      "apps/extension/public/manifest.json",
      '{"matches":["https://chatgpt.com/*"]}',
    ),
    [],
  );
  assert.deepEqual(
    inspectProductionSource(
      "apps/extension/src/adapters/adapter-catalog.ts",
      'const canonicalOrigin = "https://chatgpt.com";',
    ),
    [],
  );
  assert.deepEqual(
    inspectProductionSource(
      "apps/extension/src/content/bootstrap.ts",
      'if (location.origin !== "https://chatgpt.com") return;',
    ),
    [],
  );
  assert.match(
    inspectProductionSource(
      "apps/extension/src/background/sender-validation.ts",
      'const endpoint = "https://example.com/collect";',
    )[0] ?? "",
    /unapproved production-source URL/u,
  );
});

test("rejects a Claude URL injected into the ChatGPT adapter", () => {
  const findings = inspectProductionSource(
    "apps/extension/src/adapters/chatgpt/chatgpt-adapter.ts",
    [
      'const ownOrigin = "https://chatgpt.com";',
      'const crossAdapterOrigin = "https://claude.ai";',
    ].join("\n"),
  );
  assert.deepEqual(findings, [
    "apps/extension/src/adapters/chatgpt/chatgpt-adapter.ts contains an unapproved production-source URL: https://claude.ai",
  ]);
});

test("rejects prompt-obscuring logs and dynamic or network-capable code", () => {
  for (const source of [
    "console.log(value)",
    'fetch("/collect")',
    'new Function("return 1")',
    'Function("return 1")',
    'setTimeout("run()", 1)',
    'chrome.runtime.sendNativeMessage("helper", {})',
    'chrome["scripting"]["registerContentScripts"]([])',
    'document.querySelector("[data-testid=chat-input]")',
  ]) {
    assert.notEqual(
      inspectProductionSource("apps/extension/src/example.ts", source).length,
      0,
      source,
    );
  }
});

test("keeps dedicated tests and fixtures outside production-source scanning", () => {
  assert.equal(
    isProductionSourceFile("apps/extension/src/example.ts", ".ts"),
    true,
  );
  assert.equal(
    isProductionSourceFile("apps/extension/src/example.test.ts", ".ts"),
    false,
  );
  assert.equal(isProductionSourceFile("tests/e2e/fixtures.ts", ".ts"), false);
});
