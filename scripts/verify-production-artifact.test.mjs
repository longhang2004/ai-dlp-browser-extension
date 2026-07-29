import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url);
const verifier = new URL("./verify-production-artifact.mjs", import.meta.url);
const digest = new URL("./canonical-dist-digest.mjs", import.meta.url);

const manifest = JSON.stringify({
  manifest_version: 3,
  minimum_chrome_version: "102",
  permissions: ["storage"],
  background: { service_worker: "background.js", type: "module" },
  action: { default_popup: "popup.html" },
  options_page: "options.html",
  content_scripts: [
    {
      matches: ["https://chatgpt.com/*"],
      js: ["content-script.js"],
      run_at: "document_idle",
      all_frames: false,
      world: "ISOLATED",
    },
  ],
  content_security_policy: {
    extension_pages:
      "default-src 'self'; script-src 'self'; object-src 'none'; worker-src 'self'; connect-src 'none';",
  },
});

function page(script, style) {
  return `<!doctype html><link rel="stylesheet" href="${style}"><script type="module" src="${script}"></script>`;
}

function cleanArtifact() {
  return [
    ["manifest.json", manifest],
    ["background.js", "export const background = true;"],
    ["content-script.js", 'var content = "https://react.dev/errors/";'],
    ["popup.html", page("assets/popup-12345678.js", "assets/popup.css")],
    ["options.html", page("assets/options-12345678.js", "assets/options.css")],
    ["audit.html", page("assets/audit-12345678.js", "assets/popup.css")],
    [
      "assets/popup-12345678.js",
      'import "./runtime.js"; export const popup = "https://react.dev/errors/";',
    ],
    ["assets/options-12345678.js", "export const options = true;"],
    ["assets/audit-12345678.js", "export const audit = true;"],
    ["assets/runtime.js", "export const runtime = true;"],
    ["assets/popup.css", "body { color: black; }"],
    ["assets/options.css", "body { color: black; }"],
  ];
}

async function createArtifact(entries = cleanArtifact()) {
  const root = await mkdtemp(join(tmpdir(), "ai-dlp-verify-artifact-"));
  for (const [relativePath, contents] of entries) {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  return root;
}

async function run(command, artifact) {
  try {
    const result = await execFileAsync(process.execPath, [command, artifact], {
      cwd: repositoryRoot,
    });
    return { code: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    return {
      code: error.code ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

test("verify artifact accepts a clean 12-file reachable artifact", async () => {
  const result = await run(verifier.pathname, await createArtifact());
  assert.equal(result.code, 0, result.output);
});

for (const [label, file] of [
  ["orphan JavaScript", "assets/orphan.js"],
  ["orphan CSS", "assets/orphan.css"],
  ["stale prior-build page bundle", "assets/popup-deadbeef.js"],
]) {
  test(`verify artifact rejects ${label}`, async () => {
    const result = await run(
      verifier.pathname,
      await createArtifact([...cleanArtifact(), [file, "stale"]]),
    );
    assert.notEqual(result.code, 0, result.output);
    assert.match(
      result.output,
      new RegExp(
        `unreachable executable or page asset: ${file.replaceAll(".", String.raw`\.`)}`,
        "u",
      ),
    );
  });
}

test("verify artifact rejects a missing imported asset", async () => {
  const result = await run(
    verifier.pathname,
    await createArtifact(
      cleanArtifact().filter(([file]) => file !== "assets/runtime.js"),
    ),
  );
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /imports missing local asset/u);
});

test("canonical digest runs only after reachability passes", async () => {
  const result = await run(
    digest.pathname,
    await createArtifact([
      ...cleanArtifact(),
      ["assets/orphan.js", "export const stale = true;"],
    ]),
  );
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /unreachable executable or page asset/u);
});
