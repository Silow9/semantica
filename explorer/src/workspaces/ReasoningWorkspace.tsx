import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import { BrainCircuit, Play, RotateCcw, CheckCircle2, AlertCircle, Zap, GitBranch, Info, ListTree, Workflow, History, Pencil, Plus, Trash2 } from "lucide-react";
import { DecisionChainHandoff } from "./DecisionChainHandoff";

const TEMPLATES: { labelKey: MessageKey; textKey: MessageKey }[] = [
  { labelKey: "reason.order", textKey: "reason.sampleOrder" },
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

const HISTORY_KEY = "semantica.reasoning.history";
const HISTORY_LIMIT = 40;

type ReasoningHistoryEntry = {
  id: string;
  createdAt: string;
  text: string;
  name?: string;
  nameLocked?: boolean;
  applyToGraph: boolean;
  useGraphFacts: boolean;
  result?: ReasoningResult;
};

function isHistoryEntry(value: unknown): value is ReasoningHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as ReasoningHistoryEntry;
  return typeof entry.id === "string"
    && typeof entry.createdAt === "string"
    && typeof entry.text === "string"
    && (entry.name === undefined || typeof entry.name === "string")
    && (entry.nameLocked === undefined || typeof entry.nameLocked === "boolean")
    && typeof entry.applyToGraph === "boolean"
    && typeof entry.useGraphFacts === "boolean"
    && (entry.result === undefined || (!!entry.result && typeof entry.result === "object"));
}

function readHistory(): ReasoningHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: ReasoningHistoryEntry[]) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    // Private mode or a full quota should not block the current result.
  }
}

function formatRunTime(iso: string, locale: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function historyTitle(text: string) {
  const line = text.trim().split("\n")[0] ?? "";
  return line || "";
}

function displayName(entry: ReasoningHistoryEntry, fallback: string) {
  return entry.name?.trim() || historyTitle(entry.text) || fallback;
}

const historyActionStyle: CSSProperties = {
  flexShrink: 0,
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--ws-text-dim)",
  cursor: "pointer",
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
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [text, setText] = useState(() => t("reason.sampleOrder"));
  const [applyToGraph, setApplyToGraph] = useState(false);
  const [useGraphFacts, setUseGraphFacts] = useState(true);
  const [result, setResult] = useState<ReasoningResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState<"off" | "play" | "done">("off");
  const [runId, setRunId] = useState(0);
  const [history, setHistory] = useState<ReasoningHistoryEntry[]>(() => readHistory());
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renamingIdRef = useRef<string | null>(null);
  renamingIdRef.current = renamingId;
  const runToken = useRef(0);
  const titleToken = useRef(0);
  const pendingTitle = useRef<{ id: string; title: string } | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const historyRef = useRef(history);
  historyRef.current = history;
  const activeHistoryIdRef = useRef(activeHistoryId);
  activeHistoryIdRef.current = activeHistoryId;

  const finishHandoff = useCallback((id: number, flew: boolean) => {
    if (id !== runToken.current) return;
    if (flew) window.dispatchEvent(new CustomEvent("semantica:decision-landed"));
    setHandoff("done");
  }, []);

  function writeEntries(entries: ReasoningHistoryEntry[]) {
    const next = entries.slice(0, HISTORY_LIMIT);
    writeHistory(next);
    return next;
  }

  function applyQuestion(value: string, sessionId = activeHistoryIdRef.current) {
    setText(value);
    if (!sessionId) return;
    setHistory((current) => writeEntries(current.map((entry) => {
      if (entry.id !== sessionId) return entry;
      if (entry.nameLocked) return { ...entry, text: value };
      const line = historyTitle(value);
      return { ...entry, text: value, name: line || undefined };
    })));
  }

  async function handleRun() {
    const token = runToken.current + 1;
    runToken.current = token;
    setRunId(token);
    const requestText = text.trim();
    const requestApply = applyToGraph;
    const requestGraph = useGraphFacts;
    const requestId = activeHistoryIdRef.current || crypto.randomUUID();
    const nameLocked = historyRef.current.find((entry) => entry.id === requestId)?.nameLocked;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!nameLocked && requestText) {
      const titleRequest = titleToken.current + 1;
      titleToken.current = titleRequest;
      void fetch("/api/reason/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: requestText }),
      }).then(async (titleResponse) => {
        if (titleRequest !== titleToken.current || !titleResponse.ok) return;
        const payload = await titleResponse.json() as { title?: unknown };
        const title = typeof payload.title === "string" ? payload.title.trim() : "";
        if (!title) return;
        pendingTitle.current = { id: requestId, title };
        setHistory((current) => {
          if (!current.some((entry) => entry.id === requestId)) return current;
          return writeEntries(current.map((entry) => (
            entry.id === requestId && !entry.nameLocked ? { ...entry, name: title } : entry
          )));
        });
      }).catch(() => undefined);
    }
    setIsRunning(true);
    setError("");
    setResult(null);
    setHandoff(reduceMotion ? "off" : "play");
    try {
      const response = await fetch("/api/reason/natural", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: requestText, apply_to_graph: requestApply, use_graph_facts: requestGraph }),
      });
      const data = await response.json();
      if (token !== runToken.current) return;
      if (response.status === 503) throw new Error(t("reason.llmMissing"));
      if (response.status === 502) throw new Error(t("reason.llmFailed", { detail: data.detail ?? "" }));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Status ${response.status}`);
      const entry: ReasoningHistoryEntry = {
        id: requestId,
        createdAt: new Date().toISOString(),
        text: requestText,
        applyToGraph: requestApply,
        useGraphFacts: requestGraph,
        result: data,
      };
      setHistory((current) => {
        const previous = current.find((item) => item.id === entry.id);
        const titled = pendingTitle.current?.id === entry.id ? pendingTitle.current.title : "";
        const saved = previous
          ? {
              ...previous,
              text: entry.text,
              applyToGraph: entry.applyToGraph,
              useGraphFacts: entry.useGraphFacts,
              result: data,
              ...(titled && !previous.nameLocked ? { name: titled } : {}),
            }
          : { ...entry, ...(titled ? { name: titled } : {}) };
        const next = [saved, ...current.filter((item) => item.id !== saved.id)];
        return writeEntries(next);
      });
      if (textRef.current.trim() === entry.text) setActiveHistoryId(entry.id);
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

  function startNewSession() {
    const entry: ReasoningHistoryEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      text: "",
      applyToGraph,
      useGraphFacts,
    };
    runToken.current += 1;
    titleToken.current += 1;
    setRunId(runToken.current);
    setText("");
    setResult(null);
    setError("");
    setIsRunning(false);
    setHandoff("off");
    setActiveHistoryId(entry.id);
    renamingIdRef.current = null;
    setRenamingId(null);
    setHistory((current) => writeEntries([entry, ...current]));
  }

  function loadText(value: string) {
    runToken.current += 1;
    setRunId(runToken.current);
    setResult(null);
    setError("");
    setIsRunning(false);
    setHandoff("off");
    const sessionId = activeHistoryIdRef.current;
    const session = historyRef.current.find((entry) => entry.id === sessionId);
    if (session && !session.result) {
      applyQuestion(value, session.id);
      return;
    }
    setText(value);
    setActiveHistoryId(null);
  }

  function loadHistory(entry: ReasoningHistoryEntry) {
    runToken.current += 1;
    titleToken.current += 1;
    setRunId(runToken.current);
    setText(entry.text);
    setApplyToGraph(entry.applyToGraph);
    setUseGraphFacts(entry.useGraphFacts);
    setResult(entry.result ?? null);
    setError("");
    setIsRunning(false);
    setHandoff(entry.result ? "done" : "off");
    setActiveHistoryId(entry.id);
  }

  function removeHistory(id: string) {
    setHistory((current) => {
      const next = current.filter((entry) => entry.id !== id);
      writeHistory(next);
      return next;
    });
    setActiveHistoryId((current) => (current === id ? null : current));
    if (renamingIdRef.current === id) {
      renamingIdRef.current = null;
      setRenamingId(null);
    }
  }

  function startRename(entry: ReasoningHistoryEntry) {
    renamingIdRef.current = entry.id;
    setRenamingId(entry.id);
    setRenameDraft(displayName(entry, t("reason.historyNew")));
  }

  function commitRename(id: string) {
    if (renamingIdRef.current !== id) return;
    const nextName = renameDraft.trim();
    renamingIdRef.current = null;
    setRenamingId(null);
    setHistory((current) => writeEntries(current.map((entry) => {
      if (entry.id !== id) return entry;
      if (!nextName || nextName === historyTitle(entry.text)) {
        const { name: _name, nameLocked: _locked, ...rest } = entry;
        return rest;
      }
      return { ...entry, name: nextName, nameLocked: true };
    })));
  }

  const sequenceBusy = isRunning || handoff === "play";

  const inferred = result?.inferred_facts ?? [];

  return (
    <div className="ws-page" style={{ flexDirection: "row" }}>
      <div className="ws-sidebar" style={{ width: 268 }}>
        <div className="ws-sidebar-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "var(--ws-accent-soft)", border: "1px solid var(--ws-border-strong)", display: "grid", placeItems: "center", color: "var(--ws-accent)", flexShrink: 0 }}>
              <History size={15} />
            </div>
            <div style={{ color: "var(--ws-text)", fontSize: 14, fontWeight: 700 }}>{t("reason.history")}</div>
            {history.length > 0 ? (
              <span className="ws-pill ws-pill--mono" style={{ marginLeft: "auto" }}>{history.length}</span>
            ) : null}
          </div>
        </div>
        <div className="ws-sidebar-body">
          <button
            type="button"
            className="ws-btn ws-btn--ghost"
            onClick={startNewSession}
            style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}
          >
            <Plus size={14} />
            {t("reason.historyNew")}
          </button>
          {history.length === 0 ? (
            <div className="ws-empty" style={{ padding: "28px 8px" }}>
              <div className="ws-empty-title">{t("reason.historyEmpty")}</div>
              <div className="ws-empty-body">{t("reason.historyEmptyHelp")}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {history.map((entry) => {
                const active = entry.id === activeHistoryId;
                return (
                  <div
                    key={entry.id}
                    className={`ws-list-item${active ? " ws-list-item--active" : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 6px 6px 12px" }}
                  >
                    {renamingId === entry.id ? (
                      <input
                        aria-label={t("reason.historyRename")}
                        value={renameDraft}
                        autoFocus
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename(entry.id);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            renamingIdRef.current = null;
                            setRenamingId(null);
                          }
                        }}
                        onBlur={() => commitRename(entry.id)}
                        style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: "var(--ws-text)", background: "var(--ws-surface)", border: "1px solid var(--ws-border-strong)", borderRadius: 8, padding: "6px 8px" }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => loadHistory(entry)}
                        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: 0, color: "inherit", cursor: "pointer", padding: "4px 0" }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: active ? "#e8f6ff" : "var(--ws-text)" }}>
                          {displayName(entry, t("reason.historyNew"))}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--ws-text-dim)" }}>{formatRunTime(entry.createdAt, locale)}</div>
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={t("reason.historyRename")}
                      title={t("reason.historyRename")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => (renamingId === entry.id ? commitRename(entry.id) : startRename(entry))}
                      style={historyActionStyle}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("reason.historyDelete")}
                      title={t("reason.historyDelete")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => removeHistory(entry.id)}
                      style={historyActionStyle}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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
              onChange={(e) => applyQuestion(e.target.value)}
              placeholder={t("reason.inputPlaceholder")}
              rows={10}
              maxLength={8000}
            />
          </div>

          <ToggleRow checked={useGraphFacts} onChange={(value) => {
            setUseGraphFacts(value);
            const sessionId = activeHistoryIdRef.current;
            if (!sessionId) return;
            setHistory((current) => writeEntries(current.map((entry) => entry.id === sessionId ? { ...entry, useGraphFacts: value } : entry)));
          }} title={t("reason.useGraph")} help={t("reason.useGraphHelp")} />
          <ToggleRow checked={applyToGraph} onChange={(value) => {
            setApplyToGraph(value);
            const sessionId = activeHistoryIdRef.current;
            if (!sessionId) return;
            setHistory((current) => writeEntries(current.map((entry) => entry.id === sessionId ? { ...entry, applyToGraph: value } : entry)));
          }} title={t("reason.write")} help={t("reason.writeHelp")} />

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
