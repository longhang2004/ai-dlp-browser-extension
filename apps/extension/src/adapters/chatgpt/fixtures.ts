export const NATIVE_TEXTAREA_COMPOSER_FIXTURE = `
  <main>
    <form aria-label="Chat composer">
      <label for="prompt-textarea">Message</label>
      <textarea id="prompt-textarea"></textarea>
      <button type="submit"><span>Send</span></button>
    </form>
  </main>
`;

export const CONTENTEDITABLE_COMPOSER_FIXTURE = `
  <main>
    <section data-testid="composer-root" aria-label="Chat composer">
      <div
        contenteditable="true"
        role="textbox"
        aria-label="Message ChatGPT"
        data-testid="composer-textarea"
      ></div>
      <button
        type="button"
        aria-label="Send prompt"
        data-testid="send-button"
      ><span>Send</span></button>
    </section>
  </main>
`;
