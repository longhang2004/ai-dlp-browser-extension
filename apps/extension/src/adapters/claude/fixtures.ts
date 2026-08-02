/** Synthetic, privacy-safe structural fixtures. They contain no page data. */
export const CLAUDE_SEMANTIC_COMPOSER_FIXTURE = `
  <main>
    <form aria-label="Chat composer" data-fixture="semantic">
      <div role="textbox" contenteditable="true" aria-label="Message Claude"></div>
      <button type="button" aria-label="Send message">Send</button>
    </form>
  </main>
`;

export const CLAUDE_DATA_COMPOSER_FIXTURE = `
  <main>
    <section data-testid="chat-composer">
      <textarea data-testid="chat-input" aria-label="Message Claude"></textarea>
      <button type="button" data-testid="send-button" aria-label="Send">Send</button>
    </section>
  </main>
`;

export const CLAUDE_SHARED_SEND_FIXTURE = `
  <main>
    <section data-testid="chat-composer">
      <div role="textbox" contenteditable="true" aria-label="Message Claude"></div>
      <div role="textbox" contenteditable="true" aria-label="Message Claude"></div>
      <button type="button" data-testid="send-button" aria-label="Send message">Send</button>
    </section>
  </main>
`;

export const CLAUDE_UNRELATED_SEMANTIC_FIXTURE = `
  <form aria-label="Search">
    <textarea aria-label="Search"></textarea>
    <button type="submit">Search</button>
  </form>
  <section aria-label="Document editor">
    <div role="textbox" contenteditable="true" aria-label="Document body"></div>
    <button type="button" aria-label="Save">Save</button>
  </section>
`;

/** A nested form relies on its outer semantic composer for Send ownership. */
export const CLAUDE_NESTED_OUTER_COMPOSER_FIXTURE = `
  <section data-testid="chat-composer" id="outer-composer">
    <div data-testid="attachment-chip" id="outer-attachment"></div>
    <form aria-label="Chat composer" id="nested-composer-form">
      <textarea data-testid="chat-input" aria-label="Message Claude" id="nested-composer"></textarea>
    </form>
    <button type="button" data-testid="send-button" aria-label="Send" id="outer-send">Send</button>
  </section>
`;

/** Two nested semantic regions each expose an independent composer/Send pair. */
export const CLAUDE_NESTED_REGIONS_FIXTURE = `
  <section data-testid="chat-composer" id="outer-composer">
    <form aria-label="Chat composer" id="nested-composer-form">
      <textarea data-testid="chat-input" aria-label="Message Claude" id="nested-composer"></textarea>
      <button type="button" data-testid="send-button" aria-label="Send" id="nested-send">Send</button>
    </form>
    <div role="textbox" contenteditable="true" aria-label="Message Claude" id="outer-composer-input"></div>
    <button type="button" data-testid="send-button" aria-label="Send" id="outer-send">Send</button>
  </section>
`;

/** A nested semantic composer has a matching disabled Send and must not fall back to an outer Send. */
export const CLAUDE_NESTED_DISABLED_SEMANTIC_SEND_FIXTURE = `
  <section data-testid="chat-composer" id="outer-composer">
    <form aria-label="Chat composer" id="inner-semantic-region">
      <div role="textbox" contenteditable="true" aria-label="Message Claude" id="inner-semantic-composer"></div>
      <button type="button" aria-label="Send" id="inner-semantic-send" disabled>Send</button>
    </form>
    <button type="button" data-testid="send-button" aria-label="Send" id="outer-semantic-send">Send</button>
  </section>
`;

/** A nested native composer has a matching hidden submit and must not fall back to an outer Send. */
export const CLAUDE_NESTED_HIDDEN_NATIVE_SEND_FIXTURE = `
  <section data-testid="chat-composer" id="outer-composer">
    <form aria-label="Chat composer" id="inner-native-region">
      <textarea data-testid="chat-input" aria-label="Message Claude" id="inner-native-composer"></textarea>
      <button type="submit" id="inner-native-send" hidden>Send</button>
    </form>
    <button type="button" data-testid="send-button" aria-label="Send" id="outer-native-send">Send</button>
  </section>
`;

/** Two usable composers under one semantic region share the only Send control. */
export const CLAUDE_TWO_COMPOSERS_ONE_SEND_FIXTURE = `
  <section data-testid="chat-composer" id="shared-region">
    <textarea data-testid="chat-input" aria-label="Message Claude" id="composer-a"></textarea>
    <textarea data-testid="chat-input" aria-label="Message Claude" id="composer-b"></textarea>
    <button type="button" data-testid="send-button" aria-label="Send" id="shared-send">Send</button>
  </section>
`;

/** A semantic Send and a native submit control share one form region. */
export const CLAUDE_MIXED_SEND_CONTROLS_FIXTURE = `
  <form aria-label="Chat composer" id="mixed-region">
    <textarea data-testid="chat-input" aria-label="Message Claude" id="mixed-composer"></textarea>
    <button type="button" data-testid="send-button" aria-label="Send" id="semantic-send">Semantic Send</button>
    <button type="submit" id="native-submit">Native Submit</button>
  </form>
`;

/** Native submit controls are valid send candidates when owned by the Claude form. */
export const CLAUDE_NATIVE_BUTTON_SUBMIT_FIXTURE = `
  <form aria-label="Chat composer" id="native-button-region">
    <textarea data-testid="chat-input" aria-label="Message Claude" id="native-button-composer"></textarea>
    <button type="submit" id="native-button-submit">Native Button Submit</button>
  </form>
`;

export const CLAUDE_NATIVE_INPUT_SUBMIT_FIXTURE = `
  <form aria-label="Chat composer" id="native-input-region">
    <textarea data-testid="chat-input" aria-label="Message Claude" id="native-input-composer"></textarea>
    <input type="submit" id="native-input-submit" value="Native Input Submit" />
  </form>
`;
