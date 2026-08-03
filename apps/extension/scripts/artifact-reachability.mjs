import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { extname, posix, relative, resolve, sep } from "node:path";

import { inspectJavaScriptImports } from "./build-topology-rules.mjs";

const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const EXECUTABLE_OR_PAGE_EXTENSIONS = new Set([
  ...JAVASCRIPT_EXTENSIONS,
  ".css",
  ".html",
]);

function fail(message) {
  throw new Error(`Invalid production build topology: ${message}`);
}

async function listRegularFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      fail(`symbolic links are forbidden: ${relative(root, path)}`);
    }
    if (metadata.isDirectory()) {
      files.push(...(await listRegularFiles(root, path)));
    } else if (metadata.isFile()) {
      files.push(relative(root, path).split(sep).join("/"));
    } else {
      fail(`non-regular artifact entry: ${relative(root, path)}`);
    }
  }
  return files.sort();
}

function isLocalAssetPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !value.includes("\\") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
  );
}

function resolveReference(
  from,
  value,
  label,
  { allowRootRelative = false } = {},
) {
  const rootRelative =
    allowRootRelative && value.startsWith("/") && !value.startsWith("//");
  if (!rootRelative && !isLocalAssetPath(value)) {
    fail(`${label} is not a local artifact path: ${value}`);
  }
  const pathWithoutQueryOrFragment = value.split(/[?#]/u, 1)[0];
  if (pathWithoutQueryOrFragment === "")
    fail(`${label} is not a local artifact path: ${value}`);
  const resolved = posix.normalize(
    rootRelative
      ? pathWithoutQueryOrFragment.slice(1)
      : posix.join(posix.dirname(from), pathWithoutQueryOrFragment),
  );
  if (resolved === ".." || resolved.startsWith("../")) {
    fail(`${label} escapes the artifact root: ${value}`);
  }
  return resolved;
}

function addIconReferences(manifest, addRoot) {
  for (const value of Object.values(manifest.icons ?? {})) {
    if (typeof value === "string") addRoot(value, "Manifest icon");
  }
  for (const key of ["action", "browser_action", "page_action"]) {
    const icon = manifest[key]?.default_icon;
    if (typeof icon === "string") addRoot(icon, `${key} icon`);
    else if (icon !== null && typeof icon === "object") {
      for (const value of Object.values(icon)) {
        if (typeof value === "string") addRoot(value, `${key} icon`);
      }
    }
  }
}

function collectManifestRoots(manifest, addRoot) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest)
  ) {
    fail("manifest.json must contain an object");
  }
  addRoot("manifest.json", "Artifact manifest");
  addRoot(manifest.background?.service_worker, "Manifest background worker", {
    executable: true,
  });
  addRoot(manifest.action?.default_popup, "Manifest popup page");
  addRoot(manifest.options_page, "Manifest options page");
  addRoot("audit.html", "Required audit page");
  for (const contentScript of manifest.content_scripts ?? []) {
    for (const file of contentScript?.js ?? []) {
      addRoot(file, "Manifest content script", { executable: true });
    }
    for (const file of contentScript?.css ?? []) {
      addRoot(file, "Manifest content stylesheet");
    }
  }
  addIconReferences(manifest, addRoot);
}

function collectHtmlReferences(file, source, addReference) {
  for (const tag of source.matchAll(/<([A-Za-z][A-Za-z0-9:-]*)\b([^>]*)>/gu)) {
    const tagName = tag[1]?.toLowerCase();
    const attributes = tag[2] ?? "";
    for (const attribute of attributes.matchAll(
      /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu,
    )) {
      const value = attribute[1] ?? attribute[2] ?? attribute[3];
      if (value === undefined || value.startsWith("#")) continue;
      addReference(file, value, `${file} references`, {
        allowRootRelative: true,
        executable: tagName === "script",
      });
    }
  }
}

function validateAllowlist(localAssetAllowlist, files) {
  if (!Array.isArray(localAssetAllowlist)) {
    fail("local asset allowlist must be an array");
  }
  const allowed = new Set();
  for (const value of localAssetAllowlist) {
    const file = resolveReference(
      "manifest.json",
      value,
      "Local asset allowlist entry",
    );
    if (
      EXECUTABLE_OR_PAGE_EXTENSIONS.has(extname(file)) ||
      file.endsWith(".map")
    ) {
      fail(
        `local asset allowlist cannot allow executable, page, or source-map asset: ${file}`,
      );
    }
    if (!files.has(file)) {
      fail(`local asset allowlist references missing asset: ${file}`);
    }
    allowed.add(file);
  }
  return allowed;
}

export async function verifyExtensionArtifactReachability(
  directory,
  { localAssetAllowlist = [] } = {},
) {
  const root = resolve(directory);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("artifact root must be a real directory");
  }
  const files = new Set(await listRegularFiles(root));
  if (files.has("manifest.json") === false) fail("manifest.json is missing");
  for (const file of files) {
    if (file.endsWith(".map")) fail(`source map emitted: ${file}`);
  }
  const allowed = validateAllowlist(localAssetAllowlist, files);
  const manifest = JSON.parse(
    await readFile(resolve(root, "manifest.json"), "utf8"),
  );
  const reachable = new Set();
  const executableReferences = new Set();
  const pending = [];
  const addReference = (from, value, label, options) => {
    const target = resolveReference(from, value, label, options);
    if (!files.has(target)) fail(`${label} missing local asset ${target}`);
    if (options?.executable) {
      if (allowed.has(target)) {
        fail(
          `local asset allowlist cannot allow executable, page, or source-map asset: ${target}`,
        );
      }
      executableReferences.add(target);
    }
    if (!reachable.has(target)) pending.push(target);
  };
  const addRoot = (value, label, options) =>
    addReference("manifest.json", value, label, options);

  collectManifestRoots(manifest, addRoot);
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || reachable.has(file)) continue;
    reachable.add(file);
    if (file.endsWith(".html")) {
      collectHtmlReferences(
        file,
        await readFile(resolve(root, file), "utf8"),
        addReference,
      );
    }
    const isJavaScript =
      JAVASCRIPT_EXTENSIONS.has(extname(file)) ||
      executableReferences.has(file);
    if (isJavaScript || file.endsWith(".css")) {
      const source = await readFile(resolve(root, file), "utf8");
      if (/\/(?:\/|\*)[#@]\s*sourceMappingURL\s*=/u.test(source)) {
        fail(`source map reference: ${file}`);
      }
      if (!isJavaScript) continue;
      const imports = inspectJavaScriptImports(source);
      for (const specifier of imports.staticSpecifiers) {
        addReference(file, specifier, `${file} imports`, { executable: true });
      }
    }
  }
  for (const file of files) {
    if (reachable.has(file) || allowed.has(file)) continue;
    if (EXECUTABLE_OR_PAGE_EXTENSIONS.has(extname(file))) {
      fail(`unreachable executable or page asset: ${file}`);
    }
    fail(`unreachable local asset requires explicit allowlist: ${file}`);
  }
  return { files: [...files].sort(), reachable: [...reachable].sort() };
}

export async function cleanExtensionDist(directory) {
  const root = resolve(directory);
  await rm(root, { force: true, recursive: true });
  await mkdir(root, { recursive: true });
}
