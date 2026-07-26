/**
 * ChatGPT DOM selectors are intentionally centralized here. The ordered
 * strategies prefer browser semantics and accessible relationships over
 * implementation styling. Generated CSS classes are deliberately unsupported.
 */
export const CHATGPT_SELECTORS = Object.freeze({
  nativeForm: "form",
  promptTextarea:
    '#prompt-textarea[contenteditable="true"], #prompt-textarea[contenteditable="plaintext-only"]',
  nativeComposer:
    'form[aria-label="Chat composer"] textarea, [role="form"][aria-label="Chat composer"] textarea',
  semanticEditable:
    'form[aria-label="Chat composer"] [contenteditable="true"], form[aria-label="Chat composer"] [contenteditable="plaintext-only"], [role="form"][aria-label="Chat composer"] [contenteditable="true"], [role="form"][aria-label="Chat composer"] [contenteditable="plaintext-only"]',
  ariaEditable:
    'textarea[aria-label="Message ChatGPT"], [role="textbox"][aria-label="Message ChatGPT"][contenteditable="true"], [role="textbox"][aria-label="Message ChatGPT"][contenteditable="plaintext-only"]',
  stableDataEditable:
    '[data-testid="composer-root"] textarea, [data-testid="composer-root"] [contenteditable="true"], [data-testid="composer-root"] [contenteditable="plaintext-only"], [data-testid="composer-textarea"][contenteditable="true"], [data-testid="composer-textarea"][contenteditable="plaintext-only"]',
  nativeSubmit: 'button[type="submit"], input[type="submit"]',
  ariaSend:
    'button[aria-label="Send prompt"], button[aria-label="Send message"], [role="button"][aria-label="Send prompt"], [role="button"][aria-label="Send message"]',
  stableDataSend:
    '[data-testid="send-button"], [data-testid="fruitjuice-send-button"]',
  semanticRoleFormRegion: '[role="form"][aria-label="Chat composer"]',
  composerRegion:
    'form, [role="form"][aria-label], [aria-label="Chat composer"], [data-testid="composer-root"]',
  knownSendCandidate:
    'form[aria-label="Chat composer"] button[type="submit"], form[aria-label="Chat composer"] input[type="submit"], [role="form"][aria-label="Chat composer"] button[type="submit"], [role="form"][aria-label="Chat composer"] input[type="submit"], button[aria-label="Send prompt"], button[aria-label="Send message"], [role="button"][aria-label="Send prompt"], [role="button"][aria-label="Send message"], [data-testid="send-button"], [data-testid="fruitjuice-send-button"]',
} as const);

export const ORDERED_COMPOSER_SELECTORS = Object.freeze([
  CHATGPT_SELECTORS.promptTextarea,
  CHATGPT_SELECTORS.nativeComposer,
  CHATGPT_SELECTORS.semanticEditable,
  CHATGPT_SELECTORS.ariaEditable,
  CHATGPT_SELECTORS.stableDataEditable,
] as const);
