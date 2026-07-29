import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  canonicalDirectoryDigest,
  canonicalExtensionDigest,
} from "./canonical-dist-digest.mjs";

async function createFixture(entries) {
  const root = await mkdtemp(join(tmpdir(), "ai-dlp-digest-"));
  for (const [relativePath, contents] of entries) {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return root;
}

test("is stable across filesystem creation order", async () => {
  const first = await createFixture([
    ["manifest.json", '{"version":"0.1.0"}'],
    ["assets/content.js", "first"],
  ]);
  const second = await createFixture([
    ["assets/content.js", "first"],
    ["manifest.json", '{"version":"0.1.0"}'],
  ]);

  assert.equal(
    await canonicalDirectoryDigest(first),
    await canonicalDirectoryDigest(second),
  );
});

test("binds both relative paths and file bytes", async () => {
  const baseline = await createFixture([["assets/content.js", "first"]]);
  const renamed = await createFixture([["assets/renamed.js", "first"]]);
  const changed = await createFixture([["assets/content.js", "second"]]);

  const baselineDigest = await canonicalDirectoryDigest(baseline);
  assert.notEqual(baselineDigest, await canonicalDirectoryDigest(renamed));
  assert.notEqual(baselineDigest, await canonicalDirectoryDigest(changed));
  assert.match(baselineDigest, /^[a-f0-9]{64}$/u);
});

test("rejects symlinks instead of hashing content outside the artifact", async () => {
  const root = await createFixture([["manifest.json", "{}"]]);
  await symlink(join(root, "manifest.json"), join(root, "manifest-link.json"));

  await assert.rejects(
    canonicalDirectoryDigest(root),
    /regular files and directories/u,
  );
});

test("refuses to hash an artifact with unreachable executable assets", async () => {
  const root = await createFixture([
    [
      "manifest.json",
      JSON.stringify({
        manifest_version: 3,
        background: { service_worker: "background.js", type: "module" },
        action: { default_popup: "popup.html" },
        options_page: "options.html",
        content_scripts: [{ js: ["content-script.js"] }],
      }),
    ],
    ["background.js", "export const background = true;"],
    ["content-script.js", "var content = true;"],
    ["popup.html", '<script src="popup.js"></script>'],
    ["options.html", '<script src="options.js"></script>'],
    ["audit.html", '<script src="audit.js"></script>'],
    ["popup.js", "export const popup = true;"],
    ["options.js", "export const options = true;"],
    ["audit.js", "export const audit = true;"],
    ["stale.js", "export const stale = true;"],
  ]);

  await assert.rejects(
    canonicalExtensionDigest(root),
    /unreachable executable or page asset: stale\.js/u,
  );
});

test("refuses to hash an artifact with an inline source-map reference", async () => {
  const root = await createFixture([
    [
      "manifest.json",
      JSON.stringify({
        manifest_version: 3,
        background: { service_worker: "background.js", type: "module" },
        action: { default_popup: "popup.html" },
        options_page: "options.html",
        content_scripts: [{ js: ["content-script.js"] }],
      }),
    ],
    [
      "background.js",
      "export const background = true;\n//# sourceMappingURL=data:application/json;base64,e30=",
    ],
    ["content-script.js", "var content = true;"],
    ["popup.html", '<script src="popup.js"></script>'],
    ["options.html", '<script src="options.js"></script>'],
    ["audit.html", '<script src="audit.js"></script>'],
    ["popup.js", "export const popup = true;"],
    ["options.js", "export const options = true;"],
    ["audit.js", "export const audit = true;"],
  ]);

  await assert.rejects(
    canonicalExtensionDigest(root),
    /source map reference: background\.js/u,
  );
});

test("refuses to hash an artifact with a CSS source-map reference", async () => {
  const root = await createFixture([
    [
      "manifest.json",
      JSON.stringify({
        manifest_version: 3,
        background: { service_worker: "background.js", type: "module" },
        action: { default_popup: "popup.html" },
        options_page: "options.html",
        content_scripts: [{ js: ["content-script.js"] }],
      }),
    ],
    ["background.js", "export const background = true;"],
    ["content-script.js", "var content = true;"],
    ["popup.html", '<link href="popup.css"><script src="popup.js"></script>'],
    ["options.html", '<script src="options.js"></script>'],
    ["audit.html", '<script src="audit.js"></script>'],
    [
      "popup.css",
      "body {}\n/*# sourceMappingURL=data:application/json;base64,e30= */",
    ],
    ["popup.js", "export const popup = true;"],
    ["options.js", "export const options = true;"],
    ["audit.js", "export const audit = true;"],
  ]);

  await assert.rejects(
    canonicalExtensionDigest(root),
    /source map reference: popup\.css/u,
  );
});
