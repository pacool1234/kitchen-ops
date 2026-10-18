import {
  DEFAULT_LOCALE,
  endpoints,
  type Locale,
  type MeResponse,
} from "@kitchen-ops/shared";
import { createI18n, useI18n } from "vue-i18n";
import { call } from "../api";
import { deviceLocale, localeAfterSignIn } from "./locale";
import { en } from "./messages/en";
import { es, type Messages } from "./messages/es";

// The interface's languages (#86, decision 0023): Spanish by default, English second. Each
// user's choice is saved by the API (PATCH /api/me); this device remembers the last one shown,
// for the sign-in page.

/** Every message's key, dotted: "signIn.title". */
type Keys<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : Keys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
export type MessageKey = Keys<Messages>;

const STORAGE_KEY = "kitchen-ops.locale";

function storedLocale(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: this device just doesn't remember
  }
}

export const i18n = createI18n({
  legacy: false,
  locale: deviceLocale(storedLocale()),
  fallbackLocale: DEFAULT_LOCALE,
  messages: { es, en },
});

/**
 * vue-i18n's `t`, taking only keys that exist: `t("no.such.key")` doesn't compile. vue-i18n's
 * own `t` accepts any string, and its key types only drive autocompletion. Call it in `setup`.
 */
export function useT() {
  const { t } = useI18n();
  return (key: MessageKey, values: Record<string, unknown> = {}): string =>
    t(key, values);
}

/** Shows the app in `locale`: its messages, `<html lang>` (WCAG 3.1.1), and this device remembers it. */
export function showLocale(locale: Locale) {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // storage blocked: shown, but not remembered on this device
  }
}

/** A language chosen on the sign-in page, to save as the user's once they are in. */
let chosenWhileSignedOut: Locale | null = null;

/** The user picks a language. Signed in, it's saved as theirs; signed out, once they sign in. */
export async function chooseLocale(locale: Locale, signedIn: boolean) {
  showLocale(locale);
  if (signedIn) {
    await call(endpoints.updateMe, { body: { locale } });
  } else {
    chosenWhileSignedOut = locale;
  }
}

/** With the signed-in user, on every navigation: shows their language (see localeAfterSignIn). */
export async function adoptUserLocale(me: MeResponse) {
  const { show, save } = localeAfterSignIn(me.locale, chosenWhileSignedOut);
  showLocale(show);
  if (save) {
    try {
      await call(endpoints.updateMe, { body: { locale: show } });
    } catch {
      // Shown either way; saving it is tried again on the next navigation.
      return;
    }
  }
  chosenWhileSignedOut = null;
}
