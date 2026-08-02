/**
 * Claude selectors use application semantics only. Generated classes, DOM
 * position, and element IDs are deliberately not part of the contract.
 */
export const CLAUDE_SELECTORS = Object.freeze({
  composerRegion:
    'form[aria-label="Chat composer"], [data-testid="chat-composer"], [role="group"][aria-label="Chat composer"]',
  composer:
    'textarea[aria-label="Message Claude"], textarea[data-testid="chat-input"], [role="textbox"][contenteditable="true"][aria-label="Message Claude"], [role="textbox"][contenteditable="plaintext-only"][aria-label="Message Claude"], [data-testid="chat-input"] [contenteditable="true"], [data-testid="chat-input"] [contenteditable="plaintext-only"]',
  send: 'button[aria-label="Send message"], [role="button"][aria-label="Send message"], button[aria-label="Send"], [role="button"][aria-label="Send"], button[data-testid="send-button"], [role="button"][data-testid="send-button"]',
  nativeSubmit: 'button[type="submit"], input[type="submit"]',
  attachmentEvidence:
    '[data-testid="attachment-chip"], [data-testid="file-preview"], [aria-label="Remove attachment"], [aria-label^="Remove file"]',
} as const);

export const CLAUDE_COMPOSER_SELECTORS = Object.freeze([
  CLAUDE_SELECTORS.composer,
] as const);

export const CLAUDE_ORIGIN = "https://claude.ai" as const;
