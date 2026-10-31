import { getLocale, lookupCatalog } from "../../i18n";
import { nodeTypeCatalogs, relationCatalogs } from "../../i18n/graphTerms";

function normalizeTerm(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

function translateTerm(
  raw: string | null | undefined,
  catalogs: typeof relationCatalogs,
): string {
  const text = String(raw ?? "").trim();
  if (!text) {
    return text;
  }
  const fallback = getLocale() === "en" ? text : text.replaceAll("_", " ");
  return lookupCatalog(catalogs, normalizeTerm(text), fallback);
}

export function translateRelationType(raw: string | null | undefined): string {
  return translateTerm(raw, relationCatalogs);
}

export function translateNodeType(raw: string | null | undefined): string {
  return translateTerm(raw, nodeTypeCatalogs);
}
