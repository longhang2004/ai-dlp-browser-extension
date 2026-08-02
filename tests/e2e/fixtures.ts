import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const extensionPath = resolve(process.cwd(), "apps/extension/dist");

type RuntimeChrome = {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
};

type ExtensionFixtures = {
  extensionContext: BrowserContext;
  extensionId: string;
  chatPage: Page;
  claudePage: Page;
};

export const CHATGPT_FIXTURE_URL = "https://chatgpt.com/c/ai-dlp-test";
export const CLAUDE_FIXTURE_URL = "https://claude.ai/promptguard-e2e";

export function composerFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Local ChatGPT composer fixture</title></head>
  <body>
    <main>
      <form aria-label="Chat composer" id="composer-form">
        <label for="prompt-textarea">Message ChatGPT</label>
        <textarea id="prompt-textarea" aria-label="Message ChatGPT"></textarea>
        <div id="attachment-slot"></div>
        <button type="submit" aria-label="Send prompt">Send</button>
      </form>
      <output id="submission-count">0</output>
    </main>
    <script>
      const submissions = [];
      const form = document.querySelector('#composer-form');
      const composer = document.querySelector('#prompt-textarea');
      const output = document.querySelector('#submission-count');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        submissions.push(composer.value);
        output.textContent = String(submissions.length);
      });
      Object.defineProperty(window, '__aiDlpFixture', {
        value: Object.freeze({ submissions }),
        configurable: false,
        enumerable: false,
        writable: false,
      });
    </script>
  </body>
</html>`;
}

export function claudeComposerFixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Local Claude composer fixture</title></head>
  <body>
    <main>
      <form aria-label="Chat composer" id="claude-composer-form">
        <label for="claude-chat-input">Message Claude</label>
        <textarea id="claude-chat-input" data-testid="chat-input" aria-label="Message Claude"></textarea>
        <button type="submit" data-testid="send-button" aria-label="Send message">Send</button>
      </form>
      <output id="claude-submission-count">0</output>
    </main>
    <script>
      const submissions = [];
      const form = document.querySelector('#claude-composer-form');
      const composer = document.querySelector('#claude-chat-input');
      const output = document.querySelector('#claude-submission-count');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        submissions.push(composer.value);
        output.textContent = String(submissions.length);
      });
      Object.defineProperty(window, '__aiDlpClaudeFixture', {
        value: Object.freeze({ submissions }),
        configurable: false,
        enumerable: false,
        writable: false,
      });
    </script>
  </body>
</html>`;
}

export const test = base.extend<ExtensionFixtures>({
  extensionContext: async ({ playwright }, runFixture) => {
    void playwright;
    const profilePath = await mkdtemp(`${tmpdir()}/ai-dlp-playwright-`);
    let context: BrowserContext | null = null;
    const unexpectedRemoteRequests: string[] = [];
    try {
      context = await chromium.launchPersistentContext(profilePath, {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });
      await context.route("**/*", async (route) => {
        const requestUrl = new URL(route.request().url());
        if (
          requestUrl.protocol === "https:" &&
          requestUrl.hostname === "chatgpt.com"
        ) {
          await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: composerFixtureHtml(),
          });
          return;
        }
        if (
          requestUrl.protocol === "https:" &&
          requestUrl.hostname === "claude.ai" &&
          (requestUrl.port === "" || requestUrl.port === "8443")
        ) {
          await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: claudeComposerFixtureHtml(),
          });
          return;
        }
        if (
          requestUrl.protocol === "http:" ||
          requestUrl.protocol === "https:"
        ) {
          unexpectedRemoteRequests.push(route.request().url());
          await route.abort("blockedbyclient");
          return;
        }
        await route.fallback();
      });
      await runFixture(context);
      expect(unexpectedRemoteRequests).toEqual([]);
    } finally {
      try {
        await context?.close();
      } finally {
        await rm(profilePath, { force: true, recursive: true });
      }
    }
  },

  extensionId: async ({ extensionContext }, runFixture) => {
    let worker = extensionContext.serviceWorkers()[0];
    worker ??= await extensionContext.waitForEvent("serviceworker", {
      timeout: 15_000,
    });
    const extensionId = new URL(worker.url()).hostname;
    expect(extensionId).toMatch(/^[a-p]{32}$/u);
    await runFixture(extensionId);
  },

  chatPage: async ({ extensionContext }, runFixture) => {
    const page = await extensionContext.newPage();
    await page.goto(CHATGPT_FIXTURE_URL, { waitUntil: "domcontentloaded" });
    try {
      await runFixture(page);
    } finally {
      await page.close();
    }
  },

  claudePage: async ({ extensionContext }, runFixture) => {
    const page = await extensionContext.newPage();
    await page.goto(CLAUDE_FIXTURE_URL, { waitUntil: "domcontentloaded" });
    try {
      await runFixture(page);
    } finally {
      await page.close();
    }
  },
});

export { expect };

export async function openExtensionPage(
  context: BrowserContext,
  extensionId: string,
  path: "popup.html" | "options.html" | "audit.html",
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}

export async function sendRuntimeMessage(
  page: Page,
  message: unknown,
): Promise<unknown> {
  return page.evaluate(async (request) => {
    const installedChrome = (
      globalThis as typeof globalThis & {
        chrome: RuntimeChrome;
      }
    ).chrome;
    return installedChrome.runtime.sendMessage(request);
  }, message);
}

export async function waitForProtectionState(
  page: Page,
  state: "active" | "disabled" | "degraded" | "initializing" | "unavailable",
): Promise<void> {
  await expect
    .poll(async () => {
      const response = (await sendRuntimeMessage(page, {
        type: "status.read",
      })) as { type?: unknown; status?: { state?: unknown } };
      return response.type === "status.result" ? response.status?.state : null;
    })
    .toBe(state);
}

export async function setComposerText(
  page: Page,
  value: string,
): Promise<void> {
  const composer = page.locator("#prompt-textarea");
  await composer.fill(value);
}

export async function setClaudeComposerText(
  page: Page,
  value: string,
): Promise<void> {
  await page.locator('[data-testid="chat-input"]').fill(value);
}

export async function setStructuralAttachment(
  page: Page,
  present: boolean,
  marker = "private-attachment-name.txt",
): Promise<void> {
  await page.evaluate(
    ({ shouldBePresent, privateMarker }) => {
      const slot = document.querySelector("#attachment-slot");
      if (!(slot instanceof HTMLElement)) {
        throw new Error("Attachment fixture slot is unavailable.");
      }
      slot.replaceChildren();
      if (shouldBePresent) {
        const attachment = document.createElement("div");
        attachment.dataset.testid = "composer-attachment";
        attachment.textContent = privateMarker;
        slot.append(attachment);
      }
    },
    { shouldBePresent: present, privateMarker: marker },
  );
}

export async function submissionValues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fixture = (
      globalThis as typeof globalThis & {
        __aiDlpFixture: { submissions: string[] };
      }
    ).__aiDlpFixture;
    return [...fixture.submissions];
  });
}

export async function claudeSubmissionValues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fixture = (
      globalThis as typeof globalThis & {
        __aiDlpClaudeFixture: { submissions: string[] };
      }
    ).__aiDlpClaudeFixture;
    return [...fixture.submissions];
  });
}

export function protectionDialog(page: Page) {
  return page
    .locator("[data-ai-dlp-protection-dialog-host]")
    .getByRole("dialog");
}
