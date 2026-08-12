/**
 * lib/i18n.js — the `t()` seam.
 *
 * ⭐ Ote, 2026-08-13, asked for i18n back. His original supported **64 languages**, and the
 * mechanism was `translate_msg_out()`:
 *
 *     def g_trans(self, msg, trans2="th", transfrom="auto"):
 *         translator = Translator()
 *         return translator.translate(msg, src=transfrom, dest=trans2).text
 *
 *     def translate_msg_out(self, msg, trans2="en"):
 *         if trans2.lower() == "en": return msg
 *         return self.g_trans(msg, trans2, "en")
 *
 * — every user-facing string, machine-translated at the moment of sending.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ THAT MECHANISM IS NOT REBUILT, AND THIS IS THE ARGUMENT
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **A NETWORK CALL PER STRING, ON THE HOT PATH.** His `/market` embed alone would be a dozen
 *    round trips to an external service before Discord's **3-second** acknowledgement window.
 *    This project already had to restructure every command around that limit (see
 *    `app/bot/respond.js`); putting a live translation in front of each string would undo it.
 *
 * 2. **IT IS NON-DETERMINISTIC.** The same message can come back worded differently on two
 *    calls, so nothing about the output is testable. Every one of the 318 checks that asserts on
 *    a message would become a check on a third party's mood.
 *
 * 3. **IT MANGLES WHAT IS NOT PROSE.** These strings are full of `**markdown**`, `` `code` ``,
 *    emoji, `<@mentions>` and `{counts}`. A translator rewrites mention syntax, reorders emoji
 *    and drops backticks — and his own text shows the seams: `"<Decision> The player chose
 *    Insurance!)🤝(ยอม"`, where a stray Thai word has been left inside an English sentence.
 *
 * 4. **`googletrans` IS AN UNOFFICIAL SCRAPER.** It breaks whenever the endpoint changes, and it
 *    would be a hard dependency of the bot being able to *speak at all*.
 *
 * ⇒ So: **CATALOGUES**, looked up in memory, with `t()` as the seam. What that costs is his 64
 * languages, because a catalogue only holds what someone has written. What it buys is that a
 * translation is a reviewable file, the same every time, and free at runtime.
 *
 * ⭐ **`/trans` still exists** as a command (`app/cogs/utility/index.js`), because translating
 * something *on request* is a genuinely useful thing a bot can do — a live translation is fine
 * when the user asked for exactly that. It is the automatic path that was the problem.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ COVERAGE IS PARTIAL AND DELIBERATELY SO
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The seam is complete; the catalogue is not. Converted so far: `/help`, `/rand`, `/trans`,
 * `/server`, `/ping`, `/about`, `/feedback`'s replies and the prefix redirect. **The games are
 * NOT converted** — that is several hundred strings, many with counts and lists in them, and
 * doing it badly would be worse than not doing it. `missingKeys()` reports what a language is
 * short of so the gap is measurable rather than a guess.
 */

import { CATALOGUES, DEFAULT_LANG, LANGUAGE_NAMES } from "../app/i18n/index.js";

/** Language codes we actually have strings for. NOT his 64 — see the header. */
export function supportedLangs() {
    return Object.keys(CATALOGUES);
}

export function isSupportedLang(lang) {
    return typeof lang === "string" && Object.hasOwn(CATALOGUES, lang.toLowerCase());
}

export function languageName(lang) {
    return LANGUAGE_NAMES[String(lang).toLowerCase()] ?? String(lang);
}

/**
 * Fill `{placeholders}` from `params`.
 *
 * ⚠️ A missing parameter leaves the placeholder VISIBLE rather than printing "undefined". A
 * literal `{count}` in a message is an obvious bug someone will report; "undefined coins" reads
 * like a real number and gets ignored.
 */
function interpolate(template, params) {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (whole, key) =>
        Object.hasOwn(params, key) ? String(params[key]) : whole,
    );
}

/**
 * Translate one key.
 *
 * Resolution order: the requested language → `DEFAULT_LANG` → the key itself. Falling back to
 * the key rather than throwing is deliberate: a missing string should degrade to something ugly
 * but working, not take a command down. `missingKeys()` is how they get found instead.
 *
 * @param {string} key      dotted, e.g. "help.title"
 * @param {string} [lang]   language code; unknown codes fall back
 * @param {object} [params] values for {placeholders}
 */
export function t(key, lang = DEFAULT_LANG, params = null) {
    const code = String(lang ?? DEFAULT_LANG).toLowerCase();
    const catalogue = CATALOGUES[code] ?? CATALOGUES[DEFAULT_LANG];

    const value = catalogue?.[key] ?? CATALOGUES[DEFAULT_LANG]?.[key];
    if (value === undefined) return key;

    return interpolate(value, params);
}

/**
 * Bind `t()` to one language, so a handler is not repeating the code on every line.
 * `const s = translator(lang); s("help.title")`
 */
export function translator(lang) {
    return (key, params = null) => t(key, lang, params);
}

/**
 * Which keys a language is missing relative to the default.
 *
 * ⭐ This exists so "how translated is Thai?" has a number instead of an opinion, and so a test
 * can assert that no catalogue contains a key the default does not — a typo in a key name would
 * otherwise sit there silently rendering as itself.
 */
export function missingKeys(lang) {
    const base = Object.keys(CATALOGUES[DEFAULT_LANG] ?? {});
    const target = CATALOGUES[String(lang).toLowerCase()] ?? {};
    return base.filter((key) => target[key] === undefined);
}

/** Keys a language has that the default does not — always a mistake. */
export function strayKeys(lang) {
    const base = CATALOGUES[DEFAULT_LANG] ?? {};
    const target = Object.keys(CATALOGUES[String(lang).toLowerCase()] ?? {});
    return target.filter((key) => base[key] === undefined);
}

/** How complete each language is, for `/server` and `/admin stats` to report. */
export function coverage() {
    const total = Object.keys(CATALOGUES[DEFAULT_LANG] ?? {}).length;
    return supportedLangs().map((lang) => {
        const missing = missingKeys(lang).length;
        return {
            lang,
            name: languageName(lang),
            total,
            translated: total - missing,
            percent: total === 0 ? 100 : Math.round(((total - missing) / total) * 100),
        };
    });
}

export { DEFAULT_LANG };
