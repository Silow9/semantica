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

const translatedTerms = new Map<typeof relationCatalogs, Map<string, string>>();

function translateTerm(
  raw: string | null | undefined,
  catalogs: typeof relationCatalogs,
): string {
  const text = String(raw ?? "").trim();
  if (!text) {
    return text;
  }
  const locale = getLocale();
  let cache = translatedTerms.get(catalogs);
  if (!cache) {
    cache = new Map();
    translatedTerms.set(catalogs, cache);
  }
  const cacheKey = `${locale}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const fallback = locale === "en" ? text : text.replaceAll("_", " ");
  const translated = lookupCatalog(catalogs, normalizeTerm(text), fallback);
  cache.set(cacheKey, translated);
  return translated;
}

export function translateRelationType(raw: string | null | undefined): string {
  return translateTerm(raw, relationCatalogs);
}

export function translateNodeType(raw: string | null | undefined): string {
  return translateTerm(raw, nodeTypeCatalogs);
}
