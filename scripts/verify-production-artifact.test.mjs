import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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
      "default-src 'self'; script-src 'self'; object-src 'none'; worker-src 'self'; connect-src 'none'; img-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline';",
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

function artifactWithManifest(update) {
  const candidate = JSON.parse(manifest);
  update(candidate);
  return cleanArtifact().map(([file, contents]) =>
    file === "manifest.json"
      ? [file, `${JSON.stringify(candidate)}\n`]
      : [file, contents],
  );
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

async function run(command, artifact, reportPath) {
  const args = [command, artifact];
  if (reportPath !== undefined) args.push(reportPath);
  try {
    const result = await execFileAsync(process.execPath, args, {
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

async function runVerifier(artifact) {
  const reportDirectory = await mkdtemp(
    join(tmpdir(), "ai-dlp-verify-report-"),
  );
  const reportPath = join(reportDirectory, "url-report.json");
  return {
    reportPath,
    result: await run(verifier.pathname, artifact, reportPath),
  };
}

test("verify artifact accepts a clean 12-file reachable artifact", async () => {
  const { result } = await runVerifier(await createArtifact());
  assert.equal(result.code, 0, result.output);
});

for (const [label, file] of [
  ["orphan JavaScript", "assets/orphan.js"],
  ["orphan CSS", "assets/orphan.css"],
  ["stale prior-build page bundle", "assets/popup-deadbeef.js"],
]) {
  test(`verify artifact rejects ${label}`, async () => {
    const { result } = await runVerifier(
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
  const { result } = await runVerifier(
    await createArtifact(
      cleanArtifact().filter(([file]) => file !== "assets/runtime.js"),
    ),
  );
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /imports missing local asset/u);
});

test("verify artifact rejects optional scripting even without an optional host", async () => {
  const { result } = await runVerifier(
    await createArtifact(
      artifactWithManifest((candidate) => {
        candidate.optional_permissions = ["scripting"];
      }),
    ),
  );
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /optional_permissions/u);
});

test("verify artifact rejects any extension CSP drift", async () => {
  const { result } = await runVerifier(
    await createArtifact(
      artifactWithManifest((candidate) => {
        candidate.content_security_policy.extension_pages +=
          " frame-src 'self';";
      }),
    ),
  );
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /CSP must match/u);
});

test("verify artifact rejects Claude-named bundles and selector literals", async () => {
  const claudeBundle = await runVerifier(
    await createArtifact([
      ...cleanArtifact(),
      ["claude-content-script.js", "var candidate = true;"],
    ]),
  );
  assert.notEqual(claudeBundle.result.code, 0, claudeBundle.result.output);
  assert.match(claudeBundle.result.output, /Claude-named artifact/u);

  const claudeSelector = await runVerifier(
    await createArtifact(
      cleanArtifact().map(([file, contents]) =>
        file === "content-script.js"
          ? [file, 'document.querySelector("[data-testid=chat-input]");']
          : [file, contents],
      ),
    ),
  );
  assert.notEqual(claudeSelector.result.code, 0, claudeSelector.result.output);
  assert.match(claudeSelector.result.output, /Claude selector/u);
});

test("verify artifact rejects bracket-hidden dynamic content registration", async () => {
  const { result } = await runVerifier(
    await createArtifact(
      cleanArtifact().map(([file, contents]) =>
        file === "background.js"
          ? [
              file,
              'chrome["scripting"]["registerContentScripts"]([{ id: "candidate" }]);',
            ]
          : [file, contents],
      ),
    ),
  );
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /dynamic content registration/u);
});

test("verify artifact isolates URL reports for concurrent fixtures", async () => {
  const artifacts = await Promise.all([
    createArtifact(),
    createArtifact(),
    createArtifact(),
  ]);
  const verifications = await Promise.all(
    artifacts.map((artifact) => runVerifier(artifact)),
  );
  for (const { reportPath, result } of verifications) {
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(reportPath, "utf8"))),
      ["schemaVersion", "generatedAt", "artifactRoot", "urls"],
    );
  }
});

test("pnpm build creates and verifies a clean artifact", async () => {
  const result = await execFileAsync("pnpm", ["build"], {
    cwd: repositoryRoot,
  });
  assert.match(result.stdout, /Verified MV3 build topology \(12 files\)\./u);

  const artifactRoot = new URL("./apps/extension/dist/", repositoryRoot);
  const javascriptFiles = (
    await readdir(artifactRoot, { recursive: true })
  ).filter((relativePath) => relativePath.endsWith(".js"));
  const generatedJavascript = (
    await Promise.all(
      javascriptFiles.map((relativePath) =>
        readFile(new URL(relativePath, artifactRoot), "utf8"),
      ),
    )
  ).join("\n");

  assert.equal(
    /promptReplacement:[`"]unsupported[`"]/u.test(generatedJavascript),
    true,
    "Generated JavaScript must package promptReplacement as unsupported.",
  );
  assert.equal(
    /promptReplacement:[`"]verified[`"]/u.test(generatedJavascript),
    false,
    "Generated JavaScript must not package promptReplacement as verified.",
  );
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
