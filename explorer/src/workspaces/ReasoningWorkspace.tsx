import { useCallback, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { BrainCircuit, Play, RotateCcw, CheckCircle2, AlertCircle, Zap, GitBranch, Info, ListTree, Workflow } from "lucide-react";
import { DecisionChainHandoff } from "./DecisionChainHandoff";

const TEMPLATES: { labelKey: MessageKey; textKey: MessageKey }[] = [
  { labelKey: "reason.order", textKey: "reason.sampleOrder" },
  { labelKey: "reason.drug", textKey: "reason.sampleDrug" },
  { labelKey: "reason.gene", textKey: "reason.sampleGene" },
  { labelKey: "reason.pathway", textKey: "reason.samplePathway" },
];

type ReasoningResult = {
  facts?: string[];
  rules?: string[];
  inferred_facts?: string[];
  answer?: string;
  reason?: string;
  rules_fired?: number;
  added_edges?: number;
  mutated?: boolean;
};

function ToggleRow({ checked, onChange, title, help }: { checked: boolean; onChange: (value: boolean) => void; title: string; help: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: "var(--ws-radius-sm)", border: "1px solid var(--ws-border)", background: checked ? "var(--ws-green-soft)" : "var(--ws-surface)" }}>
      <div style={{ position: "relative", width: 36, height: 20, flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ opacity: 0, position: "absolute", inset: 0, cursor: "pointer", margin: 0 }}
        />
        <div style={{ position: "absolute", inset: 0, borderRadius: 999, background: checked ? "var(--ws-green)" : "rgba(255,255,255,0.12)", transition: "background 180ms ease" }} />
        <div style={{ position: "absolute", top: 3, left: checked ? 19 : 3, width: 14, height: 14, borderRadius: 999, background: "#fff", transition: "left 180ms ease", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: checked ? "#6ee7b7" : "var(--ws-text-muted)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--ws-text-dim)" }}>{help}</div>
      </div>
    </label>
  );
}

function StatementList({ title, icon, items, accent }: { title: string; icon: ReactNode; items: string[]; accent?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="ws-eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>{icon}{title}</div>
      {items.map((item, i) => (
        <div key={`${item}-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: "var(--ws-radius-sm)", background: "var(--ws-surface)", border: "1px solid var(--ws-border)" }}>
          {accent && (
            <div style={{ width: 20, height: 20, borderRadius: 6, background: "var(--ws-green-soft)", border: "1px solid rgba(76,195,138,0.28)", display: "grid", placeItems: "center", flexShrink: 0, marginTop: 1 }}>
              <CheckCircle2 size={11} color="var(--ws-green)" />
            </div>
          )}
          <code style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 12, color: accent ? "var(--ws-text)" : "var(--ws-text-muted)", lineHeight: 1.6, wordBreak: "break-all" }}>{item}</code>
        </div>
      ))}
    </div>
  );
}

export function ReasoningWorkspace() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [text, setText] = useState(() => t("reason.sampleOrder"));
  const [applyToGraph, setApplyToGraph] = useState(false);
  const [useGraphFacts, setUseGraphFacts] = useState(true);
  const [result, setResult] = useState<ReasoningResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState<"off" | "play" | "done">("off");
  const [runId, setRunId] = useState(0);
  const runToken = useRef(0);

  const finishHandoff = useCallback((id: number, flew: boolean) => {
    if (id !== runToken.current) return;
    if (flew) window.dispatchEvent(new CustomEvent("semantica:decision-landed"));
    setHandoff("done");
  }, []);

  async function handleRun() {
    const token = runToken.current + 1;
    runToken.current = token;
    setRunId(token);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setIsRunning(true);
    setError("");
    setResult(null);
    setHandoff(reduceMotion ? "off" : "play");
    try {
      const response = await fetch("/api/reason/natural", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), apply_to_graph: applyToGraph, use_graph_facts: useGraphFacts }),
      });
      const data = await response.json();
      if (token !== runToken.current) return;
      if (response.status === 503) throw new Error(t("reason.llmMissing"));
      if (response.status === 502) throw new Error(t("reason.llmFailed", { detail: data.detail ?? "" }));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Status ${response.status}`);
      setResult(data);
      if (reduceMotion) setHandoff("done");
      if (data.mutated) queryClient.invalidateQueries({ queryKey: ["graph", "full-load"] });
    } catch (e) {
      if (token !== runToken.current) return;
      setHandoff("off");
      setError(e instanceof Error ? e.message : "Reasoning failed");
    } finally {
      if (token === runToken.current) setIsRunning(false);
    }
  }

  function loadText(value: string) {
    runToken.current += 1;
    setRunId(runToken.current);
    setText(value);
    setResult(null);
    setError("");
    setIsRunning(false);
    setHandoff("off");
  }

  const sequenceBusy = isRunning || handoff === "play";

  const inferred = result?.inferred_facts ?? [];

  return (
    <div className="ws-page" style={{ flexDirection: "row" }}>
      {/* ── Left: Input panel ── */}
      <div style={{ width: 480, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid var(--ws-border)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--ws-border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--ws-accent-soft)", border: "1px solid var(--ws-border-strong)", display: "grid", placeItems: "center", color: "var(--ws-accent)", flexShrink: 0 }}>
              <BrainCircuit size={16} />
            </div>
            <div>
              <div className="ws-eyebrow" style={{ marginBottom: 2 }}>{t("reason.kicker")}</div>
              <div style={{ color: "var(--ws-text)", fontWeight: 700, fontSize: 15, lineHeight: 1 }}>{t("reason.title")}</div>
            </div>
          </div>
        </div>

        {/* Templates */}
        <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--ws-border)", flexShrink: 0 }}>
          <div className="ws-eyebrow" style={{ marginBottom: 8 }}>{t("reason.templates")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TEMPLATES.map((template) => (
              <button key={template.labelKey} className="ws-btn ws-btn--ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => loadText(t(template.textKey))}>
                {t(template.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Input area */}
        <div className="ws-scroll ws-padded" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label className="ws-label">{t("reason.input")}</label>
            <div className="ws-body" style={{ marginBottom: 8 }}>{t("reason.inputHelp")}</div>
            <textarea
              className="ws-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("reason.inputPlaceholder")}
              rows={10}
              maxLength={8000}
            />
          </div>

          <ToggleRow checked={useGraphFacts} onChange={setUseGraphFacts} title={t("reason.useGraph")} help={t("reason.useGraphHelp")} />
          <ToggleRow checked={applyToGraph} onChange={setApplyToGraph} title={t("reason.write")} help={t("reason.writeHelp")} />

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="ws-btn ws-btn--primary"
              onClick={handleRun}
              disabled={sequenceBusy || !text.trim()}
              style={{ flex: 1, justifyContent: "center" }}
            >
              {sequenceBusy
                ? <><span className="ws-spin" style={{ display: "inline-block" }}><Zap size={15} /></span>{t("reason.running")}</>
                : <><Play size={14} />{t("reason.run")}</>}
            </button>
            <button className="ws-btn ws-btn--ghost" onClick={() => loadText(t("reason.sampleOrder"))} title={t("reason.reset")}>
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: Results panel ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--ws-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ws-text)" }}>{t("reason.results")}</div>
          {result && handoff === "done" && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <span className="ws-pill ws-pill--accent">
                <Zap size={9} /> {t("reason.rulesFired", { count: result.rules_fired ?? 0 })}
              </span>
              <span className="ws-pill ws-pill--green">
                <GitBranch size={9} /> {t("reason.edgesAdded", { count: result.added_edges ?? 0 })}
              </span>
              {result.mutated
                ? <span className="ws-pill ws-pill--green">{t("reason.updated")}</span>
                : <span className="ws-pill ws-pill--mono">{t("reason.previewOnly")}</span>}
            </div>
          )}
        </div>

        {handoff === "play" ? (
          <DecisionChainHandoff key={runId} runId={runId} source={result} onLanded={finishHandoff} />
        ) : (
        <div className="ws-scroll ws-padded" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {error && (
            <div className="ws-animate-in" style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: "var(--ws-radius-sm)", background: "var(--ws-red-soft)", border: "1px solid rgba(255,123,114,0.28)", color: "#fca5a5", fontSize: 13 }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>{error}</div>
            </div>
          )}

          {isRunning && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3,4].map((i) => <div key={i} className="ws-skeleton" style={{ height: 52 }} />)}
            </div>
          )}

          {result && handoff === "done" && (
            <div className="ws-animate-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {result.answer ? (
                <div style={{ padding: "16px 18px", borderRadius: "var(--ws-radius)", background: "var(--ws-green-soft)", border: "1px solid rgba(76,195,138,0.28)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="ws-eyebrow">{t("reason.verdict")}</div>
                  <div style={{ color: "var(--ws-text)", fontSize: 18, fontWeight: 700 }}>{result.answer}</div>
                  {result.reason ? (
                    <div style={{ color: "var(--ws-text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                      <span style={{ color: "var(--ws-text)", fontWeight: 700 }}>{t("reason.why")} </span>
                      {result.reason}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {inferred.length === 0 && !result.answer ? (
                <div className="ws-empty">
                  <div className="ws-empty-icon"><CheckCircle2 size={32} /></div>
                  <div className="ws-empty-title">{t("reason.complete")}</div>
                  <div className="ws-empty-body">{t("reason.none")}</div>
                </div>
              ) : (
                <StatementList title={t("reason.inferred")} icon={<CheckCircle2 size={11} />} items={inferred} accent />
              )}
              <StatementList title={t("reason.rules")} icon={<Workflow size={11} />} items={result.rules ?? []} />
              <StatementList title={t("reason.facts")} icon={<ListTree size={11} />} items={result.facts ?? []} />
            </div>
          )}

          {!result && !isRunning && !error && (
            <div className="ws-empty">
              <div className="ws-empty-icon"><Info size={32} /></div>
              <div className="ws-empty-title">{t("reason.ready")}</div>
              <div className="ws-empty-body">{t("reason.readyHelp")}</div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
