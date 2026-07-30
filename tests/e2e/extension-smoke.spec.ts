import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  expect,
  openExtensionPage,
  protectionDialog,
  sendRuntimeMessage,
  setComposerText,
  setStructuralAttachment,
  submissionValues,
  test,
  waitForProtectionState,
} from "./fixtures.js";
type SensitiveFixture = {
  email: { valid: string };
  phone: { vietnameseDomestic: string };
  paymentCard: { validVisa: string };
  awsAccessKey: { longLived: string };
  privateKey: { generic: string };
};

type RawSensitiveFixture = Omit<SensitiveFixture, "awsAccessKey"> & {
  awsAccessKey: {
    longLived: { parts: string[] };
  };
};

const rawSensitive = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tests/fixtures/sensitive-values.json"),
    "utf8",
  ),
) as RawSensitiveFixture;

const sensitive: SensitiveFixture = {
  ...rawSensitive,
  awsAccessKey: {
    longLived: rawSensitive.awsAccessKey.longLived.parts.join(""),
  },
};

const AMBIGUOUS_SHARED_SEND_FIXTURE = `
  <main>
    <section data-testid="composer-root" id="shared-composer-root">
      <div id="prompt-a" contenteditable="true" role="textbox" aria-label="Message ChatGPT">Prompt A</div>
      <div id="prompt-textarea" contenteditable="true" role="textbox">Prompt B</div>
      <button id="shared-send" type="button" data-testid="send-button" aria-label="Send prompt">Send</button>
    </section>
  </main>
`;

async function saveSettings(
  page: Parameters<typeof sendRuntimeMessage>[0],
  overrides: Partial<{
    protectionEnabled: boolean;
    emailAction: "allow" | "warn" | "block";
    phoneAction: "allow" | "warn" | "block";
    attachmentAction: "allow" | "warn" | "block";
    protectedKeywords: string[];
    auditRetentionLimit: number;
  }>,
): Promise<void> {
  const current = (await sendRuntimeMessage(page, {
    type: "settings.read",
  })) as {
    type: string;
    envelope: { settings: Record<string, unknown> };
  };
  expect(current.type).toBe("settings.result");
  const saved = (await sendRuntimeMessage(page, {
    type: "settings.save",
    settings: { ...current.envelope.settings, ...overrides },
  })) as { type: string };
  expect(saved.type).toBe("settings.saved");
}

test("content initialization stays pass-through and never reports active before settings arrive", async ({
  extensionContext,
  extensionId,
}) => {
  const worker = extensionContext.serviceWorkers()[0];
  expect(worker).toBeDefined();
  await worker?.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __aiDlpReleaseSettingsRead?: () => void;
      __aiDlpSettingsReadBlocked?: boolean;
    };
    const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
    let delayed = false;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    Object.defineProperty(chrome.storage.local, "get", {
      configurable: true,
      value: async (...args: Parameters<typeof chrome.storage.local.get>) => {
        if (!delayed && args[0] === "settings") {
          delayed = true;
          state.__aiDlpSettingsReadBlocked = true;
          await gate;
        }
        return originalGet(...args);
      },
    });
    state.__aiDlpReleaseSettingsRead = () => release?.();
  });

  const chatPage = await extensionContext.newPage();
  await chatPage.goto("https://chatgpt.com/c/initialization-test", {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() =>
      worker?.evaluate(() =>
        Boolean(
          (
            globalThis as typeof globalThis & {
              __aiDlpSettingsReadBlocked?: boolean;
            }
          ).__aiDlpSettingsReadBlocked,
        ),
      ),
    )
    .toBe(true);

  const popupPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await expect(
    popupPage.getByRole("heading", { name: "Protection is initializing" }),
  ).toBeVisible();

  await setComposerText(chatPage, sensitive.paymentCard.validVisa);
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect
    .poll(() => submissionValues(chatPage))
    .toEqual([sensitive.paymentCard.validVisa]);

  await worker?.evaluate(() => {
    (
      globalThis as typeof globalThis & {
        __aiDlpReleaseSettingsRead?: () => void;
      }
    ).__aiDlpReleaseSettingsRead?.();
  });
  await waitForProtectionState(popupPage, "active");

  await chatPage.close();
  await popupPage.close();
});

test("clean prompt is submitted once and creates no allow audit record", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await waitForProtectionState(extensionPage, "active");
  await setComposerText(chatPage, "Summarize these ordinary project notes.");
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect
    .poll(() => submissionValues(chatPage))
    .toEqual(["Summarize these ordinary project notes."]);

  const audit = (await sendRuntimeMessage(extensionPage, {
    type: "audit.read",
  })) as { type: string; envelope: { events: unknown[] } };
  expect(audit.type).toBe("audit.result");
  expect(audit.envelope.events).toEqual([]);
  await extensionPage.close();
});

test("email and Vietnamese phone warnings support one-shot bypass and Shift+Enter", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await waitForProtectionState(extensionPage, "active");
  const prompt = `Contact ${sensitive.email.valid} or ${sensitive.phone.vietnameseDomestic}`;
  await setComposerText(chatPage, prompt);

  await chatPage.locator("#prompt-textarea").press("Shift+Enter");
  expect(await submissionValues(chatPage)).toEqual([]);
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  const dialog = protectionDialog(chatPage);
  await expect(dialog).toContainText("Email address");
  await expect(dialog).toContainText("Phone number");
  await expect(dialog).toContainText("[EMAIL]");
  await expect(dialog).toContainText("[PHONE]");
  await expect(dialog).not.toContainText(sensitive.email.valid);
  await expect(dialog).not.toContainText(sensitive.phone.vietnameseDomestic);
  await dialog.getByRole("button", { name: "Send anyway" }).click();
  await expect.poll(() => submissionValues(chatPage)).toEqual([`${prompt}\n`]);

  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect(protectionDialog(chatPage)).toBeVisible();
  expect(await submissionValues(chatPage)).toHaveLength(1);
  await protectionDialog(chatPage)
    .getByRole("button", { name: "Cancel" })
    .click();
  await extensionPage.close();
});

test("Enter is protected while IME composition remains pass-through", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await waitForProtectionState(extensionPage, "active");
  await setComposerText(chatPage, sensitive.email.valid);

  const imePrevented = await chatPage
    .locator("#prompt-textarea")
    .evaluate((composer) => {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      });
      composer.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(imePrevented).toBe(false);
  expect(await submissionValues(chatPage)).toEqual([]);
  await expect(protectionDialog(chatPage)).toHaveCount(0);

  await chatPage.locator("#prompt-textarea").press("Enter");
  await expect(protectionDialog(chatPage)).toBeVisible();
  expect(await submissionValues(chatPage)).toEqual([]);
  await protectionDialog(chatPage)
    .getByRole("button", { name: "Cancel" })
    .click();

  await setComposerText(chatPage, "Ordinary synthetic prompt.");
  await chatPage.locator("#prompt-textarea").press("Enter");
  await expect
    .poll(() => submissionValues(chatPage))
    .toEqual(["Ordinary synthetic prompt."]);
  await extensionPage.close();
});

test("SPA navigation invalidates a visible warning before bypass can resume", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await waitForProtectionState(extensionPage, "active");
  await setComposerText(chatPage, sensitive.email.valid);
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect(protectionDialog(chatPage)).toBeVisible();

  await chatPage.evaluate(() => {
    history.pushState({}, "", "/c/after-navigation");
  });
  await protectionDialog(chatPage)
    .getByRole("button", { name: "Send anyway" })
    .click();
  await expect.poll(() => submissionValues(chatPage)).toEqual([]);

  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect(protectionDialog(chatPage)).toBeVisible();
  await protectionDialog(chatPage)
    .getByRole("button", { name: "Cancel" })
    .click();
  await extensionPage.close();
});

test("shared-Send ambiguity fails closed without a prompt-bearing audit", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await waitForProtectionState(extensionPage, "active");
  await chatPage.evaluate((fixture) => {
    document.body.innerHTML = fixture;
    const state = globalThis as typeof globalThis & {
      __sharedSendClicks?: number;
    };
    state.__sharedSendClicks = 0;
    document.querySelector("#shared-send")?.addEventListener("click", () => {
      state.__sharedSendClicks = (state.__sharedSendClicks ?? 0) + 1;
    });
  }, AMBIGUOUS_SHARED_SEND_FIXTURE);

  await chatPage.locator("#shared-send").click({ force: true });
  await expect
    .poll(() =>
      chatPage.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __sharedSendClicks?: number;
            }
          ).__sharedSendClicks ?? 0,
      ),
    )
    .toBe(0);
  const dialog = protectionDialog(chatPage);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send anyway" })).toHaveCount(
    0,
  );
  await expect(dialog).not.toContainText("Prompt A");
  await expect(dialog).not.toContainText("Prompt B");
  const audit = (await sendRuntimeMessage(extensionPage, {
    type: "audit.read",
  })) as { type: string; envelope: { events: unknown[] } };
  expect(JSON.stringify(audit.envelope.events)).not.toContain("Prompt A");
  expect(JSON.stringify(audit.envelope.events)).not.toContain("Prompt B");
  await dialog.getByRole("button", { name: "Close" }).click();
  await extensionPage.close();
});

test("alternate-port ChatGPT remains unprotected and unreported", async ({
  extensionContext,
  extensionId,
}) => {
  const alternatePage = await extensionContext.newPage();
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await alternatePage.goto("https://chatgpt.com:8443/c/alternate-port", {
    waitUntil: "domcontentloaded",
  });
  await waitForProtectionState(extensionPage, "unavailable");

  await setComposerText(alternatePage, sensitive.paymentCard.validVisa);
  await alternatePage.getByRole("button", { name: "Send prompt" }).click();
  await expect
    .poll(() => submissionValues(alternatePage))
    .toEqual([sensitive.paymentCard.validVisa]);
  await expect(protectionDialog(alternatePage)).toHaveCount(0);
  const audit = (await sendRuntimeMessage(extensionPage, {
    type: "audit.read",
  })) as { type: string; envelope: { events: unknown[] } };
  expect(audit.envelope.events).toEqual([]);
  await alternatePage.close();
  await extensionPage.close();
});

test("ChatGPT warnings never offer unverified automatic redaction", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "options.html",
  );
  await saveSettings(extensionPage, { emailAction: "warn" });
  await waitForProtectionState(extensionPage, "active");
  await setComposerText(chatPage, `Contact ${sensitive.email.valid}`);
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  const dialog = protectionDialog(chatPage);
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Redact and continue" }),
  ).toHaveCount(0);
  await expect(chatPage.locator("#prompt-textarea")).toHaveValue(
    `Contact ${sensitive.email.valid}`,
  );
  expect(await submissionValues(chatPage)).toEqual([]);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await extensionPage.close();
});

test("payment card, AWS key, and PEM prompts are blocked without bypass", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "popup.html",
  );
  await waitForProtectionState(extensionPage, "active");

  for (const [value, label] of [
    [sensitive.paymentCard.validVisa, "Payment card"],
    [sensitive.awsAccessKey.longLived, "AWS access key"],
    [sensitive.privateKey.generic, "Private key"],
  ] as const) {
    await setComposerText(chatPage, value);
    await chatPage.getByRole("button", { name: "Send prompt" }).click();
    const dialog = protectionDialog(chatPage);
    await expect(dialog).toContainText("Submission blocked");
    await expect(dialog).toContainText(label);
    await expect(
      dialog.getByRole("button", { name: "Send anyway" }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();
  }
  expect(await submissionValues(chatPage)).toEqual([]);
  await extensionPage.close();
});

test("attachment warning supports one-shot bypass without leaking attachment or prompt data", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "options.html",
  );
  await saveSettings(extensionPage, { attachmentAction: "warn" });
  await waitForProtectionState(extensionPage, "active");
  const promptCanary = "ordinary prompt attachment privacy canary";
  const attachmentCanary = "private-attachment-name.txt";
  await setComposerText(chatPage, promptCanary);
  await setStructuralAttachment(chatPage, true, attachmentCanary);

  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  const dialog = protectionDialog(chatPage);
  await expect(dialog).toContainText("Unscanned attachment");
  await expect(dialog).toContainText(
    "Attached file contents are not inspected in this version.",
  );
  await dialog
    .getByRole("button", { name: "Send attachment without inspection" })
    .click();
  await expect.poll(() => submissionValues(chatPage)).toEqual([promptCanary]);

  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect(protectionDialog(chatPage)).toBeVisible();
  expect(await submissionValues(chatPage)).toHaveLength(1);
  await protectionDialog(chatPage)
    .getByRole("button", { name: "Cancel" })
    .click();

  const audit = (await sendRuntimeMessage(extensionPage, {
    type: "audit.read",
  })) as {
    type: string;
    envelope: {
      events: Array<Record<string, unknown>>;
    };
  };
  expect(audit.type).toBe("audit.result");
  expect(audit.envelope.events).toHaveLength(2);
  expect(audit.envelope.events[0]).toMatchObject({
    kind: "decision",
    policyAction: "warn",
    resolution: "attachment_bypassed",
    findingCount: 0,
    detectorCategories: [],
    matchedRuleIds: ["attachment.unsupported"],
    reasonCode: "unsupported_attachment",
    attachmentPresent: true,
  });
  const serializedAudit = JSON.stringify(audit);
  expect(serializedAudit).not.toContain(promptCanary);
  expect(serializedAudit).not.toContain(attachmentCanary);
  expect(serializedAudit).not.toContain("maskedExcerpt");
  await extensionPage.close();
});

test("attachment block and allow settings map to closed and dialog-free behavior", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const optionsPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "options.html",
  );
  await waitForProtectionState(optionsPage, "active");
  await setStructuralAttachment(chatPage, true);
  await setComposerText(chatPage, "ordinary attachment policy prompt");

  await saveSettings(optionsPage, { attachmentAction: "block" });
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  const blockedDialog = protectionDialog(chatPage);
  await expect(blockedDialog).toContainText("Submission blocked");
  await expect(blockedDialog).toContainText(
    "Attached file contents cannot be inspected.",
  );
  await expect(
    blockedDialog.getByRole("button", { name: "Send anyway" }),
  ).toHaveCount(0);
  await blockedDialog.getByRole("button", { name: "Close" }).click();
  expect(await submissionValues(chatPage)).toEqual([]);

  await saveSettings(optionsPage, { attachmentAction: "allow" });
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect
    .poll(() => submissionValues(chatPage))
    .toEqual(["ordinary attachment policy prompt"]);
  await expect(protectionDialog(chatPage)).toHaveCount(0);
  const audit = (await sendRuntimeMessage(optionsPage, {
    type: "audit.read",
  })) as { type: string; envelope: { events: unknown[] } };
  expect(audit.type).toBe("audit.result");
  expect(audit.envelope.events).toHaveLength(1);
  await optionsPage.close();
});

test("combined text and attachment warning exposes one generic bypass", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const extensionPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "options.html",
  );
  await saveSettings(extensionPage, {
    emailAction: "warn",
    attachmentAction: "warn",
  });
  await waitForProtectionState(extensionPage, "active");
  await setComposerText(chatPage, `Contact ${sensitive.email.valid}`);
  await setStructuralAttachment(chatPage, true);

  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  const dialog = protectionDialog(chatPage);
  await expect(dialog).toContainText("Email address");
  await expect(dialog).toContainText(
    "Attached file contents are not inspected in this version.",
  );
  await expect(
    dialog.getByRole("button", { name: "Send attachment without inspection" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Send anyway" }).click();
  await expect
    .poll(() => submissionValues(chatPage))
    .toEqual([`Contact ${sensitive.email.valid}`]);
  await extensionPage.close();
});

test("options disabling is reflected truthfully and passes submissions through", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const optionsPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "options.html",
  );
  await waitForProtectionState(optionsPage, "active");
  await expect(
    optionsPage.getByRole("heading", { name: "Protection settings" }),
  ).toBeVisible();
  await optionsPage.getByRole("checkbox").uncheck();
  await optionsPage.getByRole("button", { name: "Save settings" }).click();
  await expect(optionsPage.getByRole("status")).toContainText("Settings saved");
  await waitForProtectionState(optionsPage, "disabled");

  await setComposerText(chatPage, sensitive.paymentCard.validVisa);
  await chatPage.getByRole("button", { name: "Send prompt" }).click();
  await expect
    .poll(() => submissionValues(chatPage))
    .toEqual([sensitive.paymentCard.validVisa]);
  await optionsPage.close();
});

test("audit page displays the retained final privacy-safe decision", async ({
  chatPage,
  extensionContext,
  extensionId,
}) => {
  const auditPage = await openExtensionPage(
    extensionContext,
    extensionId,
    "audit.html",
  );
  await waitForProtectionState(auditPage, "active");
  await saveSettings(auditPage, { auditRetentionLimit: 1 });

  for (const prompt of [
    sensitive.email.valid,
    sensitive.phone.vietnameseDomestic,
  ]) {
    await setComposerText(chatPage, prompt);
    await chatPage.getByRole("button", { name: "Send prompt" }).click();
    await protectionDialog(chatPage)
      .getByRole("button", { name: "Cancel" })
      .click();
  }

  const audit = (await sendRuntimeMessage(auditPage, {
    type: "audit.read",
  })) as {
    type: string;
    envelope: {
      events: Array<{ kind: string; detectorCategories?: string[] }>;
    };
  };
  expect(audit.type).toBe("audit.result");
  expect(audit.envelope.events).toHaveLength(1);
  expect(audit.envelope.events[0]).toMatchObject({
    kind: "decision",
    detectorCategories: ["phone"],
  });
  await auditPage.reload();
  await expect(
    auditPage.getByRole("heading", { name: "Audit log" }),
  ).toBeVisible();
  await expect(auditPage.locator(".event-card")).toHaveCount(1);
  await auditPage.close();
});
