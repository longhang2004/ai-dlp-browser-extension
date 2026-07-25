export type PromptDerivedBoundary = {
  prompt?: never;
  text?: never;
  rawPrompt?: never;
  promptText?: never;
  matchedText?: never;
  matchedValue?: never;
  redactedText?: never;
  sanitizedPrompt?: never;
  start?: never;
  end?: never;
  offsets?: never;
  sanitizedText?: never;
  promptExcerpt?: never;
  rawText?: never;
  composerText?: never;
  composerContents?: never;
  userText?: never;
  userAuthoredExcerpt?: never;
  originalText?: never;
  findingText?: never;
  matchedSubstring?: never;
  payload?: never;
  metadata?: never;
  data?: never;
  content?: never;
  originalFindings?: never;
  element?: never;
  applicationUrl?: never;
};

export type NoFindingsBoundary = {
  findings?: never;
};

export type PromptFreeBoundary = PromptDerivedBoundary & NoFindingsBoundary;

export type PromptFreeArray<Item> = Array<Item> &
  PromptDerivedBoundary &
  NoFindingsBoundary;

export type ReadonlyPromptFreeArray<Item> = ReadonlyArray<Item> &
  PromptDerivedBoundary &
  NoFindingsBoundary;
