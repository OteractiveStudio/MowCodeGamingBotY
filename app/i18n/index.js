/**
 * app/i18n/index.js — the catalogue registry.
 *
 * ⭐ Adding a language is: write `xx.js`, import it here, add its name below. Nothing else in the
 * tree changes, which is the whole point of the `t()` seam in `lib/i18n.js`.
 *
 * ⚠️ ONLY LANGUAGES WITH REAL STRINGS ARE LISTED. His original advertised **64** because it
 * machine-translated at send time; offering a language the bot cannot actually speak is worse
 * than offering fewer, because a player sets it and then sees English anyway with no explanation.
 * `/server set lang` warns when a language is only partly translated, and `coverage()` puts a
 * number on it.
 */

import en from "./en.js";
import th from "./th.js";

/** ⚠️ The reference language. Every lookup falls back here, so it must be complete. */
export const DEFAULT_LANG = "en";

export const CATALOGUES = { en, th };

/** Shown in `/server` and the language picker. */
export const LANGUAGE_NAMES = {
    en: "English",
    th: "ไทย (Thai)",
};
