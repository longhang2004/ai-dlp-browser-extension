import {
  cloneProtectionSettings,
  type ConfigurableProtectionAction,
  type ReadonlyPromptFreeArray,
  type ReadonlyProtectionSettings,
} from "@ai-dlp/shared-types";

export type EnforcementRevision = number;

export type EnforcementSettings = {
  readonly protectionEnabled: boolean;
  readonly emailAction: ConfigurableProtectionAction;
  readonly phoneAction: ConfigurableProtectionAction;
  readonly attachmentAction: ConfigurableProtectionAction;
  readonly protectedKeywords: ReadonlyPromptFreeArray<string>;
};

export function snapshotEnforcementSettings(
  value: ReadonlyProtectionSettings,
): EnforcementSettings {
  const settings = cloneProtectionSettings(value);
  return Object.freeze({
    protectionEnabled: settings.protectionEnabled,
    emailAction: settings.emailAction,
    phoneAction: settings.phoneAction,
    attachmentAction: settings.attachmentAction,
    protectedKeywords: Object.freeze([
      ...settings.protectedKeywords,
    ]) as ReadonlyPromptFreeArray<string>,
  });
}

export function areEnforcementSettingsEqual(
  left: EnforcementSettings,
  right: EnforcementSettings,
): boolean {
  if (
    left.protectionEnabled !== right.protectionEnabled ||
    left.emailAction !== right.emailAction ||
    left.phoneAction !== right.phoneAction ||
    left.attachmentAction !== right.attachmentAction ||
    left.protectedKeywords.length !== right.protectedKeywords.length
  ) {
    return false;
  }
  return left.protectedKeywords.every(
    (keyword, index) => keyword === right.protectedKeywords[index],
  );
}
