import { t } from "../../i18n";
import type { FocusedUnavailableReason, GroupedViewUnavailableReason } from "./types";

export function groupedViewReasonText(
  reason: GroupedViewUnavailableReason | null | undefined,
): string | null {
  if (!reason) {
    return null;
  }

  switch (reason.code) {
    case "communities-undetected":
      return t("graphView.communitiesUndetected");
    case "community-nodes-missing":
      return t("graphView.communityNodesMissing");
    case "invalid-community-layout":
      return t("graphView.invalidLayout", { nodeId: reason.nodeId });
    case "missing-grouped-node":
      return t("graphView.missingNode", { edgeId: reason.edgeId });
  }
}

export function focusedUnavailableReasonText(
  reason: FocusedUnavailableReason | null | undefined,
): string | null {
  if (!reason) {
    return null;
  }

  switch (reason.code) {
    case "no-selection":
      return t("graphView.noSelection");
    case "grouped-unresolvable":
      return t("graphView.groupedUnresolvable");
    case "not-in-graph":
      return t("graphView.notInGraph");
  }
}
