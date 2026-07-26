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

export const PRODUCTION_PROSEMIRROR_COMPOSER_FIXTURE = `
  <main>
    <form>
      <button aria-label="Open tools">Tools</button>
      <div
        id="prompt-textarea"
        class="ProseMirror"
        contenteditable="true"
        role="textbox"
      ><p>Example prompt</p></div>
      <button
        type="button"
        data-testid="send-button"
        aria-label="Send prompt"
      ><span>Send</span></button>
      <button type="button" aria-label="Stop generating">Stop</button>
    </form>
  </main>
`;
