import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_DATA_COMPOSER_FIXTURE,
  CLAUDE_SEMANTIC_COMPOSER_FIXTURE,
  CLAUDE_SHARED_SEND_FIXTURE,
  CLAUDE_UNRELATED_SEMANTIC_FIXTURE,
} from "./fixtures.js";
import {
  collectSubmissionContexts,
  diagnoseSubmissionElements,
  isSubmissionContextUsable,
  resolveComposerSubmissionFromTarget,
  resolveSendSubmissionFromTarget,
  resolveSubmissionElements,
} from "./context-resolver.js";

function renderFixture(markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  document.body.replaceChildren(...parsed.body.childNodes);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Claude context resolver", () => {
  it("resolves both synthetic semantic structural variants", () => {
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    const semantic = resolveSubmissionElements(document);
    expect(semantic?.composer).toBe(document.querySelector('[role="textbox"]'));
    expect(semantic?.sendControl).toBe(
      document.querySelector('[aria-label="Send message"]'),
    );
    expect(semantic?.strategy).toBe("semantic_contenteditable");

    renderFixture(CLAUDE_DATA_COMPOSER_FIXTURE);
    const data = resolveSubmissionElements(document);
    expect(data?.composer).toBe(document.querySelector("textarea"));
    expect(data?.sendControl).toBe(
      document.querySelector('[data-testid="send-button"]'),
    );
    expect(data?.strategy).toBe("semantic_textarea");
  });

  it("returns none when semantic ownership is absent", () => {
    renderFixture(CLAUDE_UNRELATED_SEMANTIC_FIXTURE);
    expect(collectSubmissionContexts(document)).toEqual({
      kind: "none",
      sawComposerCandidate: false,
    });
    expect(diagnoseSubmissionElements(document)).toEqual({
      context: null,
      healthCode: "composer_not_found",
    });
  });

  it("returns ambiguous for a shared Send control", () => {
    renderFixture(CLAUDE_SHARED_SEND_FIXTURE);
    expect(collectSubmissionContexts(document)).toEqual({ kind: "ambiguous" });
    expect(resolveSubmissionElements(document)).toBeNull();
    expect(diagnoseSubmissionElements(document)).toEqual({
      context: null,
      healthCode: "ambiguous_submission_context",
    });
  });

  it("rejects non-exact serialized origins, including explicit default ports", () => {
    renderFixture(CLAUDE_SEMANTIC_COMPOSER_FIXTURE);
    const composer = document.querySelector('[role="textbox"]');
    const send = document.querySelector("button");
    expect(composer).toBeInstanceOf(HTMLElement);
    expect(send).toBeInstanceOf(HTMLElement);
    if (!(composer instanceof HTMLElement) || !(send instanceof HTMLElement)) {
      throw new Error("Missing synthetic controls.");
    }
    expect(
      resolveSubmissionElements(document, "https://claude.ai:443"),
    ).toBeNull();
    expect(
      resolveComposerSubmissionFromTarget(
        document,
        composer,
        "https://claude.ai:8443",
      ),
    ).toEqual({
      kind: "not_a_submission_candidate",
    });
    expect(
      resolveSendSubmissionFromTarget(document, send, "https://example.test"),
    ).toEqual({
      kind: "not_a_submission_candidate",
    });
  });

  it("rejects hidden, stale, disabled, and detached controls", () => {
    renderFixture(CLAUDE_DATA_COMPOSER_FIXTURE);
    const composer = document.querySelector("textarea");
    const send = document.querySelector("button");
    expect(composer).toBeInstanceOf(HTMLTextAreaElement);
    expect(send).toBeInstanceOf(HTMLButtonElement);
    if (
      !(composer instanceof HTMLTextAreaElement) ||
      !(send instanceof HTMLButtonElement)
    ) {
      throw new Error("Missing synthetic controls.");
    }
    composer.hidden = true;
    expect(resolveSubmissionElements(document)).toBeNull();
    composer.hidden = false;
    send.disabled = true;
    expect(resolveSubmissionElements(document)).toBeNull();
    send.disabled = false;
    const context = resolveSubmissionElements(document);
    expect(context).not.toBeNull();
    if (context === null) throw new Error("Expected a live context.");
    composer.remove();
    expect(isSubmissionContextUsable(document, context)).toBe(false);
  });

  it("requires the same semantic region to own the composer and Send", () => {
    renderFixture(`
      <section data-testid="chat-composer">
        <textarea data-testid="chat-input" aria-label="Message Claude"></textarea>
      </section>
      <button data-testid="send-button" aria-label="Send">Send</button>
    `);
    expect(resolveSubmissionElements(document)).toBeNull();
  });

  it("does not select by DOM order when a region has multiple Send controls", () => {
    renderFixture(`
      <section data-testid="chat-composer">
        <textarea data-testid="chat-input" aria-label="Message Claude"></textarea>
        <button data-testid="send-button" aria-label="Send">Send A</button>
        <button data-testid="send-button" aria-label="Send">Send B</button>
      </section>
    `);
    expect(resolveSubmissionElements(document)).toBeNull();
    expect(diagnoseSubmissionElements(document).healthCode).toBe(
      "send_control_not_found",
    );
  });
});
