import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowRight,
  BrainCircuit,
  Cpu,
  Database,
  FileSearch,
  GitBranchPlus,
  GitMerge,
  Network,
  Scale,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { ErrorBoundary } from './ErrorBoundary';
import { ExploreWorkspaceTabs, type ExploreView } from './ExploreWorkspaceTabs';
import { fetchAgentMemoryAvailability } from './explorerCapabilities';
import { hasOntologyUrlState } from './workspaces/OntologyWorkspace/ontologyUrlState';
import { useI18n } from './i18n';
import type { MessageKey } from './i18n/messages';
import { LandingSky, LandingStarMap } from './LandingStarMap';

const DecisionWorkspace = lazy(() => import('./workspaces/DecisionWorkspace/DecisionWorkspace').then((module) => ({ default: module.DecisionWorkspace })));
const DocumentsWorkspace = lazy(() => import('./workspaces/DocumentsWorkspace/DocumentsWorkspace').then((module) => ({ default: module.DocumentsWorkspace })));
const DiffMergeWorkspace = lazy(() => import('./workspaces/DiffMergeWorkspace/DiffMergeWorkspace').then((module) => ({ default: module.DiffMergeWorkspace })));
const GraphWorkspace = lazy(() => import('./workspaces/GraphWorkspace/GraphWorkspace').then((module) => ({ default: module.GraphWorkspace })));
const MemoryWorkspace = lazy(() => import('./workspaces/MemoryWorkspace').then((module) => ({ default: module.MemoryWorkspace })));
const ImportExportWorkspace = lazy(() => import('./workspaces/ImportExportWorkspace/ImportExportWorkspace').then((module) => ({ default: module.ImportExportWorkspace })));
const LineageDiagram = lazy(() => import('./workspaces/LineageWorkspace/LineageDiagram').then((module) => ({ default: module.LineageDiagram })));
const ReasoningWorkspace = lazy(() => import('./workspaces/ReasoningWorkspace').then((module) => ({ default: module.ReasoningWorkspace })));
const SparqlWorkspace = lazy(() => import('./workspaces/SparqlWorkspace/SparqlWorkspace').then((module) => ({ default: module.SparqlWorkspace })));
const VocabularyWorkspace = lazy(() => import('./workspaces/VocabularyWorkspace/VocabularyWorkspace').then((module) => ({ default: module.VocabularyWorkspace })));
const RegistryTab = lazy(() => import('./workspaces/EnrichWorkspace/RegistryTab').then((module) => ({ default: module.RegistryTab })));
const EntityResolutionTab = lazy(() => import('./workspaces/EnrichWorkspace/EntityResolutionTab').then((module) => ({ default: module.EntityResolutionTab })));
const KGOverviewTab = lazy(() => import('./workspaces/ManageWorkspace/KGOverviewTab').then((module) => ({ default: module.KGOverviewTab })));
const OntologySummaryTab = lazy(() => import('./workspaces/ManageWorkspace/OntologySummaryTab').then((module) => ({ default: module.OntologySummaryTab })));
const OntologyWorkspace = lazy(() => import('./workspaces/OntologyWorkspace').then((module) => ({ default: module.OntologyWorkspace })));
const ModelSettingsWorkspace = lazy(() => import('./workspaces/ModelSettingsWorkspace/ModelSettingsWorkspace').then((module) => ({ default: module.ModelSettingsWorkspace })));

type WorkspaceId = 'welcome' | 'explore' | 'analyze' | 'decisions' | 'enrich' | 'manage' | 'ontology-hub' | 'models';
type AnalyzeView = 'sparql' | 'reasoning';
type EnrichView = 'documents' | 'import' | 'merge' | 'registry' | 'resolve';
type ManageView = 'lineage' | 'kg-overview' | 'ontology';

const enrichTabs: { id: EnrichView; labelKey: MessageKey }[] = [
  { id: 'documents', labelKey: 'enrich.tabDocuments' },
  { id: 'import', labelKey: 'enrich.tabImport' },
  { id: 'merge', labelKey: 'enrich.tabMerge' },
  { id: 'resolve', labelKey: 'enrich.tabResolve' },
  { id: 'registry', labelKey: 'enrich.tabRegistry' },
];

type NavItem = {
  id: WorkspaceId;
  labelKey: MessageKey;
  hintKey: MessageKey;
  icon: LucideIcon;
};

type LandingMetric = {
  label: string;
  value: string;
  tone?: 'cyan' | 'mint' | 'amber' | 'rose';
};

type GraphStatsPayload = {
  node_count?: number;
  edge_count?: number;
  nodeCount?: number;
  edgeCount?: number;
  nodes?: number;
  edges?: number;
};

type ConnectionStatus = 'checking' | 'online' | 'offline';

const queryClient = new QueryClient();

const navItems: NavItem[] = [
  { id: 'explore', labelKey: 'nav.explore', hintKey: 'nav.exploreHint', icon: Database },
  { id: 'analyze', labelKey: 'nav.analyze', hintKey: 'nav.analyzeHint', icon: FileSearch },
  { id: 'decisions', labelKey: 'nav.decisions', hintKey: 'nav.decisionsHint', icon: Scale },
  { id: 'enrich', labelKey: 'nav.enrich', hintKey: 'nav.enrichHint', icon: GitBranchPlus },
  { id: 'manage', labelKey: 'nav.manage', hintKey: 'nav.manageHint', icon: Settings2 },
  { id: 'ontology-hub', labelKey: 'nav.ontology', hintKey: 'nav.ontologyHint', icon: GitMerge },
  { id: 'models', labelKey: 'nav.models', hintKey: 'nav.modelsHint', icon: Cpu },
];

function readInitialWorkspace(): WorkspaceId {
  return hasOntologyUrlState() ? 'ontology-hub' : 'welcome';
}

const shellStyles = `
  @font-face {
    font-family: "Huangkai Hualu";
    src: url("/fonts/huangkaihualushishouxieti.ttf") format("truetype");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  :root {
    --app-bg: #080808;
    --panel-bg: #080808;
    --panel-border: rgba(232, 234, 237, 0.16);
    --text-main: #F4F5F7;
    --text-muted: #A8ADB6;
    --accent: #D5D8DE;
    --accent-strong: #F4F6F8;
    --warm: #f2b66d;
    --success: #4cc38a;

    /* ── Shared workspace design tokens ── */
    --ws-bg: #080808;
    --ws-facet: linear-gradient(145deg, #2A2A2A 0%, #141414 14%, #080808 36%);
    --ws-nested-bg: var(--ws-facet);
    --ws-surface: rgba(255,255,255,0.035);
    --ws-surface-hover: rgba(255,255,255,0.06);
    --ws-border: rgba(232, 234, 237, 0.12);
    --ws-border-strong: rgba(232, 234, 237, 0.28);
    --ws-text: #E8EAED;
    --ws-text-muted: #8E949E;
    --ws-text-dim: #5E656E;
    --ws-accent: #D5D8DE;
    --ws-accent-soft: rgba(232, 234, 237, 0.1);
    --ws-green: #4cc38a;
    --ws-green-soft: rgba(76,195,138,0.12);
    --ws-amber: #f2b66d;
    --ws-amber-soft: rgba(242,182,109,0.12);
    --ws-red: #ff7b72;
    --ws-red-soft: rgba(255,123,114,0.12);
    --ws-purple: #c084fc;
    --ws-purple-soft: rgba(192,132,252,0.1);
    --ws-radius: 14px;
    --ws-radius-sm: 8px;
    --ws-radius-lg: 20px;
  }

  /* ── Shared workspace primitives (available to all workspace components) ── */
  .ws-page {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--ws-nested-bg);
    overflow: hidden;
  }

  .ws-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--ws-border) transparent;
  }

  .ws-padded {
    padding: 24px 28px;
  }

  .ws-split {
    display: grid;
    height: 100%;
    overflow: hidden;
  }

  .ws-split--2col { grid-template-columns: 300px 1fr; }
  .ws-split--half { grid-template-columns: 1fr 1fr; }
  .ws-split--rows { grid-template-rows: 1fr auto; }

  .ws-panel {
    background: var(--ws-facet);
    border: 1px solid var(--ws-border);
    border-radius: var(--ws-radius);
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.16);
  }

  .ws-panel--inset {
    background: #080808;
    border: 1px solid rgba(232,234,237,0.1);
    border-radius: var(--ws-radius);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.16);
  }

  .ws-card {
    background: var(--ws-facet);
    border: 1px solid var(--ws-border);
    border-radius: var(--ws-radius);
    padding: 20px;
    position: relative;
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.16);
    transition: border-color 180ms ease, background 180ms ease;
  }

  .ws-card::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.16), transparent);
  }

  .ws-card:hover {
    border-color: var(--ws-border-strong);
    background: var(--ws-surface-hover);
  }

  .ws-eyebrow {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ws-text-muted);
  }

  .ws-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ws-text-muted);
    margin-bottom: 8px;
    display: block;
  }

  .ws-title {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.035em;
    color: var(--ws-text);
    margin: 0;
  }

  .ws-body {
    font-size: 13px;
    line-height: 1.65;
    color: var(--ws-text-muted);
  }

  .ws-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 16px;
    border-radius: var(--ws-radius-sm);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: 160ms ease;
    border: 1px solid transparent;
  }

  .ws-btn--primary {
    background: linear-gradient(135deg, rgba(74,163,255,0.28), rgba(56,210,160,0.16));
    border-color: rgba(74,163,255,0.4);
    color: #e8f6ff;
    box-shadow: 0 0 0 1px rgba(74,163,255,0.08) inset;
  }

  .ws-btn--primary:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(74,163,255,0.4), rgba(56,210,160,0.24));
    border-color: rgba(74,163,255,0.6);
    box-shadow: 0 6px 20px rgba(74,163,255,0.18);
    transform: translateY(-1px);
  }

  .ws-btn--ghost {
    background: rgba(255,255,255,0.04);
    border-color: var(--ws-border);
    color: var(--ws-text-muted);
  }

  .ws-btn--ghost:hover:not(:disabled) {
    background: var(--ws-surface-hover);
    border-color: var(--ws-border-strong);
    color: var(--ws-text);
  }

  .ws-btn--danger {
    background: var(--ws-red-soft);
    border-color: rgba(255,123,114,0.3);
    color: #ff9e97;
  }

  .ws-btn--success {
    background: var(--ws-green-soft);
    border-color: rgba(76,195,138,0.3);
    color: #6ee7b7;
  }

  .ws-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    transform: none !important;
  }

  .ws-input {
    width: 100%;
    padding: 9px 12px;
    background: rgba(0,0,0,0.28);
    border: 1px solid var(--ws-border);
    border-radius: var(--ws-radius-sm);
    color: var(--ws-text);
    font-size: 13px;
    outline: none;
    transition: border-color 160ms ease;
    box-sizing: border-box;
  }

  .ws-input:focus {
    border-color: var(--ws-accent);
    box-shadow: 0 0 0 3px rgba(74,163,255,0.1);
  }

  .ws-textarea {
    width: 100%;
    padding: 12px;
    background: rgba(0,0,0,0.28);
    border: 1px solid var(--ws-border);
    border-radius: var(--ws-radius-sm);
    color: var(--ws-text);
    font-family: "JetBrains Mono", "Fira Code", "Consolas", monospace;
    font-size: 12.5px;
    line-height: 1.7;
    resize: vertical;
    outline: none;
    transition: border-color 160ms ease;
    box-sizing: border-box;
  }

  .ws-textarea:focus {
    border-color: var(--ws-accent);
    box-shadow: 0 0 0 3px rgba(74,163,255,0.1);
  }

  .ws-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .ws-pill--accent { color: #F4F6F8; background: var(--ws-accent-soft); border: 1px solid rgba(232,234,237,0.28); }
  .ws-pill--green  { color: #6ee7b7; background: var(--ws-green-soft);  border: 1px solid rgba(76,195,138,0.28); }
  .ws-pill--amber  { color: #fbbf24; background: var(--ws-amber-soft);  border: 1px solid rgba(242,182,109,0.28); }
  .ws-pill--red    { color: #fca5a5; background: var(--ws-red-soft);    border: 1px solid rgba(255,123,114,0.28); }
  .ws-pill--purple { color: #d8b4fe; background: var(--ws-purple-soft); border: 1px solid rgba(192,132,252,0.22); }
  .ws-pill--mono   { color: var(--ws-text-muted); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }

  .ws-parsed-table { overflow-x: auto; }
  .ws-parsed-table table { border-collapse: collapse; min-width: 100%; color: var(--ws-text); font-size: 13px; }
  .ws-parsed-table caption { text-align: left; padding-bottom: 6px; color: var(--ws-text-muted); font-weight: 700; }
  .ws-parsed-table th,
  .ws-parsed-table td { padding: 6px 10px; border: 1px solid rgba(255,255,255,0.08); text-align: left; vertical-align: top; white-space: pre-wrap; }
  .ws-parsed-table th { color: var(--ws-text-muted); font-weight: 700; background: rgba(255,255,255,0.03); }

  .ws-divider {
    height: 1px;
    background: var(--ws-border);
    margin: 0;
  }

  .ws-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 24px;
    gap: 10px;
    color: var(--ws-text-muted);
  }

  .ws-empty-icon { opacity: 0.35; margin-bottom: 4px; }
  .ws-empty-title { font-size: 14px; font-weight: 700; color: var(--ws-text); }
  .ws-empty-body { font-size: 12px; line-height: 1.5; max-width: 36ch; }

  .ws-sidebar {
    border-right: 1px solid var(--ws-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: rgba(0,0,0,0.12);
  }

  .ws-sidebar-header {
    padding: 18px 16px 14px;
    border-bottom: 1px solid var(--ws-border);
    flex-shrink: 0;
  }

  .ws-sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--ws-border) transparent;
  }

  .ws-list-item {
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ws-text-muted);
    cursor: pointer;
    transition: 140ms ease;
    display: block;
  }

  .ws-list-item:hover {
    background: var(--ws-surface);
    border-color: var(--ws-border);
    color: var(--ws-text);
  }

  .ws-list-item--active {
    background: var(--ws-accent-soft);
    border-color: var(--ws-border-strong);
    color: #e8f6ff;
  }

  .ws-stat-grid {
    display: grid;
    gap: 12px;
  }

  .ws-stat-grid--3 { grid-template-columns: repeat(3, 1fr); }
  .ws-stat-grid--4 { grid-template-columns: repeat(4, 1fr); }
  .ws-stat-grid--2 { grid-template-columns: repeat(2, 1fr); }

  .ws-stat-card {
    padding: 18px 20px;
    border-radius: var(--ws-radius);
    border: 1px solid var(--ws-border);
    background: var(--ws-surface);
    position: relative;
    overflow: hidden;
  }

  .ws-stat-card::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(74,163,255,0.2), transparent);
  }

  .ws-stat-value {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: var(--ws-text);
    line-height: 1;
  }

  .ws-stat-label {
    margin-top: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--ws-text-dim);
    letter-spacing: 0.04em;
  }

  @keyframes ws-spin { to { transform: rotate(360deg); } }
  .ws-spin { animation: ws-spin 0.8s linear infinite; }

  @keyframes ws-skeleton {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  .ws-skeleton {
    background: rgba(255,255,255,0.06);
    border-radius: 8px;
    animation: ws-skeleton 1.4s ease-in-out infinite;
  }

  @keyframes ws-slide-up {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .ws-animate-in { animation: ws-slide-up 0.22s ease both; }

  .app-shell {
    display: flex;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    color: var(--text-main);
    background: var(--app-bg);
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  }

  .app-rail {
    width: 88px;
    min-height: 0;
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-right: 1px solid var(--panel-border);
    background: #080808;
    backdrop-filter: blur(18px);
    overflow-y: auto;
  }

  .brand-pill {
    width: 100%;
    min-height: 56px;
    border-radius: 18px;
    display: grid;
    place-items: center;
    color: var(--text-main);
    background: var(--ws-facet);
    border: 1px solid rgba(232, 234, 237, 0.2);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.16);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
  }

  html[lang="zh-CN"] .brand-pill {
    letter-spacing: 0.08em;
    font-size: 13px;
  }

  .nav-button {
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-muted);
    border-radius: 18px;
    min-height: 72px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    transition: 160ms ease;
  }

  .nav-button:hover {
    color: var(--text-main);
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(232, 234, 237, 0.14);
  }

  .nav-button[data-active='true'] {
    color: var(--text-main);
    background: var(--ws-facet);
    border-color: rgba(232, 234, 237, 0.28);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.16);
  }

  .nav-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-align: center;
  }

  html[lang="zh-CN"] .nav-label {
    letter-spacing: 0;
    font-size: 12px;
  }

  .locale-button {
    margin-top: auto;
    min-height: 52px;
  }

  .workspace-shell {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .workspace-header {
    padding: 14px 22px;
    border-bottom: 1px solid var(--panel-border);
    background: #080808;
    backdrop-filter: blur(18px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    min-height: 68px;
  }

  .workspace-header--compact {
    min-height: 60px;
    padding: 10px 18px;
    background: #080808;
  }

  .workspace-header--compact .workspace-title {
    font-size: 16px;
  }

  .workspace-header--compact .workspace-subtitle {
    font-size: 11px;
  }

  .workspace-header-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .workspace-kicker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(232, 234, 237, 0.16);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .workspace-kicker::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: linear-gradient(135deg, #F4F6F8, #8E949E);
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.28);
  }

  .workspace-title-block {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .workspace-title {
    margin: 0;
    font-size: 20px;
    line-height: 1;
    letter-spacing: -0.03em;
  }

  .workspace-subtitle {
    color: var(--text-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .workspace-tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .workspace-tab {
    border: 1px solid rgba(232, 234, 237, 0.16);
    background: rgba(8, 8, 8, 0.72);
    color: var(--text-muted);
    border-radius: 999px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    transition: 160ms ease;
    white-space: nowrap;
  }

  .workspace-tab[data-active='true'] {
    color: var(--text-main);
    background: var(--ws-facet);
    border-color: rgba(232, 234, 237, 0.32);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.16);
  }

  .workspace-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--ws-nested-bg);
  }

  /* ── Welcome page ─────────────────────────────────────── */
  .landing-page {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background-color: #080808;
    background-image:
      radial-gradient(ellipse 120% 90% at -8% -12%, #2A2A2A 0%, #141414 28%, rgba(8, 8, 8, 0) 62%),
      radial-gradient(ellipse 90% 70% at 110% -8%, #1A1A1A 0%, rgba(8, 8, 8, 0) 58%),
      radial-gradient(ellipse 100% 80% at 108% 112%, #161616 0%, rgba(8, 8, 8, 0) 60%),
      radial-gradient(ellipse 80% 64% at -10% 110%, #141414 0%, rgba(8, 8, 8, 0) 56%);
    background-repeat: no-repeat;
    scrollbar-width: thin;
    scrollbar-color: rgba(232,234,237,0.18) transparent;
  }

  .landing-canvas {
    position: relative;
    min-height: 100%;
  }

  .landing-sky {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .landing-sky-svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .landing-shell {
    position: relative;
    z-index: 1;
    width: min(1360px, 100%);
    margin: 0 auto;
    padding: 4px clamp(20px, 3vw, 48px) clamp(20px, 3vw, 40px);
    display: flex;
    flex-direction: column;
    gap: 56px;
  }

  /* ── Hero ──────────────────────────────────────────────── */
  .landing-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .landing-preview {
    position: relative;
    width: min(1120px, 100%);
    margin: 0 auto;
    -webkit-mask-image: radial-gradient(ellipse 86% 78% at 50% 46%, #000 62%, transparent 100%);
    mask-image: radial-gradient(ellipse 86% 78% at 50% 46%, #000 62%, transparent 100%);
  }

  .landing-copy {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 860px;
  }

  .landing-status-version {
    margin-bottom: 18px;
    color: #5a7a9a;
    font: 600 11px/1 "JetBrains Mono", monospace;
    letter-spacing: 0.08em;
  }

  .landing-title {
    margin: 0 0 18px;
    color: #f0f7ff;
    font-family: "Inter", "Segoe UI", sans-serif;
    font-size: clamp(34px, 4.2vw, 64px);
    line-height: 1.08;
    letter-spacing: -0.04em;
    font-weight: 800;
  }

  .landing-title span {
    color: transparent;
    background: linear-gradient(100deg, #7fd0ff 0%, #4cc38a 50%, #f2b66d 100%);
    -webkit-background-clip: text;
    background-clip: text;
  }

  .landing-subtitle {
    margin: 0 0 30px;
    color: #7a99b8;
    font-size: clamp(14px, 1.2vw, 17px);
    line-height: 1.7;
    max-width: 60ch;
  }

  .landing-cta-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .landing-cta-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 22px;
    border-radius: 12px;
    border: 1px solid rgba(74, 163, 255, 0.5);
    background: linear-gradient(135deg, rgba(74, 163, 255, 0.28), rgba(56, 210, 160, 0.18));
    color: #e8f6ff;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: 180ms ease;
    box-shadow: 0 0 0 1px rgba(74, 163, 255, 0.1) inset, 0 8px 24px rgba(74, 163, 255, 0.15);
  }

  .landing-cta-primary:hover {
    transform: translateY(-2px);
    background: linear-gradient(135deg, rgba(74, 163, 255, 0.38), rgba(56, 210, 160, 0.26));
    box-shadow: 0 0 0 1px rgba(74, 163, 255, 0.18) inset, 0 14px 32px rgba(74, 163, 255, 0.22);
  }

  .landing-cta-secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-radius: 12px;
    border: 1px solid rgba(158, 217, 255, 0.14);
    background: rgba(255, 255, 255, 0.04);
    color: #8fafc8;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: 180ms ease;
  }

  .landing-cta-secondary:hover {
    border-color: rgba(158, 217, 255, 0.26);
    color: #c5dcef;
    background: rgba(255, 255, 255, 0.07);
  }

  /* ── Star map ──────────────────────────────────────────── */
  .star-map {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .star-map-twinkle {
    animation: star-map-twinkle 7s ease-in-out infinite;
  }

  .star-map-station {
    animation: star-map-drift 16s ease-in-out infinite;
  }

  .star-map-deck {
    fill: none;
    stroke: rgba(206, 218, 228, 0.16);
    stroke-width: 0.6;
  }

  .star-map-deck--outer {
    stroke: rgba(226, 232, 238, 0.28);
    stroke-width: 0.75;
  }

  .star-map-deck--hair {
    stroke: rgba(214, 196, 164, 0.22);
    stroke-width: 0.4;
  }

  .star-map-deck--inner {
    stroke: rgba(214, 224, 232, 0.2);
    stroke-width: 0.7;
  }

  .star-map-deck--core {
    stroke: rgba(236, 242, 248, 0.34);
    stroke-width: 0.65;
    animation: star-map-breathe 8s ease-in-out infinite;
  }

  .star-map-spoke {
    stroke: rgba(206, 218, 228, 0.09);
    stroke-width: 0.45;
  }

  .star-map-tick {
    stroke: rgba(220, 228, 236, 0.22);
    stroke-width: 0.45;
  }

  .star-map-tick--major {
    stroke: rgba(232, 224, 206, 0.38);
    stroke-width: 0.6;
  }

  .star-map-sector {
    stroke: none;
    opacity: 0.09;
  }

  .star-map-bound {
    stroke: rgba(226, 232, 238, 0.2);
    stroke-width: 0.55;
  }

  .star-map-arc {
    fill: none;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-opacity: 0.7;
  }

  .star-map-spine {
    stroke-width: 0.7;
  }

  .star-map-link {
    fill: none;
    stroke-width: 0.65;
    stroke-opacity: 0.34;
    stroke-linecap: round;
  }

  .star-map-link--bloom {
    stroke-width: 2.4;
    stroke-opacity: 0.08;
  }

  .star-map-machine-link {
    stroke: rgba(198, 220, 210, 0.55);
    stroke-width: 0.7;
  }

  .star-map-machine-link--idle {
    stroke: rgba(210, 218, 226, 0.5);
  }

  .star-map-cluster {
    fill: rgba(150, 186, 170, 0.05);
    stroke: rgba(190, 214, 204, 0.08);
    stroke-width: 0.6;
  }

  .star-map-cluster--idle {
    fill: rgba(170, 178, 188, 0.04);
    stroke: rgba(190, 198, 206, 0.06);
  }

  .star-map-flow {
    fill: none;
    stroke: rgba(226, 234, 242, 0.2);
    stroke-width: 0.7;
    stroke-linecap: round;
  }

  .star-map-comet {
    pointer-events: none;
  }

  .star-map-machine {
    fill: #e7f3ee;
  }

  .star-map-machine--idle {
    fill: #d5dde6;
  }

  .star-map-hub-glow {
    transform-box: fill-box;
    transform-origin: center;
    animation: star-map-breathe 7s ease-in-out infinite;
  }

  .star-map-hub-ring {
    fill: none;
    stroke: rgba(232, 240, 246, 0.28);
    stroke-width: 0.55;
  }

  .star-map-label {
    font-family: "Huangkai Hualu", "KaiTi", "STKaiti", cursive;
    font-size: 17px;
    font-weight: 400;
    letter-spacing: 0.06em;
    fill: rgba(236, 232, 224, 0.92);
  }

  .star-map-label--stage {
    font-size: 17px;
    letter-spacing: 0.06em;
  }

  .star-map-label--hub {
    fill: #f7fbff;
    font-size: 28px;
    letter-spacing: 0.16em;
  }

  /* ── Metrics strip ─────────────────────────────────────── */
  .landing-metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .landing-metric {
    padding: 18px 20px;
    border-radius: 16px;
    border: 1px solid rgba(158, 217, 255, 0.09);
    background: rgba(255, 255, 255, 0.025);
    position: relative;
    overflow: hidden;
    transition: border-color 200ms ease;
  }

  .landing-metric::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(158, 217, 255, 0.2), transparent);
  }

  .landing-metric:hover {
    border-color: rgba(158, 217, 255, 0.18);
  }

  .landing-metric-value {
    color: #ddeeff;
    font: 800 28px/1 "Inter", sans-serif;
    letter-spacing: -0.04em;
  }

  .landing-metric[data-tone='mint'] .landing-metric-value { color: #56d3a0; }
  .landing-metric[data-tone='amber'] .landing-metric-value { color: #f2b66d; }
  .landing-metric[data-tone='rose'] .landing-metric-value { color: #ff9daf; }
  .landing-metric[data-tone='cyan'] .landing-metric-value { color: #7fd0ff; }

  .landing-metric-label {
    margin-top: 6px;
    color: #4a6a85;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  /* ── Animations ────────────────────────────────────────── */
  @keyframes star-map-twinkle {
    0%, 100% { opacity: 0.28; }
    50% { opacity: 0.92; }
  }

  @keyframes star-map-drift {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-2px); }
  }

  @keyframes star-map-breathe {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }

  .workspace-loading {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--text-muted);
    background: var(--ws-nested-bg);
    font-size: 14px;
  }

  @media (max-width: 980px) {
    .workspace-header {
      flex-direction: column;
      align-items: stretch;
      min-height: auto;
      padding: 12px 18px;
    }

    .workspace-header-main {
      justify-content: space-between;
    }

    .workspace-subtitle {
      white-space: normal;
    }

    .workspace-tabs {
      justify-content: flex-start;
    }

    .landing-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

  }

  @media (max-width: 680px) {
    .app-rail {
      width: 72px;
      padding: 14px 9px;
    }

    .landing-shell {
      padding: 4px 16px 20px;
      gap: 36px;
    }

    .landing-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .landing-preview {
      width: calc(100% + 32px);
      margin: 0 -16px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .star-map-twinkle,
    .star-map-station,
    .star-map-deck--core,
    .star-map-hub-glow,
    .landing-cta-primary,
    .landing-cta-secondary {
      animation: none;
      transition: none;
    }
  }
`;

function WorkspaceShell({
  title,
  subtitle,
  tabs,
  compact = false,
  kicker,
  children,
}: {
  title: string;
  subtitle?: string;
  tabs?: ReactNode;
  compact?: boolean;
  kicker?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="workspace-shell">
      <header className={`workspace-header${compact ? " workspace-header--compact" : ""}`}>
        <div className="workspace-header-main">
          <div className="workspace-kicker">{kicker ?? t('workspace.kicker')}</div>
          <div className="workspace-title-block">
            <h1 className="workspace-title">{title}</h1>
            {subtitle ? <div className="workspace-subtitle">{subtitle}</div> : null}
          </div>
        </div>
        {tabs ? <div className="workspace-tabs">{tabs}</div> : null}
      </header>
      <div className="workspace-body">{children}</div>
    </section>
  );
}

function WorkspaceFallback() {
  const { t } = useI18n();
  return <div className="workspace-loading">{t('workspace.loading')}</div>;
}

function getNumberStat(payload: GraphStatsPayload, keys: Array<keyof GraphStatsPayload>) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function formatMetric(value: number | null, fallback: string) {
  return value === null ? fallback : value.toLocaleString();
}

function WelcomeScreen({
  onOpenNetwork,
  onOpenReasoning,
}: {
  onOpenNetwork: () => void;
  onOpenReasoning: () => void;
}) {
  const { t } = useI18n();
  const [stats, setStats] = useState<{ nodes: number | null; edges: number | null; status: ConnectionStatus }>({
    nodes: null,
    edges: null,
    status: 'checking',
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/graph/stats', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<GraphStatsPayload> : null))
      .then((payload) => {
        if (!payload) {
          setStats((current) => ({ ...current, status: 'offline' }));
          return;
        }

        setStats({
          nodes: getNumberStat(payload, ['node_count', 'nodeCount', 'nodes']),
          edges: getNumberStat(payload, ['edge_count', 'edgeCount', 'edges']),
          status: 'online',
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setStats((current) => ({ ...current, status: 'offline' }));
      });

    return () => controller.abort();
  }, []);

  const isOnline = stats.status === 'online';
  const metrics: LandingMetric[] = [
    { label: t('metric.nodes'), value: formatMetric(stats.nodes, t('metric.live')), tone: 'cyan' },
    { label: t('metric.edges'), value: formatMetric(stats.edges, t('metric.ready')), tone: 'mint' },
    { label: t('metric.modes'), value: '3', tone: 'amber' },
    { label: isOnline ? t('metric.datasetOnline') : t('metric.readyToExplore'), value: isOnline ? t('metric.active') : t('metric.standby'), tone: 'rose' },
  ];

  return (
    <main className="landing-page">
      <div className="landing-canvas">
      <LandingSky />
      <div className="landing-shell">

        {/* ── Hero ── */}
        <section className="landing-hero">
          <div className="landing-preview">
            <LandingStarMap />
          </div>

          <div className="landing-copy">
            <div className="landing-status-version">{t('landing.version')}</div>

            <h1 className="landing-title">
              {t('landing.titleBefore')}<br />
              <span>{t('landing.titleAccent')}</span>
            </h1>
            <p className="landing-subtitle">
              {t('landing.subtitle')}
            </p>

            <div className="landing-cta-row">
              <button className="landing-cta-primary" type="button" onClick={onOpenNetwork}>
                <Network size={16} />
                {t('landing.openExplorer')}
                <ArrowRight size={15} />
              </button>
              <button className="landing-cta-secondary" type="button" onClick={onOpenReasoning}>
                <BrainCircuit size={15} />
                {t('landing.runReasoning')}
              </button>
            </div>
          </div>
        </section>

        {/* ── Live metrics ── */}
        <div className="landing-metrics" aria-label={t('landing.metricsLabel')}>
          {metrics.map((metric) => (
            <div key={metric.label} className="landing-metric" data-tone={metric.tone}>
              <div className="landing-metric-value">{metric.value}</div>
              <div className="landing-metric-label">{metric.label}</div>
            </div>
          ))}
        </div>

      </div>
      </div>
    </main>
  );
}

export default function App() {
  const { locale, setLocale, t } = useI18n();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>(readInitialWorkspace);
  const [exploreView, setExploreView] = useState<ExploreView>('graph');
  const [analyzeView, setAnalyzeView] = useState<AnalyzeView>('reasoning');
  const [enrichView, setEnrichView] = useState<EnrichView>('documents');
  const [manageView, setManageView] = useState<ManageView>('lineage');
  const [graphFocusRequest, setGraphFocusRequest] = useState<{ nodeId: string; token: number } | null>(null);
  const [exploreDraftDirty, setExploreDraftDirty] = useState(false);
  const [agentMemoryAvailable, setAgentMemoryAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchAgentMemoryAvailability().then((available) => {
      if (active) setAgentMemoryAvailable(available);
    });
    return () => {
      active = false;
    };
  }, []);

  const confirmDiscardExploreDraft = () => (
    !exploreDraftDirty
    || window.confirm(t('confirm.discardDraft'))
  );

  const switchExploreView = (nextView: ExploreView) => {
    if (nextView === exploreView) return;
    if (!confirmDiscardExploreDraft()) return;
    setExploreDraftDirty(false);
    setExploreView(nextView);
  };

  const switchWorkspace = (nextWorkspace: WorkspaceId) => {
    if (nextWorkspace === activeWorkspace) return;
    if (activeWorkspace === "explore" && !confirmDiscardExploreDraft()) return;
    setExploreDraftDirty(false);
    setActiveWorkspace(nextWorkspace);
  };


  const renderWorkspace = () => {
    if (activeWorkspace === 'welcome') {
      return (
        <WelcomeScreen
          onOpenNetwork={() => {
            setActiveWorkspace('explore');
            setExploreView('graph');
          }}
          onOpenReasoning={() => {
            setActiveWorkspace('analyze');
            setAnalyzeView('reasoning');
          }}
        />
      );
    }

    if (activeWorkspace === 'explore') {
      return (
        <WorkspaceShell
          title={t('explore.title')}
          subtitle={exploreView === 'graph' ? undefined : exploreView === 'memories' ? t('explore.subtitleMemories') : t('explore.subtitleVocabulary')}
          kicker={exploreView === 'graph' ? t('explore.kickerGraph') : exploreView === 'memories' ? t('explore.kickerMemory') : t('explore.kickerVocabulary')}
          compact
          tabs={
            <ExploreWorkspaceTabs
              activeView={exploreView}
              agentMemoryAvailable={agentMemoryAvailable}
              onSelect={switchExploreView}
            />
          }
        >
          <ErrorBoundary key={`explore-${exploreView}`}>
            <Suspense fallback={<WorkspaceFallback />}>
              {exploreView === 'graph' ? (
                <GraphWorkspace
                  externalFocusNodeId={graphFocusRequest?.nodeId}
                  externalFocusToken={graphFocusRequest?.token}
                  onDirtyChange={setExploreDraftDirty}
                />
              ) : exploreView === 'memories' ? <MemoryWorkspace onDirtyChange={setExploreDraftDirty} /> : <VocabularyWorkspace />}
            </Suspense>
          </ErrorBoundary>
        </WorkspaceShell>
      );
    }

    if (activeWorkspace === 'analyze') {
      return (
        <WorkspaceShell
          title={t('analyze.title')}
          subtitle={t('analyze.subtitle')}
          kicker={analyzeView === 'reasoning' ? t('analyze.kickerReasoning') : t('analyze.kickerSparql')}
          tabs={
            <>
              <button className="workspace-tab" data-active={analyzeView === 'reasoning'} onClick={() => setAnalyzeView('reasoning')}>
                {t('analyze.tabReasoning')}
              </button>
              <button className="workspace-tab" data-active={analyzeView === 'sparql'} onClick={() => setAnalyzeView('sparql')}>
                {t('analyze.tabSparql')}
              </button>
            </>
          }
        >
          <ErrorBoundary key={`analyze-${analyzeView}`}>
            <Suspense fallback={<WorkspaceFallback />}>
              {analyzeView === 'reasoning' ? <ReasoningWorkspace /> : <SparqlWorkspace />}
            </Suspense>
          </ErrorBoundary>
        </WorkspaceShell>
      );
    }

    if (activeWorkspace === 'decisions') {
      return (
        <WorkspaceShell
          title={t('decisions.title')}
          subtitle={t('decisions.subtitle')}
          kicker={t('decisions.kicker')}
        >
          <ErrorBoundary key="decisions">
            <Suspense fallback={<WorkspaceFallback />}>
              <DecisionWorkspace />
            </Suspense>
          </ErrorBoundary>
        </WorkspaceShell>
      );
    }

    if (activeWorkspace === 'enrich') {
      return (
        <WorkspaceShell
          title={t('enrich.title')}
          subtitle={t('enrich.subtitle')}
          kicker={t('enrich.kicker')}
          tabs={
            <>
              {enrichTabs.map((tab) => (
                <button
                  key={tab.id}
                  className="workspace-tab"
                  data-active={enrichView === tab.id}
                  onClick={() => setEnrichView(tab.id)}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </>
          }
        >
          <ErrorBoundary key={`enrich-${enrichView}`}>
            <Suspense fallback={<WorkspaceFallback />}>
              {{
                documents: <DocumentsWorkspace />,
                import: <ImportExportWorkspace />,
                merge: <DiffMergeWorkspace />,
                resolve: <EntityResolutionTab />,
                registry: <RegistryTab />,
              }[enrichView]}
            </Suspense>
          </ErrorBoundary>
        </WorkspaceShell>
      );
    }

    if (activeWorkspace === 'models') {
      return (
        <WorkspaceShell
          title={t('models.title')}
          subtitle={t('models.subtitle')}
          kicker={t('models.kicker')}
        >
          <ErrorBoundary key="models">
            <Suspense fallback={<WorkspaceFallback />}>
              <ModelSettingsWorkspace />
            </Suspense>
          </ErrorBoundary>
        </WorkspaceShell>
      );
    }

    if (activeWorkspace === 'ontology-hub') {
      return (
        <WorkspaceShell
          title={t('ontology.title')}
          subtitle={t('ontology.subtitle')}
          kicker={t('ontology.kicker')}
          compact
        >
          <ErrorBoundary key="ontology-hub">
            <Suspense fallback={<WorkspaceFallback />}>
              <OntologyWorkspace
                onJumpToGraphNode={(nodeId: string) => {
                  setGraphFocusRequest({ nodeId, token: Date.now() });
                  setActiveWorkspace('explore');
                  setExploreView('graph');
                }}
              />
            </Suspense>
          </ErrorBoundary>
        </WorkspaceShell>
      );
    }

    return (
      <WorkspaceShell
        title={t('manage.title')}
        subtitle={t('manage.subtitle')}
        kicker={t('manage.kicker')}
        tabs={
          <>
            <button className="workspace-tab" data-active={manageView === 'lineage'} onClick={() => setManageView('lineage')}>
              {t('manage.tabLineage')}
            </button>
            <button className="workspace-tab" data-active={manageView === 'kg-overview'} onClick={() => setManageView('kg-overview')}>
              {t('manage.tabOverview')}
            </button>
            <button className="workspace-tab" data-active={manageView === 'ontology'} onClick={() => setManageView('ontology')}>
              {t('manage.tabOntology')}
            </button>
          </>
        }
      >
        <ErrorBoundary key={`manage-${manageView}`}>
          <Suspense fallback={<WorkspaceFallback />}>
            {manageView === 'lineage' ? <LineageDiagram /> :
             manageView === 'kg-overview' ? <KGOverviewTab /> :
             <OntologySummaryTab onOpenVocabularyBrowser={() => {
               setActiveWorkspace('explore');
               setExploreView('vocabulary');
             }} />}
          </Suspense>
        </ErrorBoundary>
      </WorkspaceShell>
    );
  };

  return (
    <QueryClientProvider client={queryClient}>
      <style>{shellStyles}</style>
      <div className="app-shell">
        <aside className="app-rail">
          <button className="brand-pill" title={t('nav.brandTitle')} onClick={() => switchWorkspace('welcome')} style={{ cursor: 'pointer', border: '1px solid rgba(127,208,255,0.18)' }}>{t('nav.home')}</button>
          {navItems.map(({ id, labelKey, hintKey, icon: Icon }) => (
            <button
              key={id}
              className="nav-button"
              data-active={activeWorkspace === id}
              onClick={() => switchWorkspace(id)}
              title={t(hintKey)}
            >
              <Icon size={20} />
              <span className="nav-label">{t(labelKey)}</span>
            </button>
          ))}
          <button
            className="nav-button locale-button"
            type="button"
            title={locale === 'zh' ? t('locale.switchToEn') : t('locale.switchToZh')}
            onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          >
            <span className="nav-label">{locale === 'zh' ? t('locale.labelEn') : t('locale.labelZh')}</span>
          </button>
        </aside>
        {renderWorkspace()}
      </div>
    </QueryClientProvider>
  );
}
