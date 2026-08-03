import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectProductionSource,
  isProductionSourceFile,
} from "./artifact-security-rules.mjs";
import { verifyExtensionArtifactReachability } from "../apps/extension/scripts/artifact-reachability.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const distRoot = resolve(
  repositoryRoot,
  process.argv[2] ?? "apps/extension/dist",
);
const manifestPath = resolve(distRoot, "manifest.json");
const fixturesPath = resolve(
  repositoryRoot,
  "tests/fixtures/sensitive-values.json",
);
const allowlistPath = resolve(
  repositoryRoot,
  "scripts/artifact-url-allowlist.json",
);
const reportPath = resolve(
  repositoryRoot,
  process.argv[3] ?? "artifacts/verification/url-report.json",
);
const LOCKED_EXTENSION_CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; worker-src 'self'; connect-src 'none'; img-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline';";

const failures = [];
const referencedFiles = new Set(["manifest.json"]);
const productionSourceRoots = [
  "apps/extension/src",
  "apps/extension/public",
  "packages/shared-types/src",
  "packages/detectors/src",
  "packages/policy-engine/src",
];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`${label} could not be parsed: ${String(error)}`);
    return undefined;
  }
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join("/"));
    }
  }
  return files.sort();
}

function addReference(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} is missing or invalid.`);
    return;
  }
  if (
    value.startsWith("/") ||
    value.includes("..") ||
    value.includes("\\") ||
    /^https?:/iu.test(value)
  ) {
    fail(`${label} is not a local artifact path: ${value}`);
    return;
  }
  referencedFiles.add(value);
}

function collectFixtureStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectFixtureStrings(item, output);
  } else if (isPlainObject(value)) {
    if (
      Object.keys(value).length === 1 &&
      Array.isArray(value.parts) &&
      value.parts.every((part) => typeof part === "string")
    ) {
      output.push(value.parts.join(""));
    }
    for (const item of Object.values(value))
      collectFixtureStrings(item, output);
  }
  return output;
}

function wildcardMatches(pattern, value) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`, "u").test(value);
}

function parseAllowlist(value) {
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.entries)
  ) {
    fail("Artifact URL allowlist has an invalid envelope.");
    return [];
  }
  const seen = new Set();
  const entries = [];
  for (const candidate of value.entries) {
    if (
      !isPlainObject(candidate) ||
      Object.keys(candidate).sort().join(",") !==
        "classification,filePattern,justification,literal" ||
      typeof candidate.literal !== "string" ||
      !candidate.literal.startsWith("http") ||
      typeof candidate.filePattern !== "string" ||
      typeof candidate.classification !== "string" ||
      typeof candidate.justification !== "string" ||
      candidate.justification.trim().length < 20
    ) {
      fail("Artifact URL allowlist contains an invalid entry.");
      continue;
    }
    const key = `${candidate.literal}\0${candidate.filePattern}`;
    if (seen.has(key)) {
      fail(
        `Artifact URL allowlist contains a duplicate entry: ${candidate.literal}`,
      );
      continue;
    }
    seen.add(key);
    entries.push({ ...candidate, used: false });
  }
  return entries;
}

function urlOccurrences(file, source) {
  const occurrences = [];
  const expression = /https?:\/\/[^\s"'`<>)\\]+/gu;
  for (const match of source.matchAll(expression)) {
    const index = match.index;
    let literal = match[0].replace(/[;,}\]]+$/gu, "");
    if (
      literal.endsWith("/*/") &&
      !source.slice(index, index + literal.length).endsWith("/*/")
    ) {
      literal = literal.slice(0, -1);
    }
    occurrences.push({
      literal,
      generatedFile: file,
      index,
      surroundingCode: source.slice(
        Math.max(0, index - 160),
        Math.min(source.length, index + literal.length + 160),
      ),
    });
  }
  return occurrences;
}

function classifyUrl(occurrence, allowlist) {
  const { literal, generatedFile, surroundingCode } = occurrence;
  const standardNamespaces = new Set([
    "http://www.w3.org/1999/xhtml",
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1998/Math/MathML",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/XML/1998/namespace",
  ]);
  if (standardNamespaces.has(literal)) {
    return {
      ...occurrence,
      classification: "standard_namespace_identifier",
      executableOrFetching: false,
      allowlistJustification: null,
    };
  }
  if (
    generatedFile === "manifest.json" &&
    literal === "https://chatgpt.com/*"
  ) {
    return {
      ...occurrence,
      classification: "required_content_script_match_pattern",
      executableOrFetching: false,
      allowlistJustification:
        "Static manifest scope only; it does not initiate a network request.",
    };
  }
  if (literal === "https://chatgpt.com") {
    return {
      ...occurrence,
      classification: "required_application_origin_identifier",
      executableOrFetching: false,
      allowlistJustification:
        "Exact ChatGPT origin comparison only; it does not initiate a network request.",
    };
  }

  const fetchingContext =
    /(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\b(?:src|href)\s*=|import\s*\()/u.test(
      surroundingCode,
    );
  if (fetchingContext) {
    return {
      ...occurrence,
      classification: "executable_or_fetching_remote_url",
      executableOrFetching: true,
      allowlistJustification: null,
    };
  }

  const entry = allowlist.find(
    (candidate) =>
      candidate.literal === literal &&
      wildcardMatches(candidate.filePattern, generatedFile),
  );
  if (entry !== undefined) {
    entry.used = true;
    return {
      ...occurrence,
      classification: entry.classification,
      executableOrFetching: false,
      allowlistJustification: entry.justification,
    };
  }
  return {
    ...occurrence,
    classification: "unreviewed_remote_url",
    executableOrFetching: false,
    allowlistJustification: null,
  };
}

function validateManifest(manifest) {
  if (!isPlainObject(manifest)) return;
  assert(manifest.manifest_version === 3, "Manifest must use version 3.");
  assert(
    manifest.minimum_chrome_version === "102",
    "Minimum Chrome must be 102.",
  );
  assert(
    JSON.stringify(manifest.permissions) === JSON.stringify(["storage"]),
    "Manifest permissions must contain only storage.",
  );
  for (const forbidden of [
    "host_permissions",
    "optional_permissions",
    "optional_host_permissions",
    "externally_connectable",
    "sandbox",
    "web_accessible_resources",
  ]) {
    assert(!(forbidden in manifest), `Manifest must not contain ${forbidden}.`);
  }
  assert(
    isPlainObject(manifest.background) &&
      manifest.background.service_worker === "background.js" &&
      manifest.background.type === "module",
    "Manifest background worker topology is invalid.",
  );
  addReference(manifest.background?.service_worker, "Background worker");
  addReference(manifest.action?.default_popup, "Default popup");
  addReference(manifest.options_page, "Options page");

  assert(
    Array.isArray(manifest.content_scripts) &&
      manifest.content_scripts.length === 1,
    "Manifest must contain exactly one content script definition.",
  );
  const content = manifest.content_scripts?.[0];
  assert(
    isPlainObject(content) &&
      JSON.stringify(content.matches) ===
        JSON.stringify(["https://chatgpt.com/*"]) &&
      JSON.stringify(content.js) === JSON.stringify(["content-script.js"]) &&
      content.run_at === "document_idle" &&
      content.all_frames === false &&
      content.world === "ISOLATED",
    "Content script manifest scope or topology is invalid.",
  );
  if (Array.isArray(content?.js)) {
    for (const file of content.js) addReference(file, "Content script");
  }

  const csp = manifest.content_security_policy?.extension_pages;
  assert(
    csp === LOCKED_EXTENSION_CSP,
    "Extension page CSP must match the locked M2.0 policy.",
  );
  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "object-src 'none'",
    "worker-src 'self'",
    "connect-src 'none'",
  ]) {
    assert(
      csp?.includes(directive),
      `Extension page CSP is missing ${directive}.`,
    );
  }
  assert(!csp?.includes("'unsafe-eval'"), "Extension CSP permits unsafe-eval.");
  assert(
    !csp?.includes("http:"),
    "Extension CSP permits remote HTTP resources.",
  );
  assert(
    !csp?.includes("https:"),
    "Extension CSP permits remote HTTPS resources.",
  );
}

function inspectHtml(file, source) {
  if (/\son[a-z]+\s*=/iu.test(source)) {
    fail(`${file} contains an inline event handler.`);
  }
  for (const match of source.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/giu,
  )) {
    const attributes = match[1] ?? "";
    const sourceMatch = attributes.match(/\bsrc=["']([^"']+)["']/iu);
    if (sourceMatch?.[1] === undefined) {
      fail(`${file} contains an inline script.`);
    } else {
      addReference(sourceMatch[1].replace(/^\.?\/+?/u, ""), `${file} script`);
    }
  }
  for (const match of source.matchAll(
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/giu,
  )) {
    const target = match[1];
    if (target !== undefined)
      addReference(target.replace(/^\.?\/+?/u, ""), `${file} link`);
  }
  if (/(?:src|href)=["']https?:\/\//iu.test(source)) {
    fail(`${file} contains a remote asset reference.`);
  }
}

function inspectJavaScript(file, source) {
  const forbiddenPatterns = [
    [/\beval\s*\(/u, "eval"],
    [/\bnew\s+Function\b/u, "new Function"],
    [/\bFunction\s*\(/u, "Function constructor"],
    [/\b(?:setTimeout|setInterval)\s*\(\s*["'`]/u, "string timer"],
    [/\bfetch\s*\(/u, "fetch"],
    [/\bXMLHttpRequest\b/u, "XMLHttpRequest"],
    [/\bWebSocket\b/u, "WebSocket"],
    [/\bEventSource\b/u, "EventSource"],
    [/\bsendBeacon\s*\(/u, "sendBeacon"],
    [/\bimportScripts\s*\(/u, "importScripts"],
    [
      /\bchrome\.(?:tabs|scripting|debugger|webRequest)\b/u,
      "network-capable Chrome API",
    ],
    [
      /\b(?:registerContentScripts|unregisterContentScripts|getRegisteredContentScripts)\b/u,
      "dynamic content registration",
    ],
    [/\bchat-input\b/u, "Claude selector"],
    [/(?:^|["'`/])tests?\//u, "test import"],
    [/\.(?:test|spec)\.[cm]?[jt]sx?\b/u, "test module"],
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(source)) fail(`${file} contains forbidden ${label} code.`);
  }
  if (
    (file === "background.js" || file === "content-script.js") &&
    /\bimport\s*\(/u.test(source)
  ) {
    fail(`${file} contains a dynamic import.`);
  }
  if (file === "content-script.js" && /^\s*import\b/mu.test(source)) {
    fail(
      "content-script.js contains a static import and is not self-contained.",
    );
  }
  if (/\/\/# sourceMappingURL=/u.test(source)) {
    fail(`${file} contains a source-map reference.`);
  }
  if (
    /\bconsole\.(?:debug|info|log|warn|error)\s*\([^)]*(?:matchedText|redactedText|promptSnapshot|composer\.value|readPrompt)/u.test(
      source,
    )
  ) {
    fail(`${file} contains a prompt-derived logging path.`);
  }
}

function inspectCss(file, source) {
  if (/@import\b/iu.test(source)) {
    fail(`${file} contains a CSS import.`);
  }
  if (/url\(\s*["']?https?:\/\//iu.test(source)) {
    fail(`${file} contains a remote CSS asset.`);
  }
}

const manifest = await readJson(manifestPath, "Generated manifest");
const fixtures = await readJson(fixturesPath, "Sensitive fixture file");
const allowlistEnvelope = await readJson(
  allowlistPath,
  "Artifact URL allowlist",
);
const allowlist = parseAllowlist(allowlistEnvelope);
validateManifest(manifest);

for (const sourceRoot of productionSourceRoots) {
  const absoluteRoot = resolve(repositoryRoot, sourceRoot);
  let sourceFiles;
  try {
    sourceFiles = await listFiles(absoluteRoot);
  } catch (error) {
    fail(
      `Production source root could not be listed: ${sourceRoot}: ${String(error)}`,
    );
    continue;
  }
  for (const relativeFile of sourceFiles) {
    const file = `${sourceRoot}/${relativeFile}`;
    if (!isProductionSourceFile(file, extname(file))) continue;
    const source = await readFile(resolve(absoluteRoot, relativeFile), "utf8");
    for (const finding of inspectProductionSource(file, source)) fail(finding);
  }
}

let files = [];
try {
  files = await listFiles(distRoot);
} catch (error) {
  fail(`Production artifact could not be listed: ${String(error)}`);
}

for (const file of files) {
  if (/(?:^|\/)claude[^/]*\.(?:[cm]?js|css|html)$/iu.test(file)) {
    fail(`Claude-named artifact is forbidden in M2.0: ${file}`);
  }
}

try {
  await verifyExtensionArtifactReachability(distRoot);
} catch (error) {
  fail(String(error));
}

assert(files.length > 0, "Production artifact is empty.");
for (const file of files) {
  if (file.endsWith(".map")) fail(`Production source map found: ${file}`);
  if (/\.(?:test|spec)\./u.test(file) || file.includes("fixtures")) {
    fail(`Test or fixture file found in production artifact: ${file}`);
  }
}

const sources = new Map();
for (const file of files) {
  if (![".html", ".js", ".json", ".css"].includes(extname(file))) continue;
  const source = await readFile(resolve(distRoot, file), "utf8");
  sources.set(file, source);
  if (file.endsWith(".html")) inspectHtml(file, source);
  if (file.endsWith(".js")) inspectJavaScript(file, source);
  if (file.endsWith(".css")) inspectCss(file, source);
}

for (const file of referencedFiles) {
  assert(
    files.includes(file),
    `Referenced production file is missing: ${file}`,
  );
}

const fixtureStrings = collectFixtureStrings(fixtures).filter(
  (value) => value.length >= 6,
);
for (const [file, source] of sources) {
  for (const value of fixtureStrings) {
    if (source.includes(value)) {
      fail(`${file} embeds dedicated secret fixture data.`);
    }
  }
}

const extensionPackage = await readJson(
  resolve(repositoryRoot, "apps/extension/package.json"),
  "Extension package manifest",
);
const dependencies = Object.keys(extensionPackage?.dependencies ?? {}).sort();
assert(
  JSON.stringify(dependencies) ===
    JSON.stringify([
      "@ai-dlp/detectors",
      "@ai-dlp/policy-engine",
      "@ai-dlp/shared-types",
      "react",
      "react-dom",
    ]),
  `Unexpected production dependencies: ${dependencies.join(", ")}`,
);

const urlReport = [];
for (const [file, source] of sources) {
  for (const occurrence of urlOccurrences(file, source)) {
    const classified = classifyUrl(occurrence, allowlist);
    urlReport.push(classified);
    if (classified.executableOrFetching) {
      fail(
        `${file} contains an executable or fetching URL: ${classified.literal}`,
      );
    } else if (classified.classification === "unreviewed_remote_url") {
      fail(`${file} contains an unreviewed URL: ${classified.literal}`);
    }
  }
}
for (const entry of allowlist) {
  if (!entry.used) {
    fail(
      `Unused artifact URL allowlist entry: ${entry.literal} in ${entry.filePattern}`,
    );
  }
}

await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      artifactRoot: relative(repositoryRoot, distRoot),
      urls: urlReport,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

if (failures.length > 0) {
  console.error("Production artifact verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`URL report: ${relative(repositoryRoot, reportPath)}`);
  process.exitCode = 1;
} else {
  console.log(
    `Production artifact verified: ${files.length} files, ${urlReport.length} URL literals reviewed.`,
  );
  console.log(`URL report: ${relative(repositoryRoot, reportPath)}`);
}
