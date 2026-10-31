import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, PlugZap, Save, Trash2 } from "lucide-react";
import { useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";

type ModelKind = "llm" | "embedding" | "rerank";

type EndpointView = {
  base_url: string;
  model: string;
  has_api_key: boolean;
  configured: boolean;
  source: "saved" | "env" | "none";
};

type SettingsView = Record<ModelKind, EndpointView>;

type Draft = { base_url: string; model: string; api_key: string };

type ProbeResult = { ok: boolean; detail: string; latency_ms?: number };

type ActionId = "save" | "test" | "clear";

const modelCards: { kind: ModelKind; titleKey: MessageKey; hintKey: MessageKey; modelPlaceholder: string }[] = [
  { kind: "llm", titleKey: "models.llm", hintKey: "models.llmHint", modelPlaceholder: "qwen2.5-7b-instruct" },
  { kind: "embedding", titleKey: "models.embedding", hintKey: "models.embeddingHint", modelPlaceholder: "bge-m3" },
  { kind: "rerank", titleKey: "models.rerank", hintKey: "models.rerankHint", modelPlaceholder: "bge-reranker-v2-m3" },
];

const sourceLabels: Record<EndpointView["source"], MessageKey> = {
  saved: "models.sourceSaved",
  env: "models.sourceEnv",
  none: "models.sourceNone",
};

const emptyDraft: Draft = { base_url: "", model: "", api_key: "" };

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { detail?: string };
    return body.detail || "Request failed";
  } catch {
    return "Request failed";
  }
}

function ModelCard({
  kind,
  titleKey,
  hintKey,
  modelPlaceholder,
  view,
  onSaved,
}: {
  kind: ModelKind;
  titleKey: MessageKey;
  hintKey: MessageKey;
  modelPlaceholder: string;
  view: EndpointView;
  onSaved: (next: SettingsView) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, base_url: view.base_url, model: view.model });
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [result, setResult] = useState<ProbeResult | null>(null);

  useEffect(() => {
    setDraft({ base_url: view.base_url, model: view.model, api_key: "" });
  }, [view.base_url, view.model]);

  const payload = () => ({
    base_url: draft.base_url,
    model: draft.model,
    api_key: draft.api_key ? draft.api_key : null,
  });

  const requests: Record<ActionId, () => Promise<void>> = {
    save: async () => {
      const response = await fetch(`/api/settings/models/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!response.ok) throw new Error(await readError(response));
      onSaved(await response.json() as SettingsView);
      setResult({ ok: true, detail: t("models.saved") });
    },
    test: async () => {
      const response = await fetch(`/api/settings/models/${kind}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!response.ok) throw new Error(await readError(response));
      setResult(await response.json() as ProbeResult);
    },
    clear: async () => {
      const response = await fetch(`/api/settings/models/${kind}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      onSaved(await response.json() as SettingsView);
      setResult({ ok: true, detail: t("models.cleared") });
    },
  };

  async function run(action: ActionId) {
    setBusy(action);
    setResult(null);
    try {
      await requests[action]();
    } catch (reason: unknown) {
      setResult({ ok: false, detail: reason instanceof Error ? reason.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  }

  const actions: { id: ActionId; labelKey: MessageKey; icon: typeof Save; className: string }[] = [
    { id: "test", labelKey: "models.test", icon: PlugZap, className: "ws-btn ws-btn--ghost" },
    { id: "clear", labelKey: "models.clear", icon: Trash2, className: "ws-btn ws-btn--ghost" },
    { id: "save", labelKey: "models.save", icon: Save, className: "ws-btn ws-btn--primary" },
  ];

  const fields: { key: keyof Draft; labelKey: MessageKey; placeholder: string; type: string }[] = [
    { key: "base_url", labelKey: "models.baseUrl", placeholder: "http://host.docker.internal:8000/v1", type: "text" },
    { key: "model", labelKey: "models.model", placeholder: modelPlaceholder, type: "text" },
    {
      key: "api_key",
      labelKey: "models.apiKey",
      placeholder: view.has_api_key ? t("models.apiKeyKept") : t("models.apiKeyOptional"),
      type: "password",
    },
  ];

  return (
    <section className="ws-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 className="ws-title" style={{ fontSize: 15, flex: 1 }}>{t(titleKey)}</h3>
        <span className="ws-pill ws-pill--mono">{t(sourceLabels[view.source])}</span>
        {view.configured
          ? <CheckCircle2 size={15} color="var(--ws-green)" />
          : <AlertCircle size={15} color="var(--ws-text-muted)" />}
      </div>
      <div className="ws-body" style={{ fontSize: 12 }}>{t(hintKey)}</div>
      {fields.map((field) => (
        <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="ws-body" style={{ fontSize: 11 }}>{t(field.labelKey)}</span>
          <input
            className="ws-input"
            type={field.type}
            autoComplete="off"
            value={draft[field.key]}
            placeholder={field.placeholder}
            onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
          />
        </label>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {actions.map(({ id, labelKey, icon: Icon, className }) => (
          <button key={id} className={className} disabled={busy !== null} onClick={() => void run(id)}>
            {busy === id ? <Loader2 size={14} className="ws-spin" /> : <Icon size={14} />}
            {t(labelKey)}
          </button>
        ))}
      </div>
      {result ? (
        <div style={{ display: "flex", gap: 8, fontSize: 12, color: result.ok ? "var(--ws-green)" : "var(--ws-red)" }}>
          {result.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          <span style={{ wordBreak: "break-all" }}>
            {result.detail}
            {result.latency_ms !== undefined ? ` · ${result.latency_ms} ms` : ""}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function ModelSettingsWorkspace() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/settings/models")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<SettingsView>;
      })
      .then((view) => {
        if (active) setSettings(view);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Request failed");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="ws-page">
      <div className="ws-scroll" style={{ padding: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
          <div className="ws-body">{t("models.intro")}</div>
          {error ? (
            <div style={{ display: "flex", gap: 8, color: "var(--ws-red)", fontSize: 12 }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : null}
          {settings
            ? modelCards.map((card) => (
              <ModelCard key={card.kind} {...card} view={settings[card.kind]} onSaved={setSettings} />
            ))
            : null}
        </div>
      </div>
    </div>
  );
}
