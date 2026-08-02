import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_DATA_COMPOSER_FIXTURE,
  CLAUDE_NATIVE_BUTTON_SUBMIT_FIXTURE,
  CLAUDE_NATIVE_INPUT_SUBMIT_FIXTURE,
  CLAUDE_NESTED_OUTER_COMPOSER_FIXTURE,
  CLAUDE_NESTED_REGIONS_FIXTURE,
  CLAUDE_MIXED_SEND_CONTROLS_FIXTURE,
  CLAUDE_NESTED_DISABLED_SEMANTIC_SEND_FIXTURE,
  CLAUDE_NESTED_HIDDEN_NATIVE_SEND_FIXTURE,
  CLAUDE_SEMANTIC_COMPOSER_FIXTURE,
  CLAUDE_SHARED_SEND_FIXTURE,
  CLAUDE_TWO_COMPOSERS_ONE_SEND_FIXTURE,
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
      "ambiguous_submission_context",
    );
  });

  it("anchors a nested composer to its uniquely owned outer semantic region", () => {
    renderFixture(CLAUDE_NESTED_OUTER_COMPOSER_FIXTURE);
    const composer = document.querySelector("#nested-composer");
    const send = document.querySelector("#outer-send");
    const outer = document.querySelector("#outer-composer");
    expect(composer).toBeInstanceOf(HTMLElement);
    expect(send).toBeInstanceOf(HTMLElement);
    expect(outer).toBeInstanceOf(HTMLElement);
    if (
      !(composer instanceof HTMLElement) ||
      !(send instanceof HTMLElement) ||
      !(outer instanceof HTMLElement)
    ) {
      throw new Error("Missing nested Claude ownership fixture.");
    }

    const resolved = resolveSubmissionElements(document);
    expect(resolved).not.toBeNull();
    expect(resolved?.composer).toBe(composer);
    expect(resolved?.sendControl).toBe(send);
    expect(resolved?.submissionRegion).toBe(outer);
    expect(
      resolved?.submissionRegion.querySelector("#outer-attachment"),
    ).not.toBeNull();

    expect(resolveComposerSubmissionFromTarget(document, composer)).toEqual({
      kind: "resolved",
      context: resolved,
    });
    expect(resolveSendSubmissionFromTarget(document, send)).toEqual({
      kind: "resolved",
      context: resolved,
    });
  });

  it("keeps independent nested semantic owners target anchored", () => {
    renderFixture(CLAUDE_NESTED_REGIONS_FIXTURE);
    const nestedComposer = document.querySelector("#nested-composer");
    const nestedSend = document.querySelector("#nested-send");
    const outerComposer = document.querySelector("#outer-composer-input");
    const outerSend = document.querySelector("#outer-send");
    expect(nestedComposer).toBeInstanceOf(HTMLElement);
    expect(nestedSend).toBeInstanceOf(HTMLElement);
    expect(outerComposer).toBeInstanceOf(HTMLElement);
    expect(outerSend).toBeInstanceOf(HTMLElement);
    if (
      !(nestedComposer instanceof HTMLElement) ||
      !(nestedSend instanceof HTMLElement) ||
      !(outerComposer instanceof HTMLElement) ||
      !(outerSend instanceof HTMLElement)
    ) {
      throw new Error("Missing nested ambiguity fixture.");
    }

    expect(resolveSubmissionElements(document)).toBeNull();
    expect(diagnoseSubmissionElements(document)).toEqual({
      context: null,
      healthCode: "ambiguous_submission_context",
    });
    expect(
      resolveComposerSubmissionFromTarget(document, nestedComposer),
    ).toMatchObject({
      kind: "resolved",
      context: { composer: nestedComposer, sendControl: nestedSend },
    });
    expect(
      resolveComposerSubmissionFromTarget(document, outerComposer),
    ).toMatchObject({
      kind: "resolved",
      context: { composer: outerComposer, sendControl: outerSend },
    });
    expect(resolveSendSubmissionFromTarget(document, nestedSend)).toMatchObject(
      {
        kind: "resolved",
        context: { composer: nestedComposer, sendControl: nestedSend },
      },
    );
    expect(resolveSendSubmissionFromTarget(document, outerSend)).toMatchObject({
      kind: "resolved",
      context: { composer: outerComposer, sendControl: outerSend },
    });
  });

  it.each([
    [
      "semantic composer with a disabled Send",
      CLAUDE_NESTED_DISABLED_SEMANTIC_SEND_FIXTURE,
      "#inner-semantic-composer",
      "#outer-semantic-send",
    ],
    [
      "native composer with a hidden Send",
      CLAUDE_NESTED_HIDDEN_NATIVE_SEND_FIXTURE,
      "#inner-native-composer",
      "#outer-native-send",
    ],
  ])(
    "fails closed instead of falling back from an inner %s to an outer Send",
    (_variant, fixture, composerSelector, outerSendSelector) => {
      renderFixture(fixture);
      const composer = document.querySelector(composerSelector);
      const outerSend = document.querySelector(outerSendSelector);
      expect(composer).toBeInstanceOf(HTMLElement);
      expect(outerSend).toBeInstanceOf(HTMLElement);
      if (
        !(composer instanceof HTMLElement) ||
        !(outerSend instanceof HTMLElement)
      ) {
        throw new Error("Missing nested unusable Send fixture.");
      }

      expect(resolveSubmissionElements(document)).toBeNull();
      expect(
        resolveComposerSubmissionFromTarget(document, composer),
      ).toMatchObject({ kind: "strong_candidate_unresolved" });
      expect(
        resolveSendSubmissionFromTarget(document, outerSend),
      ).toMatchObject({ kind: "strong_candidate_unresolved" });
    },
  );

  it("fails closed for two usable composers with one shared Send", () => {
    renderFixture(CLAUDE_TWO_COMPOSERS_ONE_SEND_FIXTURE);
    const composer = document.querySelector("#composer-a");
    const send = document.querySelector("#shared-send");
    expect(composer).toBeInstanceOf(HTMLElement);
    expect(send).toBeInstanceOf(HTMLElement);
    if (!(composer instanceof HTMLElement) || !(send instanceof HTMLElement)) {
      throw new Error("Missing shared Send fixture.");
    }
    expect(resolveComposerSubmissionFromTarget(document, composer)).toEqual({
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    });
    expect(resolveSendSubmissionFromTarget(document, send)).toEqual({
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    });
  });

  it("fails closed when semantic and native submit controls coexist", () => {
    renderFixture(CLAUDE_MIXED_SEND_CONTROLS_FIXTURE);
    const composer = document.querySelector("#mixed-composer");
    const semanticSend = document.querySelector("#semantic-send");
    const nativeSubmit = document.querySelector("#native-submit");
    expect(composer).toBeInstanceOf(HTMLElement);
    expect(semanticSend).toBeInstanceOf(HTMLElement);
    expect(nativeSubmit).toBeInstanceOf(HTMLButtonElement);
    if (
      !(composer instanceof HTMLElement) ||
      !(semanticSend instanceof HTMLElement) ||
      !(nativeSubmit instanceof HTMLButtonElement)
    ) {
      throw new Error("Missing mixed Send controls fixture.");
    }

    expect(resolveSubmissionElements(document)).toBeNull();
    expect(diagnoseSubmissionElements(document)).toEqual({
      context: null,
      healthCode: "ambiguous_submission_context",
    });
    expect(resolveComposerSubmissionFromTarget(document, composer)).toEqual({
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    });
    expect(resolveSendSubmissionFromTarget(document, semanticSend)).toEqual({
      kind: "strong_candidate_unresolved",
      healthCode: "ambiguous_submission_context",
    });
  });

  it.each([
    [
      "button",
      CLAUDE_NATIVE_BUTTON_SUBMIT_FIXTURE,
      "#native-button-composer",
      "#native-button-submit",
    ],
    [
      "input",
      CLAUDE_NATIVE_INPUT_SUBMIT_FIXTURE,
      "#native-input-composer",
      "#native-input-submit",
    ],
  ])(
    "resolves a direct native %s submit target as its owned submission candidate",
    (_kind, fixture, composerSelector, sendSelector) => {
      renderFixture(fixture);
      const composer = document.querySelector(composerSelector);
      const send = document.querySelector(sendSelector);
      expect(composer).toBeInstanceOf(HTMLTextAreaElement);
      expect(send).toBeInstanceOf(HTMLElement);
      if (
        !(composer instanceof HTMLTextAreaElement) ||
        !(send instanceof HTMLElement)
      ) {
        throw new Error("Missing native submit ownership fixture.");
      }

      const resolved = resolveSubmissionElements(document);
      expect(resolved).toMatchObject({ composer, sendControl: send });
      expect(resolveSendSubmissionFromTarget(document, send)).toEqual({
        kind: "resolved",
        context: resolved,
      });
    },
  );
});
