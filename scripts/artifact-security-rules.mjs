const PRODUCTION_SOURCE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const APPROVED_SOURCE_URLS = new Map([
  [
    "apps/extension/public/manifest.json",
    new Set(["https://chatgpt.com/*", "https://claude.ai:443/*"]),
  ],
  [
    "apps/extension/src/adapters/adapter-catalog.ts",
    new Set(["https://chatgpt.com", "https://claude.ai"]),
  ],
  [
    "apps/extension/src/adapters/chatgpt/chatgpt-adapter.ts",
    new Set(["https://chatgpt.com", "https://claude.ai"]),
  ],
  [
    "apps/extension/src/background/sender-validation.ts",
    new Set(["https://chatgpt.com"]),
  ],
  [
    "apps/extension/src/background/permission-api.ts",
    new Set(["https://claude.ai:443/*"]),
  ],
  ["apps/extension/src/content/bootstrap.ts", new Set(["https://chatgpt.com"])],
  [
    "apps/extension/src/adapters/claude/selectors.ts",
    new Set(["https://claude.ai"]),
  ],
  [
    "apps/extension/src/background/content-registration.ts",
    new Set(["https://claude.ai:443/*"]),
  ],
  [
    "packages/shared-types/src/permissions.ts",
    new Set(["https://claude.ai:443/*"]),
  ],
]);

const SOURCE_FORBIDDEN_PATTERNS = [
  [/\bconsole\.(?:debug|info|log|warn|error)\s*\(/u, "console logging"],
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
    /\bchrome\.(?:tabs|scripting|debugger|webRequest|declarativeNetRequest)\b/u,
    "network-capable Chrome API",
  ],
  [
    /\b(?:registerContentScripts|unregisterContentScripts|getRegisteredContentScripts)\b/u,
    "dynamic content registration",
  ],
  [/\bchrome\s*\[\s*["']scripting["']\s*\]/u, "hidden Chrome API access"],
  [/\bchat-input\b/u, "Claude selector"],
  [
    /\bchrome\.runtime\.(?:connectNative|sendNativeMessage)\b/u,
    "native messaging",
  ],
];

export function isProductionSourceFile(file, extension) {
  if (!PRODUCTION_SOURCE_EXTENSIONS.has(extension)) return false;
  return !(
    file.includes("/tests/") ||
    file.includes("/fixtures/") ||
    /\.(?:test|spec)(?:-d)?\.[cm]?[jt]sx?$/u.test(file) ||
    /(?:^|\/)fixtures\.[cm]?[jt]sx?$/u.test(file)
  );
}

export function inspectProductionSource(file, source) {
  const findings = [];
  for (const [pattern, label] of SOURCE_FORBIDDEN_PATTERNS) {
    const allowedClaudeSelector =
      label === "Claude selector" && file.includes("/adapters/claude/");
    const allowedRegistration =
      label === "dynamic content registration" &&
      (file.endsWith("/background/content-registration.ts") ||
        file.endsWith("/background/chrome-api-adapter.ts"));
    const allowedScriptingApi =
      label === "network-capable Chrome API" &&
      file.endsWith("/background/chrome-api-adapter.ts");
    if (
      pattern.test(source) &&
      !allowedClaudeSelector &&
      !allowedRegistration &&
      !allowedScriptingApi
    ) {
      findings.push(
        `${file} contains forbidden ${label} in production source.`,
      );
    }
  }

  const approvedUrls = APPROVED_SOURCE_URLS.get(file) ?? new Set();
  const urlExpression = /https?:\/\/[^\s"'`<>)\\]+/gu;
  for (const match of source.matchAll(urlExpression)) {
    const literal = match[0].replace(/[;,}\]]+$/gu, "");
    if (!approvedUrls.has(literal)) {
      findings.push(
        `${file} contains an unapproved production-source URL: ${literal}`,
      );
    }
  }
  return findings;
}
