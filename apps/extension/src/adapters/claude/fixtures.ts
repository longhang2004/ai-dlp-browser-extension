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
