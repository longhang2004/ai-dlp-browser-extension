import assert from "node:assert/strict";
import test from "node:test";

import { inspectJavaScriptImports } from "./build-topology-rules.mjs";

test("accepts minified local static imports", () => {
  assert.deepEqual(
    inspectJavaScriptImports(
      'import{a as b}from"./assets/shared-12345678.js";import"../setup.js";',
    ),
    {
      staticSpecifiers: ["./assets/shared-12345678.js", "../setup.js"],
      dynamicImportCount: 0,
    },
  );
});

test("rejects minified bare static imports", () => {
  assert.throws(
    () => inspectJavaScriptImports('import{x}from"remote-sdk";'),
    /non-local static import remote-sdk/u,
  );
  assert.throws(
    () => inspectJavaScriptImports('import"remote";'),
    /non-local static import remote/u,
  );
});

test("rejects dynamic imports even when the target is local", () => {
  assert.throws(
    () => inspectJavaScriptImports('const module = import("./x.js");'),
    /dynamic import/u,
  );
  assert.throws(
    () =>
      inspectJavaScriptImports('const value = `prefix ${import("./x.js")}`;'),
    /dynamic import/u,
  );
});

test("ignores import-like text in comments, strings, templates, and import.meta", () => {
  assert.deepEqual(
    inspectJavaScriptImports(
      '// import("./comment.js")\n"from\\"remote\\""; `import("remote")`; import.meta.url;',
    ),
    { staticSpecifiers: [], dynamicImportCount: 0 },
  );
});
