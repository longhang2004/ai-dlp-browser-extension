import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { chromium } from "@playwright/test";

const PATTERN = "https://claude.ai:443/*";
const DEFAULT_PORT_URL = "https://claude.ai:443/promptguard-proof-default";
const ALTERNATE_PORT_URL = "https://claude.ai:8443/promptguard-proof-alternate";
const REGISTRATION_ID = "promptguard-proof-claude-v1";
const BROWSERS = Object.freeze({
  chrome: { label: "Google Chrome", channel: "chrome" },
  edge: { label: "Microsoft Edge", channel: "msedge" },
});

function extensionManifest() {
  return {
    manifest_version: 3,
    name: "PromptGuard permission proof",
    version: "1.0.0",
    permissions: ["storage"],
    optional_permissions: ["scripting"],
    optional_host_permissions: [PATTERN],
    background: { service_worker: "background.js" },
    action: { default_title: "PromptGuard permission proof" },
  };
}

function bootstrapExtensionManifest() {
  return {
    manifest_version: 3,
    name: "PromptGuard permission proof",
    version: "1.0.0",
    permissions: ["storage", "scripting"],
    host_permissions: [PATTERN],
    background: { service_worker: "background.js" },
    action: { default_title: "PromptGuard permission proof" },
  };
}

const backgroundSource = `
const pattern = ${JSON.stringify(PATTERN)};
const registrationId = ${JSON.stringify(REGISTRATION_ID)};
const injectionEvents = [];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === "register") {
        await chrome.scripting.unregisterContentScripts({ ids: [registrationId] }).catch(() => undefined);
        await chrome.scripting.registerContentScripts([{
          id: registrationId,
          matches: [pattern],
          js: ["content.js"],
          allFrames: false,
          world: "ISOLATED",
          runAt: "document_idle",
          persistAcrossSessions: true,
        }]);
        const registrations = await chrome.scripting.getRegisteredContentScripts({ ids: [registrationId] });
        sendResponse({ ok: true, registered: registrations.length === 1 && registrations[0].matches?.[0] === pattern });
        return;
      }
      if (message?.type === "injected") {
        if (typeof message.origin === "string" && typeof message.port === "string") {
          injectionEvents.push({ origin: message.origin, port: message.port });
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "snapshot") {
        const registrations = await chrome.scripting.getRegisteredContentScripts({ ids: [registrationId] }).catch(() => []);
        sendResponse({ events: injectionEvents.map((event) => ({ ...event })), registrationCount: registrations.length });
        return;
      }
      if (message?.type === "cleanup") {
        await chrome.scripting.unregisterContentScripts({ ids: [registrationId] }).catch(() => undefined);
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
  })();
  return true;
});
`;

const contentSource = `
void chrome.runtime.sendMessage({
  type: "injected",
  origin: location.origin,
  port: location.port,
});
`;

const proofPageSource = `
const pattern = ${JSON.stringify(PATTERN)};

async function run(id, operation) {
  const output = document.querySelector("#result-" + id);
  if (!(output instanceof HTMLElement)) throw new Error("Missing proof output");
  output.dataset.done = "false";
  try {
    const value = await operation();
    output.dataset.value = JSON.stringify({ ok: true, value });
  } catch (error) {
    output.dataset.value = JSON.stringify({ ok: false, error: String(error) });
  }
  output.dataset.done = "true";
}

document.querySelector("#request").addEventListener("click", () => run("request", () => chrome.permissions.request({ permissions: ["scripting"], origins: [pattern] })));
document.querySelector("#contains").addEventListener("click", () => run("contains", () => chrome.permissions.contains({ permissions: ["scripting"], origins: [pattern] })));
document.querySelector("#register").addEventListener("click", () => run("register", () => chrome.runtime.sendMessage({ type: "register" })));
document.querySelector("#remove").addEventListener("click", () => run("remove", () => chrome.permissions.remove({ permissions: ["scripting"], origins: [pattern] })));
`;

const proofPageHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>PromptGuard browser permission proof</title></head>
  <body>
    <h1>PromptGuard browser permission proof</h1>
    <button id="request" type="button">Request permissions</button>
    <button id="contains" type="button">Check permissions</button>
    <button id="register" type="button">Register content script</button>
    <button id="remove" type="button">Remove permissions</button>
    <output id="result-request" data-done="false"></output>
    <output id="result-contains" data-done="false"></output>
    <output id="result-register" data-done="false"></output>
    <output id="result-remove" data-done="false"></output>
    <script src="proof-page.js"></script>
  </body>
</html>`;

const fixtureHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Permission fixture</title></head>
<body><main><h1>Permission fixture</h1></main></body></html>`;

async function clickAndRead(page, id) {
  const output = page.locator(`#result-${id}`);
  await page.locator(`#${id}`).click();
  await page.waitForFunction(
    (outputId) =>
      globalThis.document
        .querySelector(`#result-${outputId}`)
        ?.getAttribute("data-done") === "true",
    id,
  );
  const encoded = await output.getAttribute("data-value");
  if (encoded === null) throw new Error(`Missing proof result: ${id}`);
  return JSON.parse(encoded);
}

async function runtimeSnapshot(page) {
  return page.evaluate(() =>
    globalThis.chrome.runtime.sendMessage({ type: "snapshot" }),
  );
}

async function waitForInjected(page, expectedOrigin) {
  await page.waitForFunction(
    async (origin) => {
      const snapshot = await globalThis.chrome.runtime.sendMessage({
        type: "snapshot",
      });
      return snapshot.events?.some((event) => event.origin === origin) === true;
    },
    expectedOrigin,
    { timeout: 5_000 },
  );
}

async function browserControlGeometry(page, browserKey, controlName) {
  return page.evaluate(
    ({ browser, control }) => {
      let element;
      if (browser === "edge") {
        const root = globalThis.document.querySelector("root-app")?.shadowRoot;
        if (control === "devMode") {
          const sideNav = root?.querySelector("side-nav-pane")?.shadowRoot;
          const profile = sideNav?.querySelector("profile-toggles")?.shadowRoot;
          element = profile
            ?.querySelector("developer-mode-switch")
            ?.shadowRoot?.querySelector("#dev-switch");
        } else {
          const extensionPage =
            root?.querySelector("my-extension-page")?.shadowRoot;
          const header = extensionPage?.querySelector(
            "developer-mode-options-header",
          )?.shadowRoot;
          element = [...(header?.querySelectorAll("fluent-button") ?? [])].find(
            (button) => button.getAttribute("title") === "Load Unpacked",
          );
        }
      } else {
        const manager = globalThis.document.querySelector("extensions-manager");
        const toolbar =
          manager?.shadowRoot?.querySelector("extensions-toolbar");
        element = toolbar?.shadowRoot?.querySelector(
          control === "devMode" ? "#devMode" : "#loadUnpacked",
        );
      }
      if (!(element instanceof globalThis.HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        pressed: element.getAttribute("aria-pressed"),
        checked: element.getAttribute("checked"),
      };
    },
    { browser: browserKey, control: controlName },
  );
}

async function clickBrowserControl(page, browserKey, controlName) {
  const geometry = await browserControlGeometry(page, browserKey, controlName);
  if (geometry === null || geometry.width === 0 || geometry.height === 0) {
    throw new Error(`Browser control is unavailable: ${controlName}`);
  }
  await page.mouse.click(
    geometry.x + geometry.width / 2,
    geometry.y + geometry.height / 2,
  );
}

async function loadUnpackedExtension(
  context,
  extensionPath,
  managementUrl,
  browserKey,
) {
  const browser = context.browser();
  if (browser === null) throw new Error("Browser CDP is unavailable.");
  const cdp = await browser.newBrowserCDPSession();
  let loadedExtensionId;
  try {
    const { id } = await cdp.send("Extensions.loadUnpacked", {
      path: extensionPath,
    });
    loadedExtensionId = id;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
  if (loadedExtensionId !== undefined) {
    return {
      extensionsPage: null,
      worker: context.serviceWorkers()[0],
      extensionId: loadedExtensionId,
    };
  }
  const manualUi = process.env.PROMPTGUARD_MANUAL_UI === "1";
  const extensionsPage = await context.newPage();
  await extensionsPage.goto(managementUrl);
  await extensionsPage.waitForTimeout(500);
  const developerMode = await browserControlGeometry(
    extensionsPage,
    browserKey,
    "devMode",
  );
  const isDeveloperModeOn =
    developerMode?.pressed === "true" || developerMode?.checked === "true";
  if (!isDeveloperModeOn) {
    await clickBrowserControl(extensionsPage, browserKey, "devMode");
    await extensionsPage.waitForTimeout(500);
  }
  const fileChooser = manualUi
    ? null
    : extensionsPage.waitForEvent("filechooser");
  await clickBrowserControl(extensionsPage, browserKey, "loadUnpacked");
  if (manualUi) {
    console.log(
      `PROMPTGUARD_MANUAL_UI: choose this folder in the native picker: ${extensionPath}`,
    );
    await extensionsPage.waitForTimeout(
      Number(process.env.PROMPTGUARD_MANUAL_UI_TIMEOUT_MS ?? 120_000),
    );
  } else {
    await (await fileChooser).setFiles(extensionPath);
  }
  await extensionsPage.waitForTimeout(1_000);
  const extensionId = await extensionsPage.evaluate(() => {
    const ids = new Set();
    const visit = (root) => {
      for (const element of root.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
          if (/^[a-p]{32}$/u.test(attribute.value)) ids.add(attribute.value);
        }
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(globalThis.document);
    return [...ids][0] ?? null;
  });
  if (extensionId === null) {
    throw new Error(
      "Loaded extension ID is unavailable from the extensions UI.",
    );
  }
  const worker = context.serviceWorkers()[0];
  return { extensionsPage, worker, extensionId };
}

async function runBrowser(browserKey) {
  const browserConfig = BROWSERS[browserKey];
  const profilePath = await mkdtemp(
    join(tmpdir(), `promptguard-permission-${browserKey}-`),
  );
  const extensionPath = join(profilePath, "extension");
  await mkdir(extensionPath, { recursive: true });
  await writeFile(
    join(extensionPath, "manifest.json"),
    JSON.stringify(bootstrapExtensionManifest(), null, 2),
  );
  await writeFile(join(extensionPath, "background.js"), backgroundSource);
  await writeFile(join(extensionPath, "content.js"), contentSource);
  await writeFile(join(extensionPath, "proof.html"), proofPageHtml);
  await writeFile(join(extensionPath, "proof-page.js"), proofPageSource);

  let context;
  let exactVersion = "unavailable";
  const result = {
    browser: browserConfig.label,
    exactVersion,
    pattern: PATTERN,
    declarationAccepted: false,
    requestAccepted: false,
    containsAccepted: false,
    registrationAccepted: false,
    defaultPortPageMatched: false,
    alternatePortFixtureMatched: false,
    removeAccepted: false,
  };

  try {
    context = await chromium.launchPersistentContext(profilePath, {
      channel: browserConfig.channel,
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging"],
    });
    exactVersion = context.browser()?.version() ?? "unavailable";
    result.exactVersion = exactVersion;
    await context.route(/^(?:https?):\/\//u, async (route) => {
      const url = new URL(route.request().url());
      if (
        url.protocol === "https:" &&
        url.hostname === "claude.ai" &&
        (url.port === "" || url.port === "8443")
      ) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: fixtureHtml,
        });
        return;
      }
      if (url.protocol === "http:" || url.protocol === "https:") {
        await route.abort("blockedbyclient");
        return;
      }
      await route.fallback();
    });

    const bootstrapLoad = await loadUnpackedExtension(
      context,
      extensionPath,
      browserKey === "edge" ? "edge://extensions/" : "chrome://extensions/",
      browserKey,
    );
    await writeFile(
      join(extensionPath, "manifest.json"),
      JSON.stringify(extensionManifest(), null, 2),
    );
    const {
      extensionsPage,
      worker,
      extensionId: loadedExtensionId,
    } = await loadUnpackedExtension(
      context,
      extensionPath,
      browserKey === "edge" ? "edge://extensions/" : "chrome://extensions/",
      browserKey,
    );
    if (
      bootstrapLoad.extensionId !== undefined &&
      bootstrapLoad.extensionId !== loadedExtensionId
    ) {
      throw new Error("Permission proof extension ID changed during reload.");
    }
    const extensionId =
      loadedExtensionId ??
      (worker === undefined ? null : new URL(worker.url()).hostname);
    if (extensionId === null)
      throw new Error("Loaded extension worker is unavailable.");
    const controlPage = await context.newPage();
    await controlPage.goto(`chrome-extension://${extensionId}/proof.html`);
    const declaredManifest = await controlPage.evaluate(() => {
      const manifest = globalThis.chrome.runtime.getManifest();
      return {
        manifestVersion: manifest.manifest_version,
        permissions: manifest.permissions ?? [],
        hostPermissions: manifest.host_permissions ?? [],
        optionalPermissions: manifest.optional_permissions ?? [],
        optionalHostPermissions: manifest.optional_host_permissions ?? [],
      };
    });
    result.declarationAccepted =
      (await controlPage.title()) === "PromptGuard browser permission proof" &&
      JSON.stringify(declaredManifest) ===
        JSON.stringify({
          manifestVersion: 3,
          permissions: ["storage"],
          hostPermissions: [],
          optionalPermissions: ["scripting"],
          optionalHostPermissions: [PATTERN],
        });

    const request = await clickAndRead(controlPage, "request");
    result.requestAccepted = request.ok === true && request.value === true;
    const contains = await clickAndRead(controlPage, "contains");
    result.containsAccepted = contains.ok === true && contains.value === true;
    const registration = await clickAndRead(controlPage, "register");
    result.registrationAccepted =
      registration.ok === true &&
      registration.value?.ok === true &&
      registration.value?.registered === true;

    const fixturePage = await context.newPage();
    await fixturePage.goto(DEFAULT_PORT_URL, { waitUntil: "domcontentloaded" });
    await waitForInjected(controlPage, "https://claude.ai");
    const afterDefault = await runtimeSnapshot(controlPage);
    result.defaultPortPageMatched =
      afterDefault.events?.some(
        (event) => event.origin === "https://claude.ai",
      ) === true;

    await fixturePage.goto(ALTERNATE_PORT_URL, {
      waitUntil: "domcontentloaded",
    });
    await fixturePage.waitForTimeout(250);
    const afterAlternate = await runtimeSnapshot(controlPage);
    result.alternatePortFixtureMatched =
      afterAlternate.events?.some((event) => event.port === "8443") === true;

    const remove = await clickAndRead(controlPage, "remove");
    result.removeAccepted = remove.ok === true && remove.value === true;
    await controlPage.close();
    await fixturePage.close();
    await extensionsPage?.close();
  } catch (error) {
    result.error = String(error);
  } finally {
    if (context !== undefined) await context.close().catch(() => undefined);
    await rm(profilePath, { force: true, recursive: true });
  }
  return result;
}

const requestedBrowser = process.env.PROMPTGUARD_BROWSER ?? "all";
const browserKeys =
  requestedBrowser === "all" ? Object.keys(BROWSERS) : [requestedBrowser];
if (browserKeys.some((key) => !Object.hasOwn(BROWSERS, key))) {
  throw new Error(
    `PROMPTGUARD_BROWSER must be chrome, edge, or all; received ${requestedBrowser}.`,
  );
}

const results = [];
for (const browserKey of browserKeys)
  results.push(await runBrowser(browserKey));
console.log(JSON.stringify(results, null, 2));

const failed = results.filter(
  (result) =>
    result.declarationAccepted !== true ||
    result.requestAccepted !== true ||
    result.containsAccepted !== true ||
    result.registrationAccepted !== true ||
    result.defaultPortPageMatched !== true ||
    result.alternatePortFixtureMatched !== false ||
    result.removeAccepted !== true,
);
if (failed.length > 0) process.exitCode = 1;
