import { useState } from "react";
import {
  Cable,
  Database,
  FileCode,
  Files,
  GitBranch,
  Globe,
  Mail,
  Radio,
  Table,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";

type IngestSource = {
  id: string;
  label?: string;
  labelKey?: MessageKey;
  nodeKey: MessageKey;
  noteKey: MessageKey;
  modules: string[];
  icon: LucideIcon;
};

const sources: IngestSource[] = [
  {
    id: "files",
    label: "PDF, DOCX, PPTX, HTML, JSON, CSV",
    nodeKey: "data.node.files",
    noteKey: "data.source.filesNote",
    modules: ["ingest.FileIngestor"],
    icon: Files,
  },
  {
    id: "parquet",
    label: "Parquet",
    nodeKey: "data.node.parquet",
    noteKey: "data.source.parquetNote",
    modules: ["ingest.ParquetIngestor"],
    icon: Table,
  },
  {
    id: "xml",
    label: "XML",
    nodeKey: "data.node.xml",
    noteKey: "data.source.xmlNote",
    modules: ["ingest.XMLIngestor"],
    icon: FileCode,
  },
  {
    id: "web",
    labelKey: "data.source.web",
    nodeKey: "data.node.web",
    noteKey: "data.source.webNote",
    modules: ["ingest.WebIngestor"],
    icon: Globe,
  },
  {
    id: "sql",
    label: "SQL / Snowflake / Databricks",
    nodeKey: "data.node.sql",
    noteKey: "data.source.sqlNote",
    modules: ["ingest.DBIngestor", "ingest.SnowflakeIngestor", "ingest.DatabricksIngestor"],
    icon: Database,
  },
  {
    id: "stream",
    labelKey: "data.source.stream",
    nodeKey: "data.node.stream",
    noteKey: "data.source.streamNote",
    modules: ["ingest.StreamIngestor"],
    icon: Radio,
  },
  {
    id: "email",
    labelKey: "data.source.email",
    nodeKey: "data.node.email",
    noteKey: "data.source.emailNote",
    modules: ["ingest.EmailIngestor"],
    icon: Mail,
  },
  {
    id: "repo",
    labelKey: "data.source.repo",
    nodeKey: "data.node.repo",
    noteKey: "data.source.repoNote",
    modules: ["ingest.RepoIngestor"],
    icon: GitBranch,
  },
  {
    id: "mcp",
    label: "MCP",
    nodeKey: "data.node.mcp",
    noteKey: "data.source.mcpNote",
    modules: ["ingest.MCPIngestor"],
    icon: Cable,
  },
];

const ROW = 56;
const TOP = 14;
const NODE_X = 18;
const NODE_W = 148;
const NODE_H = 36;
const SINK_W = 168;
const SINK_H = 72;
const CANVAS_W = 680;
const CANVAS_H = TOP + sources.length * ROW + 8;

function sourceLabel(source: IngestSource, translate: (key: MessageKey) => string) {
  return source.label ?? (source.labelKey ? translate(source.labelKey) : source.id);
}

function flowPath(index: number, sinkY: number) {
  const y = TOP + index * ROW + NODE_H / 2;
  const x1 = NODE_X + NODE_W;
  const x2 = CANVAS_W - SINK_W - 28;
  const mid = x1 + (x2 - x1) * 0.55;
  return `M ${x1} ${y} C ${mid} ${y}, ${mid} ${sinkY}, ${x2} ${sinkY}`;
}

const styles = `
  .data-ingest {
    display: grid;
    grid-template-columns: minmax(280px, 372px) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    background:
      radial-gradient(900px 420px at 78% 42%, rgba(76, 195, 138, 0.07), transparent 60%),
      var(--ws-bg);
  }

  .data-source-pane {
    min-height: 0;
    overflow: auto;
    border-right: 1px solid var(--ws-border);
    padding: 16px 14px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    scrollbar-width: thin;
  }

  .data-pane-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 0 4px 6px;
    flex-wrap: wrap;
  }

  .data-pane-kicker {
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ws-text-dim);
  }

  html[lang="zh-CN"] .data-pane-kicker {
    letter-spacing: 0.08em;
  }

  .data-pane-meta {
    font-size: 11px;
    color: var(--ws-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .data-source {
    text-align: left;
    border: 1px solid var(--ws-border);
    background: rgba(255, 255, 255, 0.025);
    color: var(--ws-text);
    border-radius: 12px;
    padding: 10px 12px 11px;
    cursor: pointer;
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    column-gap: 10px;
    row-gap: 3px;
    transition: border-color 160ms ease, background 160ms ease;
  }

  .data-source:hover {
    border-color: var(--ws-border-strong);
    background: var(--ws-surface-hover);
  }

  .data-source[data-active="true"] {
    border-color: rgba(76, 195, 138, 0.72);
    background: var(--ws-green-soft);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .data-source-index {
    grid-row: 1 / span 3;
    align-self: start;
    margin-top: 2px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--ws-text-dim);
  }

  .data-source[data-active="true"] .data-source-index {
    color: var(--ws-green);
  }

  .data-source-name {
    font-size: 13px;
    font-weight: 650;
    line-height: 1.35;
  }

  .data-source-module,
  .data-source-note {
    font-size: 11px;
    line-height: 1.45;
    color: var(--ws-text-muted);
  }

  .data-source-module {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-word;
  }

  .data-canvas {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 16px 18px 18px;
    gap: 14px;
  }

  .data-flow {
    flex: 1;
    min-height: 320px;
    border: 1px solid var(--ws-border);
    border-radius: var(--ws-radius);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 28%),
      #080808;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .data-flow svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .data-flow-path {
    fill: none;
    stroke: rgba(232, 234, 237, 0.2);
    stroke-width: 1.25;
  }

  .data-flow-path[data-active="true"] {
    stroke: rgba(76, 195, 138, 0.95);
    stroke-width: 1.8;
  }

  .data-flow-dash {
    fill: none;
    stroke: #8ee0b4;
    stroke-width: 1.8;
    stroke-dasharray: 4 8;
    animation: data-flow-move 1.15s linear infinite;
  }

  @keyframes data-flow-move {
    to { stroke-dashoffset: -24; }
  }

  .data-flow-node,
  .data-flow-sink {
    cursor: pointer;
  }

  .data-flow-node rect,
  .data-flow-sink rect {
    fill: #101010;
    stroke: rgba(232, 234, 237, 0.22);
  }

  .data-flow-node[data-active="true"] rect {
    fill: rgba(76, 195, 138, 0.12);
    stroke: rgba(76, 195, 138, 0.85);
  }

  .data-flow-sink rect {
    fill: #121816;
    stroke: rgba(76, 195, 138, 0.55);
  }

  .data-detail {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px 16px;
    align-items: start;
    padding: 14px 16px;
    border: 1px solid var(--ws-border);
    border-radius: var(--ws-radius);
    background: rgba(255, 255, 255, 0.03);
  }

  .data-detail-icon {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    border: 1px solid rgba(76, 195, 138, 0.4);
    color: var(--ws-green);
    background: var(--ws-green-soft);
  }

  .data-detail h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }

  .data-detail p {
    margin: 6px 0 0;
    color: var(--ws-text-muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .data-detail-module {
    margin-top: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--ws-text);
    word-break: break-word;
  }

  @media (max-width: 980px) {
    .data-ingest {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(220px, 38%) minmax(0, 1fr);
    }

    .data-source-pane {
      border-right: none;
      border-bottom: 1px solid var(--ws-border);
    }
  }
`;

export function DataWorkspace() {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(sources[0].id);
  const selected = sources.find((source) => source.id === selectedId) ?? sources[0];
  const sinkY = TOP + ((sources.length - 1) * ROW) / 2 + NODE_H / 2;
  const sinkX = CANVAS_W - SINK_W - 28;
  const SelectedIcon = selected.icon;
  const selectedLabel = sourceLabel(selected, t);

  return (
    <div className="data-ingest">
      <style>{styles}</style>
      <aside className="data-source-pane" aria-label={t("data.sources")}>
        <div className="data-pane-head">
          <span className="data-pane-kicker">
            {t("data.sources")} · {t("data.module")} · {t("data.notes")}
          </span>
          <span className="data-pane-meta">{sources.length}</span>
        </div>
        {sources.map((source, index) => {
          const active = source.id === selected.id;
          return (
            <button
              key={source.id}
              type="button"
              className="data-source"
              data-active={active}
              aria-pressed={active}
              onClick={() => setSelectedId(source.id)}
            >
              <span className="data-source-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="data-source-name">{sourceLabel(source, t)}</span>
              <span className="data-source-module">{source.modules.join(" / ")}</span>
              <span className="data-source-note">{t(source.noteKey)}</span>
            </button>
          );
        })}
      </aside>

      <section className="data-canvas">
        <div className="data-flow" aria-label={t("data.flowLabel")}>
          <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {sources.map((source, index) => {
              const path = flowPath(index, sinkY);
              const active = source.id === selected.id;
              return (
                <path
                  key={source.id}
                  className="data-flow-path"
                  data-active={active}
                  d={path}
                />
              );
            })}
            <path className="data-flow-dash" d={flowPath(sources.findIndex((source) => source.id === selected.id), sinkY)} />
            {sources.map((source, index) => {
              const y = TOP + index * ROW;
              const active = source.id === selected.id;
              return (
                <g
                  key={source.id}
                  className="data-flow-node"
                  data-active={active}
                  onClick={() => setSelectedId(source.id)}
                >
                  <rect x={NODE_X} y={y} width={NODE_W} height={NODE_H} rx="10" />
                  <text
                    x={NODE_X + 14}
                    y={y + 23}
                    fill={active ? "#8ee0b4" : "var(--ws-text)"}
                    fontSize="13"
                    fontFamily="ui-sans-serif, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
                  >
                    {t(source.nodeKey)}
                  </text>
                </g>
              );
            })}
            <g className="data-flow-sink">
              <rect x={sinkX} y={sinkY - SINK_H / 2} width={SINK_W} height={SINK_H} rx="14" />
              <text
                x={sinkX + SINK_W / 2}
                y={sinkY + 4}
                textAnchor="middle"
                fill="#8ee0b4"
                fontSize="12"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
              >
                SourceDocument
              </text>
            </g>
          </svg>
        </div>

        <article className="data-detail">
          <div className="data-detail-icon" aria-hidden>
            <SelectedIcon size={16} />
          </div>
          <div>
            <h2>{selectedLabel}</h2>
            <div className="data-detail-module">{selected.modules.join(" / ")}</div>
            <p>{t(selected.noteKey)}</p>
            <p>{t("data.sinkCaption")}</p>
          </div>
        </article>
      </section>
    </div>
  );
}
