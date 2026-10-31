import { useEffect, useState } from "react";

import { en, zh, type MessageKey } from "./messages";

export type Locale = "en" | "zh";

const STORAGE_KEY = "semantica.locale";

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, zh };

function detectLocale(): Locale {
  if (typeof window === "undefined") {
    return "en";
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "zh" || stored === "en") {
      return stored;
    }
  } catch {
    // localStorage can be unavailable in private or non-browser contexts.
  }
  const language = typeof navigator === "undefined" ? "" : navigator.language;
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let currentLocale: Locale = detectLocale();
const listeners = new Set<() => void>();

function applyDocumentLanguage(locale: Locale) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}

applyDocumentLanguage(currentLocale);

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  currentLocale = locale;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures; the in-memory locale still applies.
  }
  applyDocumentLanguage(locale);
  listeners.forEach((listener) => listener());
}

export function lookupCatalog(
  catalogsByLocale: Record<Locale, object>,
  key: string,
  fallback: string,
): string {
  const localized = catalogsByLocale[currentLocale] as Record<string, string | undefined>;
  const english = catalogsByLocale.en as Record<string, string | undefined>;
  return localized[key] ?? english[key] ?? fallback;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let text = lookupCatalog(catalogs, key, key);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function useI18n() {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { locale: currentLocale, setLocale, t };
}
