import { DEFAULT_LOCALE, Locale } from "@kitchen-ops/shared";

// Which language the app shows (#86). The rules only; src/i18n/index.ts applies them.

/** Each language's name in itself, for the switch: everyone finds their own, whatever is shown. */
export const LANGUAGE_NAMES: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

/** Before sign-in: the language last used on this device, else Spanish. */
export function deviceLocale(stored: string | null): Locale {
  const parsed = Locale.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_LOCALE;
}

/**
 * After sign-in: the user's saved language, so a shared tablet doesn't keep the previous user's.
 * If they chose one on the sign-in page just now, that one, saved as theirs.
 */
export function localeAfterSignIn(
  saved: Locale,
  chosenWhileSignedOut: Locale | null,
): { show: Locale; save: boolean } {
  if (chosenWhileSignedOut === null) return { show: saved, save: false };
  return {
    show: chosenWhileSignedOut,
    save: chosenWhileSignedOut !== saved,
  };
}
