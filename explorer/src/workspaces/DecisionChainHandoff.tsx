import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

const FIRST_REVEAL_MS = 180;
const REVEAL_MS = 500;
const HOLD_MS = 820;
const PACK_MS = 560;
const FLY_MS = 780;

type ChainKind = "fact" | "rule" | "infer" | "verdict";

type ChainSource = {
  facts?: string[];
  rules?: string[];
  inferred_facts?: string[];
  answer?: string;
  reason?: string;
};

type ChainStep = {
  id: string;
  kind: ChainKind;
  label: string;
  text: string;
};

type Flight = {
  x: number;
  y: number;
  dx: number;
  dy: number;
};

function clip(value: string | undefined, max = 140) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function PackMark() {
  return (
    <>
      <span className="dchain-pack-glow" />
      <FilePack />
    </>
  );
}

function FilePack() {
  return (
    <svg className="dchain-pack-svg" width="74" height="74" viewBox="0 0 74 74" aria-hidden="true">
      <g className="dchain-sheet dchain-sheet-back">
        <rect x="22" y="8" width="30" height="36" rx="3" />
        <path d="M28 16h16M28 21h12" />
      </g>
      <g className="dchain-sheet dchain-sheet-mid">
        <rect x="18" y="12" width="32" height="36" rx="3" />
        <path d="M24 20h18M24 25h14" />
      </g>
      <g className="dchain-folder">
        <path d="M10 32h16l4-6h30a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V32z" />
        <path d="M20 46h26M20 52h18" />
        <circle cx="52" cy="54" r="7" />
        <path d="M49 54.2l2 2 4.2-4.4" />
      </g>
    </svg>
  );
}

const handoffStyles = `
  .dchain-host {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 32px 36px;
  }

  .dchain-stage {
    width: min(460px, 100%);
    margin: auto;
  }

  .dchain-copy {
    margin-bottom: 18px;
  }

  .dchain-kicker {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    color: var(--ws-text-dim);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .dchain-live-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--ws-green);
    box-shadow: 0 0 0 0 rgba(76, 195, 138, 0.6);
    animation: dchain-dot 1.4s ease-out infinite;
  }

  .dchain-title {
    color: var(--ws-text);
    font-size: 18px;
    font-weight: 700;
    line-height: 1.3;
  }

  .dchain-stage.is-pack .dchain-copy,
  .dchain-stage.is-fly .dchain-copy {
    animation: dchain-fade-out 280ms ease forwards;
  }

  .dchain-board {
    position: relative;
  }

  .dchain-column.is-collapsing {
    animation: dchain-collapse 520ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  .dchain-link {
    position: relative;
    height: 18px;
  }

  .dchain-pack-svg {
    position: relative;
    overflow: visible;
  }

  .dchain-link::before {
    content: "";
    position: absolute;
    left: 30px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(180deg, rgba(232, 234, 237, 0.08), rgba(232, 234, 237, 0.42));
    transform-origin: top center;
    animation: dchain-link-grow 260ms ease both;
  }

  .dchain-node {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(232, 234, 237, 0.14);
    border-left: 3px solid var(--dchain-accent);
    animation: dchain-node-in 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .dchain-node--fact { --dchain-accent: #d5d8de; }
  .dchain-node--rule { --dchain-accent: #f2b66d; }
  .dchain-node--infer { --dchain-accent: #7dd3fc; }
  .dchain-node--verdict { --dchain-accent: #4cc38a; }

  .dchain-node.is-latest {
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
  }

  .dchain-node.is-live {
    animation: dchain-node-in 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both, dchain-live 1.15s ease-in-out infinite;
  }

  .dchain-index {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 11px;
    font-weight: 700;
    color: var(--dchain-accent);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(232, 234, 237, 0.16);
  }

  .dchain-node-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .dchain-node-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dchain-accent);
  }

  .dchain-node-text {
    color: var(--ws-text);
    font-size: 13px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    animation: dchain-write 420ms ease both;
  }

  .dchain-caret {
    display: inline-block;
    width: 7px;
    height: 1.5px;
    margin-left: 5px;
    vertical-align: middle;
    background: var(--dchain-accent, #4cc38a);
    animation: dchain-caret 0.9s steps(1) infinite;
  }

  .dchain-pack {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 50%;
    width: 92px;
    height: 92px;
    margin: -46px 0 0 -46px;
    display: grid;
    place-items: center;
    opacity: 0;
    pointer-events: none;
  }

  .dchain-pack.is-forming {
    animation: dchain-pack-in 520ms cubic-bezier(0.16, 0.84, 0.28, 1.08) both;
  }

  .dchain-pack.is-gone {
    opacity: 0;
    animation: none;
  }

  .dchain-pack-glow {
    position: absolute;
    inset: 0;
    border-radius: 24px;
    background: radial-gradient(circle, rgba(76, 195, 138, 0.22), rgba(76, 195, 138, 0) 68%);
  }

  .dchain-sheet rect {
    fill: #1a1a1a;
    stroke: rgba(232, 234, 237, 0.55);
    stroke-width: 1.2;
  }

  .dchain-sheet path,
  .dchain-folder > path:nth-child(2) {
    fill: none;
    stroke: rgba(232, 234, 237, 0.34);
    stroke-width: 1.3;
    stroke-linecap: round;
  }

  .dchain-sheet-back {
    transform: translate(7px, -2px) rotate(8deg);
    transform-origin: 36px 26px;
  }

  .dchain-sheet-mid {
    transform: translate(1px, 0) rotate(-3deg);
    transform-origin: 34px 30px;
  }

  .dchain-pack.is-forming .dchain-sheet-back {
    animation: dchain-sheet-back 500ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .dchain-pack.is-forming .dchain-sheet-mid {
    animation: dchain-sheet-mid 500ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .dchain-folder > path:first-child {
    fill: #141414;
    stroke: rgba(232, 234, 237, 0.84);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .dchain-folder circle {
    fill: #101010;
    stroke: #4cc38a;
    stroke-width: 1.5;
  }

  .dchain-folder > path:last-child {
    fill: none;
    stroke: #4cc38a;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .dchain-flight {
    position: fixed;
    z-index: 80;
    width: 92px;
    height: 92px;
    margin-left: -46px;
    margin-top: -46px;
    left: var(--dchain-x);
    top: var(--dchain-y);
    display: grid;
    place-items: center;
    pointer-events: none;
    filter: drop-shadow(0 14px 16px rgba(0, 0, 0, 0.45));
    animation: dchain-fly 780ms cubic-bezier(0.45, 0.02, 0.2, 1) forwards;
  }

  @keyframes dchain-dot {
    70% { box-shadow: 0 0 0 7px rgba(76, 195, 138, 0); }
    100% { box-shadow: 0 0 0 0 rgba(76, 195, 138, 0); }
  }

  @keyframes dchain-node-in {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: none; }
  }

  @keyframes dchain-write {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }

  @keyframes dchain-link-grow {
    from { transform: scaleY(0); }
    to { transform: scaleY(1); }
  }

  @keyframes dchain-live {
    50% { box-shadow: 0 0 0 1px rgba(76, 195, 138, 0.35), 0 0 22px rgba(76, 195, 138, 0.16); }
  }

  @keyframes dchain-caret {
    50% { opacity: 0; }
  }

  @keyframes dchain-fade-out {
    to { opacity: 0; transform: translateY(-6px); }
  }

  @keyframes dchain-collapse {
    0% { opacity: 1; transform: none; filter: none; }
    42% { opacity: 0; transform: scale(0.94); filter: blur(1px); }
    100% { opacity: 0; transform: scale(0.9); filter: blur(2px); }
  }

  @keyframes dchain-pack-in {
    0%, 30% { opacity: 0; transform: scale(0.86) rotate(-6deg); }
    100% { opacity: 1; transform: scale(1) rotate(0deg); }
  }

  @keyframes dchain-sheet-back {
    from { transform: translate(-8px, -12px) rotate(-12deg); opacity: 0; }
    to { transform: translate(7px, -2px) rotate(8deg); opacity: 1; }
  }

  @keyframes dchain-sheet-mid {
    from { transform: translate(10px, -8px) rotate(10deg); opacity: 0; }
    to { transform: translate(1px, 0) rotate(-3deg); opacity: 1; }
  }

  @keyframes dchain-fly {
    0% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
    38% { transform: translate(calc(var(--dchain-dx) * 0.42), calc(var(--dchain-dy) * 0.12 - 46px)) scale(0.86) rotate(-12deg); opacity: 1; }
    82% { transform: translate(calc(var(--dchain-dx) * 0.9), calc(var(--dchain-dy) * 0.9 - 8px)) scale(0.4) rotate(4deg); opacity: 1; }
    100% { transform: translate(var(--dchain-dx), var(--dchain-dy)) scale(0.22) rotate(8deg); opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .dchain-node,
    .dchain-node-text,
    .dchain-link::before,
    .dchain-pack,
    .dchain-flight,
    .dchain-live-dot,
    .dchain-caret {
      animation-duration: 1ms !important;
    }
  }
`;

export function DecisionChainHandoff({
  runId,
  source,
  onLanded,
}: {
  runId: number;
  source: ChainSource | null;
  onLanded: (runId: number, flew: boolean) => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(0);
  const [mode, setMode] = useState<"weave" | "pack" | "fly">("weave");
  const [flight, setFlight] = useState<Flight | null>(null);
  const packRef = useRef<HTMLDivElement>(null);
  const onLandedRef = useRef(onLanded);

  useEffect(() => {
    onLandedRef.current = onLanded;
  }, [onLanded]);

  const steps = useMemo<ChainStep[]>(() => [
    {
      id: "fact",
      kind: "fact",
      label: t("reason.chain.fact"),
      text: clip(source?.facts?.[0]) || t("reason.chain.collect"),
    },
    {
      id: "rule",
      kind: "rule",
      label: t("reason.chain.rule"),
      text: clip(source?.rules?.[0]) || t("reason.chain.match"),
    },
    {
      id: "infer",
      kind: "infer",
      label: t("reason.chain.infer"),
      text: clip(source?.inferred_facts?.[0]) || t("reason.chain.fire"),
    },
    {
      id: "verdict",
      kind: "verdict",
      label: t("reason.chain.verdict"),
      text: clip(source?.answer) || clip(source?.reason) || t("reason.chain.form"),
    },
  ], [source, t]);

  useEffect(() => {
    if (mode !== "weave" || visible >= steps.length) return;
    const timer = window.setTimeout(() => setVisible((count) => count + 1), visible === 0 ? FIRST_REVEAL_MS : REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [mode, visible, steps.length]);

  useEffect(() => {
    if (mode !== "weave" || !source || visible < steps.length) return;
    const timer = window.setTimeout(() => setMode("pack"), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [mode, source, visible, steps.length]);

  useEffect(() => {
    if (mode !== "pack") return;
    const timer = window.setTimeout(() => {
      const pack = packRef.current?.getBoundingClientRect();
      const target = document.querySelector<HTMLElement>("[data-nav='decisions']")?.getBoundingClientRect();
      if (!pack || !target || pack.width === 0 || target.width === 0) {
        onLandedRef.current(runId, false);
        return;
      }
      setFlight({
        x: pack.left + pack.width / 2,
        y: pack.top + pack.height / 2,
        dx: target.left + target.width / 2 - (pack.left + pack.width / 2),
        dy: target.top + target.height / 2 - (pack.top + pack.height / 2),
      });
      setMode("fly");
    }, PACK_MS);
    return () => window.clearTimeout(timer);
  }, [mode, runId]);

  useEffect(() => {
    if (mode !== "fly" || !flight) return;
    const timer = window.setTimeout(() => onLandedRef.current(runId, true), FLY_MS);
    return () => window.clearTimeout(timer);
  }, [mode, flight, runId]);

  const waiting = !source && visible >= steps.length;
  const shown = steps.slice(0, visible);

  const flyer = flight ? createPortal(
    <div
      className="dchain-flight"
      style={{
        ["--dchain-x" as string]: `${flight.x}px`,
        ["--dchain-y" as string]: `${flight.y}px`,
        ["--dchain-dx" as string]: `${flight.dx}px`,
        ["--dchain-dy" as string]: `${flight.dy}px`,
      }}
    >
      <PackMark />
    </div>,
    document.body,
  ) : null;

  return (
    <div className="dchain-host">
      <style>{handoffStyles}</style>
      <div className={`dchain-stage is-${mode}`} role="status" aria-live="polite">
        <div className="dchain-copy">
          <div className="dchain-kicker">
            <span className="dchain-live-dot" />
            {t("reason.chain.kicker")}
          </div>
          <div className="dchain-title">{mode === "weave" ? t("reason.chain.title") : t("reason.chain.pack")}</div>
        </div>
        <div className="dchain-board">
          <div className={`dchain-column${mode === "weave" ? "" : " is-collapsing"}`}>
            {shown.map((step, index) => {
              const latest = mode === "weave" && index === shown.length - 1;
              const live = waiting && latest;
              return (
                <div key={step.id}>
                  {index > 0 ? <div className="dchain-link" aria-hidden="true" /> : null}
                  <article className={`dchain-node dchain-node--${step.kind}${latest ? " is-latest" : ""}${live ? " is-live" : ""}`}>
                    <div className="dchain-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="dchain-node-main">
                      <div className="dchain-node-label">{step.label}</div>
                      <div key={step.text} className="dchain-node-text">
                        {step.text}
                        {live ? <span className="dchain-caret" /> : null}
                      </div>
                    </div>
                  </article>
                </div>
              );
            })}
          </div>
          <div ref={packRef} className={`dchain-pack${mode === "pack" ? " is-forming" : ""}${mode === "fly" ? " is-gone" : ""}`}>
            <PackMark />
          </div>
        </div>
      </div>
      {flyer}
    </div>
  );
}
