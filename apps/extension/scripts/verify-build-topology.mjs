import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectJavaScriptImports } from "./build-topology-rules.mjs";

const extensionRoot = new URL("../", import.meta.url);
const distRoot = new URL("dist/", extensionRoot);

function fail(message) {
  throw new Error(`Invalid production build topology: ${message}`);
}

async function listFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await listFiles(path, files);
    else files.push(path);
  }
  return files;
}

const manifest = JSON.parse(
  await readFile(new URL("manifest.json", distRoot), "utf8"),
);

if (
  manifest.manifest_version !== 3 ||
  manifest.minimum_chrome_version !== "102"
) {
  fail("manifest version or minimum Chrome version changed");
}
if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage"])) {
  fail("permissions must contain only storage");
}
for (const forbidden of [
  "host_permissions",
  "optional_host_permissions",
  "externally_connectable",
  "sandbox",
  "web_accessible_resources",
]) {
  if (Object.hasOwn(manifest, forbidden))
    fail(`manifest contains ${forbidden}`);
}
if (
  manifest.background?.service_worker !== "background.js" ||
  manifest.background?.type !== "module"
) {
  fail("background service worker is not the stable module entry");
}
const content = manifest.content_scripts;
if (
  !Array.isArray(content) ||
  content.length !== 1 ||
  JSON.stringify(content[0]?.matches) !==
    JSON.stringify(["https://chatgpt.com/*"]) ||
  JSON.stringify(content[0]?.js) !== JSON.stringify(["content-script.js"]) ||
  content[0]?.run_at !== "document_idle" ||
  content[0]?.all_frames !== false ||
  content[0]?.world !== "ISOLATED"
) {
  fail("content-script registration changed");
}
const csp = manifest.content_security_policy?.extension_pages;
for (const directive of [
  "script-src 'self'",
  "object-src 'none'",
  "worker-src 'self'",
  "connect-src 'none'",
]) {
  if (typeof csp !== "string" || !csp.includes(directive)) {
    fail(`CSP is missing ${directive}`);
  }
}

const distPath = fileURLToPath(distRoot);
const files = await listFiles(distPath);
if (files.some((file) => extname(file) === ".map")) fail("source map emitted");
for (const required of [
  "manifest.json",
  "background.js",
  "content-script.js",
  "popup.html",
  "options.html",
  "audit.html",
]) {
  if (!files.some((file) => relative(distPath, file) === required)) {
    fail(`${required} is missing`);
  }
}

const contentSource = await readFile(
  new URL("content-script.js", distRoot),
  "utf8",
);
const contentImports = inspectJavaScriptImports(contentSource);
if (contentImports.staticSpecifiers.length > 0) {
  fail("content script contains an ESM import");
}
if (!/^var AiDlpContentScript=/u.test(contentSource)) {
  fail("content script is not a self-contained IIFE");
}

for (const page of ["popup.html", "options.html", "audit.html"]) {
  const html = await readFile(new URL(page, distRoot), "utf8");
  if (
    /<script(?![^>]*\bsrc=)[^>]*>/iu.test(html) ||
    /\son\w+\s*=/iu.test(html)
  ) {
    fail(`${page} contains inline executable markup`);
  }
  for (const reference of html.matchAll(/(?:src|href)="([^"]+)"/gu)) {
    const value = reference[1];
    if (value?.startsWith("http:") || value?.startsWith("https:")) {
      fail(`${page} contains a remote asset`);
    }
    if (value?.startsWith("/assets/")) {
      const asset = value.slice(1);
      if (!/^assets\/.+-[A-Za-z0-9_-]{8}\.(?:css|js)$/u.test(asset)) {
        fail(`${page} references an unhashed page asset`);
      }
      if (!files.some((file) => relative(distPath, file) === asset)) {
        fail(`${page} references missing local asset ${asset}`);
      }
    }
  }
}

const backgroundSource = await readFile(
  new URL("background.js", distRoot),
  "utf8",
);
const backgroundImports = inspectJavaScriptImports(backgroundSource);
for (const specifier of backgroundImports.staticSpecifiers) {
  const referenced = fileURLToPath(
    new URL(specifier, new URL("background.js", distRoot)),
  );
  if (!files.includes(referenced)) {
    fail(`background imports missing local module ${specifier}`);
  }
}

console.log(`Verified MV3 build topology (${files.length} files).`);
