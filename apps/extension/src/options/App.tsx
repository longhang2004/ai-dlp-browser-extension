import {
  CONFIGURABLE_PROTECTION_ACTIONS,
  normalizeProtectedKeyword,
  type ConfigurableProtectionAction,
  type ProtectionSettings,
  type SettingsValidationError,
} from "@ai-dlp/shared-types";
import { useEffect, useState, type FormEvent } from "react";

import {
  getInstalledPageRuntime,
  sendPageRequest,
  type ExtensionPageRuntime,
} from "../ui/page-runtime.js";

type FormState = {
  protectionEnabled: boolean;
  emailAction: ConfigurableProtectionAction;
  phoneAction: ConfigurableProtectionAction;
  attachmentAction: ConfigurableProtectionAction;
  protectedKeywords: string;
  auditRetentionLimit: string;
};

const FIELD_ERROR_COPY: Record<SettingsValidationError["field"], string> = {
  settings: "Settings could not be validated.",
  protectionEnabled: "Protection state is invalid.",
  emailAction: "Email action is invalid.",
  phoneAction: "Phone action is invalid.",
  attachmentAction: "Attachment action is invalid.",
  protectedKeywords: "Protected keywords are invalid.",
  auditRetentionLimit: "Audit retention limit is invalid.",
};

function toFormState(settings: ProtectionSettings): FormState {
  return {
    protectionEnabled: settings.protectionEnabled,
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
    emailAction: form.emailAction,
    phoneAction: form.phoneAction,
    attachmentAction: form.attachmentAction,
    protectedKeywords,
    auditRetentionLimit,
  };
}

export function App({ runtime }: { runtime?: ExtensionPageRuntime }) {
  const [form, setForm] = useState<FormState | null>(null);
  const [notice, setNotice] = useState("Loading validated settings…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    void Promise.resolve()
      .then(() =>
        sendPageRequest(runtime ?? getInstalledPageRuntime(), {
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
    return () => {
      current = false;
    };
  }, [runtime]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (form === null) return;
    const settings = createSettings(form);
    if (settings === undefined) {
      setNotice("Settings could not be validated.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const response = await sendPageRequest(
        runtime ?? getInstalledPageRuntime(),
        { type: "settings.save", settings },
      );
      if (response.type === "settings.saved") {
        setForm(toFormState(response.envelope.settings));
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
      setNotice("Settings could not be saved.");
    } finally {
      setSaving(false);
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
