import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  cleanExtensionDist,
  verifyExtensionArtifactReachability,
} from "./artifact-reachability.mjs";

const manifest = JSON.stringify({
  manifest_version: 3,
  background: { service_worker: "background.js", type: "module" },
  action: { default_popup: "popup.html" },
  options_page: "options.html",
  content_scripts: [{ js: ["content-script.js"] }],
  icons: { 16: "icons/icon.png" },
});

function page(script, style) {
  return `<!doctype html><link rel="stylesheet" href="${style}"><img src="icons/icon.png"><script type="module" src="${script}"></script>`;
}

function cleanGraph() {
  return [
    ["manifest.json", manifest],
    ["background.js", 'import "./assets/background-shared.js";'],
    ["content-script.js", "var content = true;"],
    [
      "popup.html",
      page("assets/popup-12345678.js", "assets/popup-12345678.css"),
    ],
    [
      "options.html",
      page("assets/options-12345678.js", "assets/options-12345678.css"),
    ],
    [
      "audit.html",
      page("assets/audit-12345678.js", "assets/audit-12345678.css"),
    ],
    ["assets/background-shared.js", "export const background = true;"],
    ["assets/popup-12345678.js", "export const popup = true;"],
    ["assets/options-12345678.js", "export const options = true;"],
    ["assets/audit-12345678.js", "export const audit = true;"],
    ["assets/popup-12345678.css", "body { color: black; }"],
    ["assets/options-12345678.css", "body { color: black; }"],
    ["assets/audit-12345678.css", "body { color: black; }"],
    ["icons/icon.png", "png"],
  ];
}

async function createArtifact(entries = cleanGraph()) {
  const root = await mkdtemp(join(tmpdir(), "ai-dlp-artifact-"));
  for (const [relativePath, contents] of entries) {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return root;
}

test("accepts a complete extension artifact graph", async () => {
  await verifyExtensionArtifactReachability(await createArtifact());
});

test("rejects an unreachable JavaScript artifact", async () => {
  const root = await createArtifact([
    ...cleanGraph(),
    ["assets/orphan.js", "export const stale = true;"],
  ]);
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /unreachable executable or page asset: assets\/orphan\.js/u,
  );
});

test("rejects an unreachable CSS artifact", async () => {
  const root = await createArtifact([
    ...cleanGraph(),
    ["assets/orphan.css", "body { color: red; }"],
  ]);
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /unreachable executable or page asset: assets\/orphan\.css/u,
  );
});

test("rejects a stale hashed page bundle", async () => {
  const root = await createArtifact([
    ...cleanGraph(),
    ["assets/popup-deadbeef.js", "export const stale = true;"],
  ]);
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /unreachable executable or page asset: assets\/popup-deadbeef\.js/u,
  );
});

test("rejects unreachable executable JavaScript variants", async () => {
  for (const file of ["assets/stale.mjs", "assets/stale.cjs"]) {
    const root = await createArtifact([
      ...cleanGraph(),
      [file, "export const stale = true;"],
    ]);
    await assert.rejects(
      verifyExtensionArtifactReachability(root),
      new RegExp(
        `unreachable executable or page asset: ${file.replace(".", "\\.")}`,
        "u",
      ),
    );
  }
});

test("rejects a missing local HTML asset", async () => {
  const entries = cleanGraph().filter(
    ([file]) => file !== "assets/popup-12345678.css",
  );
  const root = await createArtifact(entries);
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /popup\.html references missing local asset assets\/popup-12345678\.css/u,
  );
});

test("accepts Vite root-relative local HTML assets", async () => {
  const root = await createArtifact(
    cleanGraph().map(([file, contents]) =>
      file === "popup.html"
        ? [
            file,
            page("/assets/popup-12345678.js", "/assets/popup-12345678.css"),
          ]
        : [file, contents],
    ),
  );
  await verifyExtensionArtifactReachability(root);
});

test("rejects source maps", async () => {
  const root = await createArtifact([
    ...cleanGraph(),
    ["assets/popup-12345678.js.map", "{}"],
  ]);
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /source map emitted: assets\/popup-12345678\.js\.map/u,
  );
});

test("rejects inline source maps including data URLs", async () => {
  const root = await createArtifact(
    cleanGraph().map(([file, contents]) =>
      file === "background.js"
        ? [
            file,
            'import "./assets/background-shared.js";\n//# sourceMappingURL=data:application/json;base64,e30=',
          ]
        : [file, contents],
    ),
  );
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /source map reference: background\.js/u,
  );
});

test("rejects CSS source-map directives including data URLs", async () => {
  const root = await createArtifact(
    cleanGraph().map(([file, contents]) =>
      file === "assets/popup-12345678.css"
        ? [
            file,
            "body { color: black; }\n/*# sourceMappingURL=data:application/json;base64,e30= */",
          ]
        : [file, contents],
    ),
  );
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /source map reference: assets\/popup-12345678\.css/u,
  );
});

test("rejects dynamic and non-local JavaScript imports", async () => {
  const dynamic = await createArtifact(
    cleanGraph().map(([file, contents]) =>
      file === "background.js"
        ? [file, 'import("./assets/background-shared.js");']
        : [file, contents],
    ),
  );
  await assert.rejects(
    verifyExtensionArtifactReachability(dynamic),
    /dynamic import/u,
  );

  const nonLocal = await createArtifact(
    cleanGraph().map(([file, contents]) =>
      file === "background.js"
        ? [file, 'import "remote-sdk";']
        : [file, contents],
    ),
  );
  await assert.rejects(
    verifyExtensionArtifactReachability(nonLocal),
    /non-local static import remote-sdk/u,
  );
});

test("recursively parses imported mjs, cjs, and extensionless executables", async () => {
  for (const [target, source] of [
    ["assets/background-shared.mjs", 'import("./next.js");'],
    ["assets/background-shared.cjs", 'import "remote-sdk";'],
    ["assets/background-shared", 'import("./next.js");'],
  ]) {
    const root = await createArtifact([
      ...cleanGraph()
        .filter(([file]) => file !== "assets/background-shared.js")
        .map(([file, contents]) =>
          file === "background.js"
            ? [file, `import "./${target}";`]
            : [file, contents],
        ),
      [target, source],
    ]);
    await assert.rejects(
      verifyExtensionArtifactReachability(root),
      target.endsWith(".cjs")
        ? /non-local static import remote-sdk/u
        : /dynamic import/u,
    );
  }
});

test("forbids allowlisting an extensionless JavaScript import target", async () => {
  const target = "assets/background-shared";
  const root = await createArtifact([
    ...cleanGraph()
      .filter(([file]) => file !== "assets/background-shared.js")
      .map(([file, contents]) =>
        file === "background.js"
          ? [file, `import "./${target}";`]
          : [file, contents],
      ),
    [target, "export const background = true;"],
  ]);
  await assert.rejects(
    verifyExtensionArtifactReachability(root, {
      localAssetAllowlist: [target],
    }),
    /cannot allow executable, page, or source-map asset/u,
  );
});

test("only permits non-executable local assets through an explicit allowlist", async () => {
  const root = await createArtifact([
    ...cleanGraph(),
    ["icons/lazy.png", "png"],
  ]);
  await assert.rejects(
    verifyExtensionArtifactReachability(root),
    /unreachable local asset requires explicit allowlist: icons\/lazy\.png/u,
  );
  await assert.doesNotReject(
    verifyExtensionArtifactReachability(root, {
      localAssetAllowlist: ["icons/lazy.png"],
    }),
  );
  for (const forbidden of [
    "assets/popup-12345678.js",
    "assets/popup-12345678.css",
    "popup.html",
    "assets/popup-12345678.js.map",
  ]) {
    await assert.rejects(
      verifyExtensionArtifactReachability(root, {
        localAssetAllowlist: [forbidden],
      }),
      /cannot allow executable, page, or source-map asset/u,
    );
  }
});

test("forbids allowlisting mjs and cjs executable assets", async () => {
  for (const file of ["assets/stale.mjs", "assets/stale.cjs"]) {
    const root = await createArtifact([
      ...cleanGraph(),
      [file, "export const stale = true;"],
    ]);
    await assert.rejects(
      verifyExtensionArtifactReachability(root, {
        localAssetAllowlist: [file],
      }),
      /cannot allow executable, page, or source-map asset/u,
    );
  }
});

test("rejects unquoted missing and non-local HTML assets", async () => {
  const missing = await createArtifact(
    cleanGraph().map(([file, contents]) =>
      file === "popup.html"
        ? [
            file,
            `${page("assets/popup-12345678.js", "assets/popup-12345678.css")}<img src=icons/missing.png>`,
          ]
        : [file, contents],
    ),
  );
  await assert.rejects(
    verifyExtensionArtifactReachability(missing),
    /popup\.html references missing local asset icons\/missing\.png/u,
  );

  const remote = await createArtifact(
    cleanGraph().map(([file, contents]) =>
      file === "popup.html"
        ? [
            file,
            `${page("assets/popup-12345678.js", "assets/popup-12345678.css")}<img src=https://example.test/asset.png>`,
          ]
        : [file, contents],
    ),
  );
  await assert.rejects(
    verifyExtensionArtifactReachability(remote),
    /popup\.html references is not a local artifact path/u,
  );
});

test("explicitly removes stale output before the extension build", async () => {
  const root = await createArtifact([["assets/stale.js", "stale"]]);
  await cleanExtensionDist(root);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(root), []);
});
