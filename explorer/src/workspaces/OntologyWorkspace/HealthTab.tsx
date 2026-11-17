import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Download, HeartPulse, Loader2, Wrench } from "lucide-react";
import { loadOntologyHealth, loadOntologyRegistry } from "./api";
import type { OntologyEntry, OntologyHealthResponse, HealthIssue } from "./types";
import { t, useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";

const DIMENSION_KEYS: Record<string, MessageKey> = {
  completeness: "health.dim.completeness",
  consistency: "health.dim.consistency",
  shacl: "health.dim.shacl",
  alignment: "health.dim.alignment",
  documentation: "health.dim.documentation",
};

const STATUS_KEYS: Record<string, MessageKey> = {
  ok: "health.status.ok",
  warning: "health.status.warning",
  critical: "health.status.critical",
  unavailable: "health.status.unavailable",
  success: "health.status.success",
  error: "health.status.error",
};

const CATEGORY_KEYS: Record<string, MessageKey> = {
  Documentation: "health.cat.Documentation",
  Consistency: "health.cat.Consistency",
  Alignment: "health.cat.Alignment",
};

interface HealthTabProps {
  onFixInEditor?: (entityUri: string) => void;
}

export function HealthTab({ onFixInEditor }: HealthTabProps) {
  const { t } = useI18n();
  const [registry, setRegistry] = useState<OntologyEntry[]>([]);
  const [selectedUri, setSelectedUri] = useState("");
  const [health, setHealth] = useState<OntologyHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadOntologyRegistry()
      .then((entries) => {
        if (cancelled) return;
        setRegistry(entries);
        setSelectedUri((current) => current || entries[0]?.uri || "");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("health.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [prevUri, setPrevUri] = useState(selectedUri);
  if (selectedUri !== prevUri) {
    setPrevUri(selectedUri);
    if (selectedUri) {
      setLoading(true);
      setError("");
    }
  }

  useEffect(() => {
    let ignore = false;
    async function fetchHealth() {
      if (!selectedUri) return;
      try {
        const data = await loadOntologyHealth(selectedUri);
        if (!ignore) setHealth(data);
      } catch {
        if (!ignore) setHealth(null);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    void fetchHealth();
    return () => { ignore = true; };
  }, [selectedUri]);

  const exportReport = useCallback(() => {
    if (!health) return;
    const blob = new Blob([JSON.stringify(health, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${health.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-health.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }, [health]);

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={kickerStyle}><HeartPulse size={14} /> {t("health.kicker")}</div>
          <h2 style={titleStyle}>{t("health.title")}</h2>
          <p style={textStyle}>{t("health.intro")}</p>
        </div>
        <div style={selectorShellStyle}>
          <label style={labelStyle}>{t("health.ontology")}</label>
          <select style={inputStyle} value={selectedUri} onChange={(event) => setSelectedUri(event.target.value)}>
            {registry.map((entry) => <option key={entry.uri} value={entry.uri}>{entry.name}</option>)}
          </select>
        </div>
      </section>

      {error ? <div style={errorStyle}>{error}</div> : null}

      {loading ? (
        <div style={loadingStyle}><Loader2 size={18} className="ws-spin" /> {t("health.computing")}</div>
      ) : health ? (
        <>
          <section style={{ ...scoreGridStyle, gridTemplateColumns: `220px repeat(${health.dimensions.length}, minmax(180px, 1fr))` }}>
            <div style={scoreCardStyle}>
              <span style={scoreValueStyle}>{Math.round(health.total_score)}</span>
              <span style={mutedStyle}>{t("health.score")}</span>
              <button style={secondaryButtonStyle} onClick={exportReport}><Download size={14} /> {t("health.export")}</button>
            </div>
            {health.dimensions.map((dimension) => (
              <div key={dimension.key} style={dimensionCardStyle}>
                <div style={dimensionHeadStyle}>
                  <span style={{ color: "#ebf3ff", fontWeight: 900 }}>{dimensionLabel(dimension.key, dimension.label)}</span>
                  <span style={statusBadgeStyle(dimension.status)}>{statusLabel(dimension.status)}</span>
                </div>
                <div style={barTrackStyle}>
                  <div style={{ ...barFillStyle, width: `${dimension.score}%`, background: dimensionColor(dimension.score, dimension.status) }} />
                </div>
                <div style={dimensionFootStyle}>
                  <span>{Math.round(dimension.score)} / 100</span>
                  <span>{localizeHealthText(dimension.detail)}</span>
                </div>
              </div>
            ))}
          </section>

          <section style={cardStyle}>
            <h3 style={sectionTitleStyle}>{t("health.issues")}</h3>
            <div style={issueListStyle}>
              {health.issues.map((issue) => (
                <IssueRow key={issue.id} issue={issue} onFixInEditor={onFixInEditor} />
              ))}
              {!health.issues.length ? <p style={mutedStyle}>{t("health.none")}</p> : null}
            </div>
          </section>
        </>
      ) : (
        <div style={emptyStyle}>{t("health.empty")}</div>
      )}
    </div>
  );
}

function IssueRow({ issue, onFixInEditor }: { issue: HealthIssue; onFixInEditor?: (entityUri: string) => void }) {
  const { t } = useI18n();
  const categoryKey = CATEGORY_KEYS[issue.category];
  return (
    <div style={issueRowStyle}>
      <div style={severityDotStyle(issue.severity)} />
      <div>
        <div style={{ color: "#ebf3ff", fontWeight: 800 }}>{issue.entity_label || (categoryKey ? t(categoryKey) : issue.category)}</div>
        <div style={{ color: "#8fa8c6", fontSize: 13, lineHeight: 1.45 }}>{localizeHealthText(issue.message)}</div>
        {issue.entity_uri ? <div style={monoStyle}>{issue.entity_uri}</div> : null}
      </div>
      <span style={categoryStyle}>{categoryKey ? t(categoryKey) : issue.category}</span>
      {issue.entity_uri ? (
        <button style={smallButtonStyle} onClick={() => onFixInEditor?.(issue.entity_uri || "")}>
          <Wrench size={13} />
          {t("health.fix")}
        </button>
      ) : (
        <div />
      )}
    </div>
  );
}

function dimensionLabel(key: string, fallback: string) {
  const messageKey = DIMENSION_KEYS[key];
  return messageKey ? t(messageKey) : fallback;
}

function statusLabel(status: string) {
  const messageKey = STATUS_KEYS[status];
  return messageKey ? t(messageKey) : status;
}

function localizeHealthText(text: string) {
  const completeness = text.match(/^(\d+)\/(\d+) labeled, (\d+)\/\d+ documented, (\d+)\/\d+ defined\.$/);
  if (completeness) {
    return t("health.detail.completeness", {
      labeled: completeness[1],
      total: completeness[2],
      documented: completeness[3],
      defined: completeness[4],
    });
  }
  const ranges = text.match(/^(\d+) properties are missing explicit ranges\.$/);
  if (ranges) return t("health.detail.consistency", { count: ranges[1] });
  if (text === "Graph conforms to all generated SHACL constraints.") return t("health.detail.shaclOk");
  if (text === "Measures comments plus source/version metadata.") return t("health.detail.documentation");
  const aligned = text.match(/^(\d+)\/(\d+) classes or properties have an alignment\.$/);
  if (aligned) return t("health.detail.alignment", { aligned: aligned[1], total: aligned[2] });
  const missingDoc = text.match(/^(.*) is missing a comment or definition\.$/);
  if (missingDoc) return t("health.issue.missingDoc", { label: missingDoc[1] });
  if (text === "Property has no explicit rdfs:range.") return t("health.issue.missingRange");
  if (text === "No cross-ontology alignments are recorded for local classes or properties.") return t("health.issue.noAlignment");
  if (text.startsWith("Graph has ") && text.endsWith(".")) {
    const inner = text.slice("Graph has ".length, -1);
    const parts = inner.split(", ").map((part) => {
      const violations = part.match(/^(\d+) SHACL violation\(s\)$/);
      if (violations) return t("health.detail.shaclViolations", { count: violations[1] });
      const warnings = part.match(/^(\d+) SHACL warning\(s\)$/);
      if (warnings) return t("health.detail.shaclWarnings", { count: warnings[1] });
      return part;
    });
    return t("health.detail.shaclIssues", { detail: parts.join(t("health.detail.joiner")) });
  }
  const shaclFailed = text.match(/^Live SHACL validation failed: (.*)$/);
  if (shaclFailed) return t("health.detail.shaclFailed", { error: shaclFailed[1] });
  if (text.startsWith("Live SHACL validation is available in SHACL Studio")) return t("health.detail.shaclUnavailable");
  return text;
}

function dimensionColor(score: number, status: string) {
  if (status === "unavailable") return "#6a7f97";
  if (score >= 80) return "#7ce7d3";
  if (score >= 55) return "#f2b66d";
  return "#ff9daf";
}

function statusBadgeStyle(status: string): CSSProperties {
  const color = status === "ok" ? "#7ce7d3" : status === "unavailable" ? "#6a7f97" : "#f2b66d";
  return {
    color,
    background: `${color}18`,
    border: `1px solid ${color}30`,
    borderRadius: 999,
    padding: "2px 7px",
    fontSize: 10,
    fontWeight: 900,
    textTransform: "uppercase",
  };
}

function severityDotStyle(severity: string): CSSProperties {
  const color = severity === "critical" ? "#ff9daf" : severity === "warning" ? "#f2b66d" : "#58a6ff";
  return { width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 18px ${color}55`, marginTop: 5 };
}

const pageStyle: CSSProperties = { height: "100%", overflow: "auto", padding: 22, display: "flex", flexDirection: "column", gap: 16 };
const heroStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 18, padding: 22, border: "1px solid rgba(232,234,237,0.16)", borderRadius: 22, background: "linear-gradient(145deg, #2A2A2A 0%, #141414 14%, #080808 36%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)" };
const kickerStyle: CSSProperties = { display: "inline-flex", gap: 8, alignItems: "center", color: "#9ee8d7", fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" };
const titleStyle: CSSProperties = { margin: "8px 0", color: "#ebf3ff", fontSize: 26, letterSpacing: "-0.04em" };
const textStyle: CSSProperties = { margin: 0, color: "#8fa8c6", lineHeight: 1.6, maxWidth: 620 };
const selectorShellStyle: CSSProperties = { minWidth: 320 };
const labelStyle: CSSProperties = { display: "block", color: "#6a7f97", fontSize: 11, fontWeight: 800, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" };
const inputStyle: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid rgba(127,208,255,0.14)", borderRadius: 12, padding: "10px 12px", background: "rgba(12,12,12,0.8)", color: "#ebf3ff" };
const scoreGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "220px repeat(5, minmax(180px, 1fr))", gap: 12 };
const scoreCardStyle: CSSProperties = { padding: 18, borderRadius: 20, background: "linear-gradient(145deg, #2A2A2A 0%, #141414 14%, #080808 36%)", border: "1px solid rgba(232,234,237,0.16)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)", display: "flex", flexDirection: "column", gap: 10 };
const scoreValueStyle: CSSProperties = { color: "#9ee8d7", fontSize: 52, lineHeight: 1, fontWeight: 950, letterSpacing: "-0.06em" };
const dimensionCardStyle: CSSProperties = { padding: 16, borderRadius: 18, background: "#080808", border: "1px solid rgba(232,234,237,0.12)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)" };
const dimensionHeadStyle: CSSProperties = { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 12 };
const barTrackStyle: CSSProperties = { height: 8, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" };
const barFillStyle: CSSProperties = { height: "100%", borderRadius: 999 };
const dimensionFootStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, color: "#8fa8c6", fontSize: 12, marginTop: 10 };
const cardStyle: CSSProperties = { padding: 18, border: "1px solid rgba(232,234,237,0.16)", borderRadius: 20, background: "#080808", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)" };
const sectionTitleStyle: CSSProperties = { margin: "0 0 14px", color: "#ebf3ff", fontSize: 16 };
const issueListStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const issueRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "14px 1fr auto auto", gap: 12, alignItems: "start", padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(127,208,255,0.08)" };
const categoryStyle: CSSProperties = { color: "#9ee8d7", border: "1px solid rgba(158,232,215,0.22)", borderRadius: 999, padding: "4px 8px", fontSize: 10, fontWeight: 900 };
const smallButtonStyle: CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", border: "1px solid rgba(127,208,255,0.16)", borderRadius: 10, padding: "7px 9px", background: "rgba(127,208,255,0.08)", color: "#ebf3ff", cursor: "pointer", fontWeight: 800 };
const secondaryButtonStyle: CSSProperties = { display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "center", border: "1px solid rgba(127,208,255,0.16)", borderRadius: 12, padding: "10px 12px", background: "rgba(127,208,255,0.08)", color: "#ebf3ff", cursor: "pointer", fontWeight: 900 };
const monoStyle: CSSProperties = { marginTop: 4, color: "#6a7f97", fontSize: 11, fontFamily: "JetBrains Mono, monospace", wordBreak: "break-all" };
const mutedStyle: CSSProperties = { margin: 0, color: "#6a7f97", fontSize: 13 };
const loadingStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, color: "#8fa8c6", padding: 18 };
const emptyStyle: CSSProperties = { color: "#6a7f97", padding: 22 };
const errorStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: 12, borderRadius: 14, color: "#ffb4c2", background: "rgba(255,157,175,0.1)", border: "1px solid rgba(255,157,175,0.18)" };
