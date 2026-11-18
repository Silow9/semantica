import { getLocale, type Locale } from "../../i18n";
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
  locale: Locale,
): string {
  const text = String(raw ?? "").trim();
  if (!text) {
    return text;
  }
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
  const table = catalogs[locale] as Record<string, string | undefined>;
  const translated = table[normalizeTerm(text)] ?? fallback;
  cache.set(cacheKey, translated);
  return translated;
}

export function translateRelationType(raw: string | null | undefined, locale: Locale = getLocale()): string {
  return translateTerm(raw, relationCatalogs, locale);
}

export function translateNodeType(raw: string | null | undefined, locale: Locale = getLocale()): string {
  return translateTerm(raw, nodeTypeCatalogs, locale);
}
