import {
  CONFIGURABLE_PROTECTION_ACTIONS,
  normalizeProtectedKeyword,
  type ConfigurableProtectionAction,
  type ProtectionSettings,
  type SettingsValidationError,
  type SurfaceSettings,
} from "@ai-dlp/shared-types";
import {
  CLAUDE_HOST_PERMISSION_PATTERN,
  CLAUDE_PERMISSION_SCOPE,
  type PermissionApi,
  type PermissionScope,
} from "@ai-dlp/shared-types/permissions";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  getInstalledPageRuntime,
  sendPageRequest,
  type ExtensionPageRuntime,
} from "../ui/page-runtime.js";

type FormState = {
  protectionEnabled: boolean;
  surfaces: SurfaceSettings[];
  emailAction: ConfigurableProtectionAction;
  phoneAction: ConfigurableProtectionAction;
  attachmentAction: ConfigurableProtectionAction;
  protectedKeywords: string;
  auditRetentionLimit: string;
};

type ClaudePermissionState = {
  host: boolean;
  named: boolean;
  joint: boolean;
};

const CLAUDE_HOST_SCOPE: PermissionScope = {
  permissions: [],
  origins: [CLAUDE_HOST_PERMISSION_PATTERN],
};
const CLAUDE_NAMED_SCOPE: PermissionScope = {
  permissions: ["scripting"],
  origins: [],
};

async function readClaudePermissionState(
  permissions: PermissionApi,
): Promise<ClaudePermissionState> {
  const [host, named, joint] = await Promise.all([
    permissions.contains(CLAUDE_HOST_SCOPE),
    permissions.contains(CLAUDE_NAMED_SCOPE),
    permissions.contains(CLAUDE_PERMISSION_SCOPE),
  ]);
  return { host, named, joint };
}

function mergePermissionDerivedFields(
  persisted: FormState,
  current: FormState,
  permissions: ClaudePermissionState | null,
): FormState {
  const currentClaudeEnabled =
    current.surfaces.find((surface) => surface.surfaceId === "claude_web")
      ?.enabled ?? false;
  const accessIsGranted =
    permissions !== null &&
    permissions.joint &&
    permissions.host &&
    permissions.named;
  return {
    ...persisted,
    surfaces: persisted.surfaces.map((surface) =>
      surface.surfaceId === "claude_web"
        ? {
            ...surface,
            enabled: accessIsGranted ? currentClaudeEnabled : false,
          }
        : surface,
    ),
  };
}

const FIELD_ERROR_COPY: Record<SettingsValidationError["field"], string> = {
  settings: "Settings could not be validated.",
  protectionEnabled: "Protection state is invalid.",
  surfaces: "Surface settings are invalid.",
  emailAction: "Email action is invalid.",
  phoneAction: "Phone action is invalid.",
  attachmentAction: "Attachment action is invalid.",
  protectedKeywords: "Protected keywords are invalid.",
  auditRetentionLimit: "Audit retention limit is invalid.",
};

function toFormState(settings: ProtectionSettings): FormState {
  return {
    protectionEnabled: settings.protectionEnabled,
    surfaces: settings.surfaces.map((surface) => ({ ...surface })),
    emailAction: settings.emailAction,
    phoneAction: settings.phoneAction,
    attachmentAction: settings.attachmentAction,
    protectedKeywords: settings.protectedKeywords.join("\n"),
    auditRetentionLimit: String(settings.auditRetentionLimit),
  };
}

function createSettings(form: FormState): ProtectionSettings | undefined {
  const protectedKeywords: string[] = [];
  for (const value of form.protectedKeywords.split(/\r?\n/u)) {
    if (value.trim() === "") continue;
    const normalized = normalizeProtectedKeyword(value);
    if (normalized === undefined) return undefined;
    protectedKeywords.push(normalized);
  }
  const auditRetentionLimit = Number(form.auditRetentionLimit);
  if (!Number.isSafeInteger(auditRetentionLimit)) return undefined;
  return {
    protectionEnabled: form.protectionEnabled,
    surfaces: form.surfaces.map((surface) => ({ ...surface })),
    emailAction: form.emailAction,
    phoneAction: form.phoneAction,
    attachmentAction: form.attachmentAction,
    protectedKeywords,
    auditRetentionLimit,
  };
}

export function App({ runtime }: { runtime?: ExtensionPageRuntime }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [claudePermissions, setClaudePermissions] = useState<{
    host: boolean;
    named: boolean;
    joint: boolean;
  } | null>(null);
  const [notice, setNotice] = useState("Loading validated settings…");
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(false);
  const permissionEpochRef = useRef(0);
  const claudePermissionsRef = useRef<ClaudePermissionState | null>(null);

  function commitClaudePermissions(next: ClaudePermissionState | null): void {
    claudePermissionsRef.current = next;
    setClaudePermissions(next);
  }

  function beginPermissionEpoch(): number {
    permissionEpochRef.current += 1;
    return permissionEpochRef.current;
  }

  function canCommitPermissionEpoch(epoch: number): boolean {
    return mountedRef.current && permissionEpochRef.current === epoch;
  }

  useEffect(() => {
    let current = true;
    mountedRef.current = true;
    beginPermissionEpoch();
    const pageRuntime = runtime ?? getInstalledPageRuntime();
    void Promise.resolve()
      .then(() =>
        sendPageRequest(pageRuntime, {
          type: "settings.read",
        }),
      )
      .then(
        (response) => {
          if (!current) return;
          if (response.type === "settings.result") {
            setForm(toFormState(response.envelope.settings));
            setNotice("");
          } else {
            setNotice("Settings are currently unavailable.");
          }
        },
        () => {
          if (current) setNotice("Settings are currently unavailable.");
        },
      );
    const permissions = pageRuntime.permissions;
    const refreshPermissions = (): void => {
      const epoch = beginPermissionEpoch();
      // Close the gate synchronously while the live permission read is in
      // flight. A stale save completion must not re-enable Claude in this
      // interval.
      commitClaudePermissions(null);
      if (permissions === undefined) {
        if (current && canCommitPermissionEpoch(epoch)) {
          commitClaudePermissions(null);
        }
        return;
      }
      void readClaudePermissionState(permissions).then(
        (state) => {
          if (current && canCommitPermissionEpoch(epoch)) {
            commitClaudePermissions(state);
          }
        },
        () => {
          if (current && canCommitPermissionEpoch(epoch)) {
            commitClaudePermissions(null);
          }
        },
      );
    };
    refreshPermissions();
    if (permissions !== undefined) {
      const handlePermissionChange = (): void => {
        refreshPermissions();
      };
      permissions.onAdded.addListener(handlePermissionChange);
      permissions.onRemoved.addListener(handlePermissionChange);
      return () => {
        current = false;
        mountedRef.current = false;
        beginPermissionEpoch();
        permissions.onAdded.removeListener(handlePermissionChange);
        permissions.onRemoved.removeListener(handlePermissionChange);
      };
    }
    return () => {
      current = false;
      mountedRef.current = false;
      beginPermissionEpoch();
    };
  }, [runtime]);

  function claudeEnabled(): boolean {
    return (
      form?.surfaces.find((surface) => surface.surfaceId === "claude_web")
        ?.enabled ?? false
    );
  }

  function setClaudeEnabled(enabled: boolean, epoch?: number): void {
    setForm((current) => {
      if (
        current === null ||
        (epoch !== undefined && !canCommitPermissionEpoch(epoch))
      ) {
        return current;
      }
      return {
        ...current,
        surfaces: current.surfaces.map((surface) =>
          surface.surfaceId === "claude_web"
            ? { ...surface, enabled }
            : surface,
        ),
      };
    });
  }

  async function requestClaudeAccess(): Promise<void> {
    const epoch = beginPermissionEpoch();
    commitClaudePermissions(null);
    const pageRuntime = runtime ?? getInstalledPageRuntime();
    const permissions: PermissionApi | undefined = pageRuntime.permissions;
    if (permissions === undefined) return;
    try {
      await permissions.request(CLAUDE_PERMISSION_SCOPE);
    } catch {
      // The follow-up live query below is authoritative after a denied/error.
    }
    try {
      const state = await readClaudePermissionState(permissions);
      if (canCommitPermissionEpoch(epoch)) commitClaudePermissions(state);
    } catch {
      if (canCommitPermissionEpoch(epoch)) commitClaudePermissions(null);
    }
  }

  async function removeClaudeAccess(): Promise<void> {
    const epoch = beginPermissionEpoch();
    commitClaudePermissions(null);
    const pageRuntime = runtime ?? getInstalledPageRuntime();
    const permissions = pageRuntime.permissions;
    if (permissions === undefined) return;
    let responseRemoved = false;
    try {
      const response = await sendPageRequest(pageRuntime, {
        type: "permissions.claude.remove",
      });
      responseRemoved =
        response.type === "permissions.claude.removed" && response.removed;
    } catch {
      // Keep showing the live permission state when transport/validation fails.
    }
    try {
      const state = await readClaudePermissionState(permissions);
      if (!canCommitPermissionEpoch(epoch)) return;
      commitClaudePermissions(state);
      if (responseRemoved && !state.host && !state.named) {
        setClaudeEnabled(false, epoch);
      }
    } catch {
      if (canCommitPermissionEpoch(epoch)) commitClaudePermissions(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form === null) return;
    const settings = createSettings(form);
    if (settings === undefined) {
      setNotice("Settings could not be validated.");
      return;
    }
    const savePermissionEpoch = permissionEpochRef.current;
    setSaving(true);
    setNotice("");
    try {
      const response = await sendPageRequest(
        runtime ?? getInstalledPageRuntime(),
        { type: "settings.save", settings },
      );
      if (!mountedRef.current) return;
      if (response.type === "settings.saved") {
        const persisted = toFormState(response.envelope.settings);
        setForm((current) =>
          current === null || permissionEpochRef.current === savePermissionEpoch
            ? persisted
            : mergePermissionDerivedFields(
                persisted,
                current,
                claudePermissionsRef.current,
              ),
        );
        setNotice("Settings saved.");
      } else if (
        response.type === "error" &&
        response.errorCode === "validation_failure"
      ) {
        setNotice(
          response.fieldErrors
            .map((error) => FIELD_ERROR_COPY[error.field])
            .filter((value, index, values) => values.indexOf(value) === index)
            .join(" "),
        );
      } else {
        setNotice("Settings could not be saved.");
      }
    } catch {
      if (mountedRef.current) setNotice("Settings could not be saved.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <main className="page-shell wide-shell">
      <p className="eyebrow">AI DLP</p>
      <h1>Protection settings</h1>
      <p className="lede">
        Inspection and enforcement stay inside this browser extension.
      </p>
      {form === null ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          <section className="card settings-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={form.protectionEnabled}
                onChange={(event) =>
                  setForm({ ...form, protectionEnabled: event.target.checked })
                }
              />
              Enable prompt protection on ChatGPT
            </label>
            <label>
              Email action
              <select
                value={form.emailAction}
                onChange={(event) =>
                  setForm({
                    ...form,
                    emailAction: event.target
                      .value as ConfigurableProtectionAction,
                  })
                }
              >
                {CONFIGURABLE_PROTECTION_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Phone action
              <select
                value={form.phoneAction}
                onChange={(event) =>
                  setForm({
                    ...form,
                    phoneAction: event.target
                      .value as ConfigurableProtectionAction,
                  })
                }
              >
                {CONFIGURABLE_PROTECTION_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <label htmlFor="attachment-action">Attachment handling</label>
              <select
                id="attachment-action"
                value={form.attachmentAction}
                onChange={(event) =>
                  setForm({
                    ...form,
                    attachmentAction: event.target
                      .value as ConfigurableProtectionAction,
                  })
                }
              >
                <option value="warn">
                  Warn and allow one-time bypass — Recommended
                </option>
                <option value="block">Block all attachments</option>
                <option value="allow">Allow attachments without warning</option>
              </select>
              <small>
                Attached file contents are not inspected in this version.
              </small>
              {form.attachmentAction === "allow" ? (
                <small role="note">
                  Files may contain sensitive information that the extension
                  cannot detect.
                </small>
              ) : null}
            </div>
            <div className="full-span field">
              <label htmlFor="protected-keywords">Protected keywords</label>
              <textarea
                id="protected-keywords"
                rows={6}
                value={form.protectedKeywords}
                onChange={(event) =>
                  setForm({ ...form, protectedKeywords: event.target.value })
                }
                aria-describedby="keyword-help"
              />
              <small id="keyword-help">One keyword or phrase per line.</small>
            </div>
            <label>
              Audit retention limit
              <input
                type="number"
                min="1"
                max="1000"
                step="1"
                value={form.auditRetentionLimit}
                onChange={(event) =>
                  setForm({ ...form, auditRetentionLimit: event.target.value })
                }
              />
            </label>
          </section>
          <section className="card">
            <h2>Claude web</h2>
            <p>Claude verification candidate</p>
            <p>
              PromptGuard can access only the AI applications that are
              explicitly enabled and granted permission.
            </p>
            <p>
              Origin: <code>{CLAUDE_HOST_PERMISSION_PATTERN}</code>
            </p>
            <p role="status">
              {claudePermissions === null
                ? "Access status is unavailable."
                : claudePermissions.joint &&
                    claudePermissions.host &&
                    claudePermissions.named
                  ? "Access is granted."
                  : claudePermissions.host || claudePermissions.named
                    ? "Access is partially granted."
                    : "Access is not granted."}
            </p>
            <div className="page-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void requestClaudeAccess()}
              >
                Grant Claude access
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={
                  claudePermissions === null ||
                  (!claudePermissions.host && !claudePermissions.named)
                }
                onClick={() => void removeClaudeAccess()}
              >
                Remove Claude access
              </button>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={claudeEnabled()}
                disabled={
                  !claudePermissions?.joint ||
                  !claudePermissions.host ||
                  !claudePermissions.named
                }
                onChange={(event) => setClaudeEnabled(event.target.checked)}
              />
              Enable Claude protection
            </label>
            <small>
              Loaded pages may need refresh after Claude access is removed.
            </small>
          </section>
          <div className="form-footer">
            <button className="button primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
            <p role="status" className="notice">
              {notice}
            </p>
          </div>
        </form>
      )}
    </main>
  );
}
