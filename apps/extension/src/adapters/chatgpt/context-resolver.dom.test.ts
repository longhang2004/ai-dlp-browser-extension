import { afterEach, describe, expect, it } from "vitest";

import {
  CONTENTEDITABLE_COMPOSER_FIXTURE,
  NATIVE_TEXTAREA_COMPOSER_FIXTURE,
  PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE,
} from "./fixtures.js";
import {
  isSubmissionContextUsable,
  resolveSubmissionElements,
} from "./context-resolver.js";

function renderFixture(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("resolveSubmissionElements", () => {
  it("resolves the native textarea and its form-owned submit control", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);

    const resolved = resolveSubmissionElements(document);

    expect(resolved?.composer).toBe(document.querySelector("textarea"));
    expect(resolved?.sendControl).toBe(
      document.querySelector('button[type="submit"]'),
    );
    expect(resolved?.strategy).toBe("native_form");
  });

  it("resolves a semantic contenteditable and associated ARIA/data send control", () => {
    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);

    const resolved = resolveSubmissionElements(document);

    expect(resolved?.composer).toBe(document.querySelector('[role="textbox"]'));
    expect(resolved?.sendControl).toBe(
      document.querySelector('[aria-label="Send prompt"]'),
    );
    expect(resolved?.strategy).toBe("aria_composer");
  });

  it("ignores hidden, disconnected, readonly, and disabled candidates", () => {
    renderFixture(NATIVE_TEXTAREA_COMPOSER_FIXTURE);
    const textarea = document.querySelector("textarea");
    const button = document.querySelector("button");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(button).toBeInstanceOf(HTMLButtonElement);
    if (
      !(textarea instanceof HTMLTextAreaElement) ||
      !(button instanceof HTMLButtonElement)
    ) {
      throw new Error("Fixture did not create native controls.");
    }

    textarea.readOnly = true;
    expect(resolveSubmissionElements(document)).toBeNull();
    textarea.readOnly = false;
    button.disabled = true;
    expect(resolveSubmissionElements(document)).toBeNull();
    button.disabled = false;
    textarea.hidden = true;
    expect(resolveSubmissionElements(document)).toBeNull();
    textarea.hidden = false;

    const resolved = resolveSubmissionElements(document);
    expect(resolved).not.toBeNull();
    textarea.remove();
    expect(resolved && isSubmissionContextUsable(document, resolved)).toBe(
      false,
    );
  });

  it("does not pair a composer with an unrelated send-like control", () => {
    renderFixture(`
      <form aria-label="Search">
        <button type="submit">Search</button>
      </form>
      <section data-testid="composer-root">
        <div role="textbox" contenteditable="true" aria-label="Message ChatGPT"></div>
      </section>
    `);

    expect(resolveSubmissionElements(document)).toBeNull();
  });

  it("skips unrelated forms and editors that precede the real ChatGPT composer", () => {
    renderFixture(`
      <form aria-label="Site search">
        <textarea aria-label="Search query"></textarea>
        <button type="submit">Search</button>
      </form>
      <section aria-label="Document editor">
        <div role="textbox" contenteditable="true" aria-label="Document body"></div>
        <button aria-label="Save document" type="button">Save</button>
      </section>
      ${NATIVE_TEXTAREA_COMPOSER_FIXTURE}
    `);

    const resolved = resolveSubmissionElements(document);
    expect(resolved?.composer).toBe(
      document.querySelector('form[aria-label="Chat composer"] textarea'),
    );
    expect(resolved?.sendControl.textContent).toBe("Send");
  });

  it("keeps ARIA and stable-data composer fallbacks reachable", () => {
    renderFixture(`
      <form aria-label="Chat composer">
        <div contenteditable="true"></div>
        <button type="submit">Send</button>
      </form>
    `);
    expect(resolveSubmissionElements(document)?.strategy).toBe(
      "semantic_contenteditable",
    );

    renderFixture(CONTENTEDITABLE_COMPOSER_FIXTURE);
    expect(resolveSubmissionElements(document)?.strategy).toBe("aria_composer");

    renderFixture(`
      <section data-testid="composer-root">
        <div contenteditable="true" data-testid="composer-textarea"></div>
        <button type="button" data-testid="send-button">Send</button>
      </section>
    `);
    expect(resolveSubmissionElements(document)?.strategy).toBe(
      "stable_data_composer",
    );
  });

  it("associates a role-form composer only with its local native submit control", () => {
    renderFixture(`
      <button type="submit" id="outside">Outside</button>
      <section role="form" aria-label="Chat composer">
        <textarea></textarea>
        <button type="submit" id="inside">Send</button>
      </section>
    `);

    const resolved = resolveSubmissionElements(document);
    expect(resolved?.sendControl).toBe(document.querySelector("#inside"));
    expect(resolved?.sendControl).not.toBe(document.querySelector("#outside"));
  });

  it("resolves the production prompt-textarea and chooses Send over no-type tools", () => {
    renderFixture(PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE);

    const resolved = resolveSubmissionElements(document);

    expect(resolved?.composer).toBe(document.querySelector("#prompt-textarea"));
    expect(resolved?.sendControl).toBe(
      document.querySelector('[data-testid="send-button"]'),
    );
    expect(resolved?.sendControl.getAttribute("aria-label")).toBe(
      "Send prompt",
    );
  });

  it("does not treat a generic no-type tool button as the send control", () => {
    renderFixture(`
      <form aria-label="Chat composer">
        <button aria-label="Open tools">Tools</button>
        <textarea></textarea>
      </form>
    `);

    expect(resolveSubmissionElements(document)).toBeNull();
  });

  it("ignores invisible and disconnected prompt-textarea candidates", () => {
    renderFixture(PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE);
    const composer = document.querySelector("#prompt-textarea");
    expect(composer).toBeInstanceOf(HTMLElement);
    if (!(composer instanceof HTMLElement)) {
      throw new Error("Missing prompt-textarea fixture.");
    }

    composer.hidden = true;
    expect(resolveSubmissionElements(document)).toBeNull();
    composer.hidden = false;
    const resolved = resolveSubmissionElements(document);
    expect(resolved).not.toBeNull();
    composer.remove();
    expect(resolved && isSubmissionContextUsable(document, resolved)).toBe(
      false,
    );
  });
});
