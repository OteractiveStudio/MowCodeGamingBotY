/**
 * app/bot/locale.js — which language and old-style prefix a guild uses.
 *
 * ⚠️ THIS EXISTS BECAUSE OF A CACHE, and the cache exists because of the single worst habit in
 * the legacy. His `lang_out()` did `json.load(open(self.datafile["settings"]))` — **reading and
 * parsing the whole settings file** — and `translate_msg_out` called it once per string. His
 * `fishing_cog.on_message` then called a **network translation** on every message in every server
 * just to test whether it started with "fish".
 *
 * The rule that came out of that (TRAPS #11): **anything on the message path must be free.** The
 * prefix redirect runs on every message, so it cannot afford a database round trip either.
 *
 * So: one query per guild, cached for a minute, invalidated explicitly when `/server set` writes.
 * A stale entry for up to 60 seconds is the cost, and it costs nothing — the worst case is a
 * player sees English for another minute after changing the language.
 */

import { getGuild } from "../data/guild.js";
import { DEFAULT_LANG, isSupportedLang } from "../../lib/i18n.js";

const TTL_MS = 60 * 1000;

/** guildId → { lang, prefix, at } */
const cache = new Map();

/** Drop a guild's entry. Called by `/server set` so a change is visible at once. */
export function forgetGuildLocale(guildId) {
    cache.delete(String(guildId));
}

/** Drop everything. For tests. */
export function clearLocaleCache() {
    cache.clear();
}

/**
 * The guild's language and prefix, from cache where possible.
 *
 * ⚠️ Never throws. A failed lookup falls back to the configured defaults, because the alternative
 * is a command dying over a settings read.
 */
export async function guildLocale(ctx, guildId) {
    const fallback = {
        lang: ctx?.config?.bot?.default_lang ?? DEFAULT_LANG,
        prefix: ctx?.config?.bot?.default_prefix ?? "+",
    };

    if (!guildId) return fallback;

    const key = String(guildId);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
        return { lang: hit.lang, prefix: hit.prefix };
    }

    let resolved = fallback;
    try {
        const row = await getGuild(ctx.db, guildId);
        if (row) {
            resolved = {
                // An unsupported code in the row falls back rather than rendering every key as
                // itself — a language could have been removed since it was set.
                lang: isSupportedLang(row.lang) ? String(row.lang).toLowerCase() : fallback.lang,
                prefix: row.prefix || fallback.prefix,
            };
        }
    } catch {
        // Fallback already holds the answer.
    }

    cache.set(key, { ...resolved, at: Date.now() });
    return resolved;
}

/** Just the language, which is what most handlers want. */
export async function guildLang(ctx, guildId) {
    return (await guildLocale(ctx, guildId)).lang;
}
