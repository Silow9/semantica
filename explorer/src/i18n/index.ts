import { useSyncExternalStore } from "react";

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
  if (locale === currentLocale) {
    return;
  }
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

export interface LocalizedMessage {
  key: MessageKey;
  vars?: Record<string, string | number | LocalizedMessage>;
}

export function message(key: MessageKey, vars?: LocalizedMessage["vars"]): LocalizedMessage {
  return vars ? { key, vars } : { key };
}

export function formatMessage(value: LocalizedMessage): string {
  if (!value.vars) {
    return t(value.key);
  }
  const vars: Record<string, string | number> = {};
  for (const [name, item] of Object.entries(value.vars)) {
    vars[name] = typeof item === "object" ? formatMessage(item) : item;
  }
  return t(value.key, vars);
}

export function sameMessage(a: LocalizedMessage | undefined, b: LocalizedMessage | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.key !== b.key) {
    return false;
  }
  const aVars = a.vars ?? {};
  const bVars = b.vars ?? {};
  const names = Object.keys(aVars);
  if (names.length !== Object.keys(bVars).length) {
    return false;
  }
  return names.every((name) => {
    const left = aVars[name];
    const right = bVars[name];
    if (typeof left === "object" && typeof right === "object") {
      return sameMessage(left, right);
    }
    return left === right;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getLocaleSnapshot(): Locale {
  return currentLocale;
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocaleSnapshot, getLocaleSnapshot);
  return { locale, setLocale, t };
}
