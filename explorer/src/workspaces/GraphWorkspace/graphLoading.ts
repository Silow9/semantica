import { t, type LocalizedMessage } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";
import type { GraphLoadPhase, GraphLoadProgress, GraphLoadProgressKind, GraphLayoutSource, GraphLayoutState } from "./types";

export const GRAPH_LOAD_STAGE_SEQUENCE: Exclude<GraphLoadPhase, "ready">[] = [
  "bootstrapping",
  "fetching_nodes",
  "fetching_edges",
  "computing_styling",
  "hydrating_scene",
  "stabilizing_layout",
];

function phaseTitleKey(phase: GraphLoadPhase): MessageKey {
  switch (phase) {
    case "bootstrapping":
      return "graph.phase.bootstrapping";
    case "fetching_nodes":
      return "graph.phase.fetching_nodes";
    case "fetching_edges":
      return "graph.phase.fetching_edges";
    case "computing_styling":
      return "graph.phase.computing_styling";
    case "hydrating_scene":
      return "graph.phase.hydrating_scene";
    case "stabilizing_layout":
      return "graph.phase.stabilizing_layout";
    case "ready":
    default:
      return "graph.phase.ready";
  }
}

function stageLabelKey(phase: Exclude<GraphLoadPhase, "ready">): MessageKey {
  switch (phase) {
    case "bootstrapping":
      return "graph.stageLabel.bootstrapping";
    case "fetching_nodes":
      return "graph.stageLabel.fetching_nodes";
    case "fetching_edges":
      return "graph.stageLabel.fetching_edges";
    case "computing_styling":
      return "graph.stageLabel.computing_styling";
    case "hydrating_scene":
      return "graph.stageLabel.hydrating_scene";
    case "stabilizing_layout":
      return "graph.stageLabel.stabilizing_layout";
    default:
      return "graph.stageLabel.unknown";
  }
}

export function getGraphLoadTitle(phase: GraphLoadPhase): string {
  return t(phaseTitleKey(phase));
}

export function getGraphLoadStageLabel(phase: Exclude<GraphLoadPhase, "ready">): string {
  return t(stageLabelKey(phase));
}

export function createGraphLoadProgress(input: {
  phase: GraphLoadPhase;
  message: LocalizedMessage;
  progressKind: GraphLoadProgressKind;
  loaded?: number | null;
  total?: number | null;
  nodesLoaded?: number;
  nodesTotal?: number | null;
  edgesLoaded?: number;
  edgesTotal?: number | null;
  showGraphBehind?: boolean;
  layoutSource?: GraphLayoutSource;
  layoutState?: GraphLayoutState;
}): GraphLoadProgress {
  const phaseIndex = GRAPH_LOAD_STAGE_SEQUENCE.indexOf(input.phase as Exclude<GraphLoadPhase, "ready">);

  return {
    phase: input.phase,
    message: input.message,
    progressKind: input.progressKind,
    loaded: input.loaded ?? null,
    total: input.total ?? null,
    nodesLoaded: input.nodesLoaded ?? 0,
    nodesTotal: input.nodesTotal ?? null,
    edgesLoaded: input.edgesLoaded ?? 0,
    edgesTotal: input.edgesTotal ?? null,
    showGraphBehind: input.showGraphBehind ?? false,
    stageIndex: phaseIndex >= 0 ? phaseIndex + 1 : GRAPH_LOAD_STAGE_SEQUENCE.length,
    stageCount: GRAPH_LOAD_STAGE_SEQUENCE.length,
    layoutSource: input.layoutSource,
    layoutState: input.layoutState,
  };
}
