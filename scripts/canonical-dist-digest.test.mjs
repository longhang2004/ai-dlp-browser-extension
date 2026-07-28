import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { canonicalDirectoryDigest } from "./canonical-dist-digest.mjs";

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
