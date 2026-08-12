/**
 * app/data/translate.js — the one place that talks to a translation service.
 *
 * ⭐ His `/trans` used `googletrans`, which wraps the **unofficial** endpoint that
 * `translate.google.com` itself calls. There is no free official Google Translate API, so the
 * choice is: that endpoint, a paid key, or no command. His used the endpoint, so this does too —
 * but with the fragility stated instead of assumed.
 *
 * ⚠️ **THIS IS THE ONLY NETWORK CALL IN THE BOT**, and it happens **only when a user explicitly
 * asks for a translation**. That distinction is the whole reason i18n is a catalogue and this is
 * not: see `lib/i18n.js`. A translation the user requested is worth a round trip; translating
 * every string the bot says is not.
 *
 * ⚠️ Guarded the way an unofficial third-party endpoint has to be:
 *   · a hard **timeout** via AbortSignal, so a hanging request cannot eat the interaction window;
 *   · a **response-shape check**, because an unofficial endpoint can start returning HTML;
 *   · **no dependency** — `fetch` is built into Node 24, so this adds nothing to install;
 *   · switchable off entirely with `translate.enabled: false` in config.
 */

/** Matches his 4000-ish practical limit; the endpoint degrades badly past a few thousand. */
export const TRANSLATE_RULES = {
    MAX_LENGTH: 1000,
    TIMEOUT_MS: 6000,
    ENDPOINT: "https://translate.googleapis.com/translate_a/single",
};

export class TranslateError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "TranslateError";
        this.code = code;
    }
}

/** Is translation switched on for this install? Defaults to ON, as his was. */
export function translateEnabled(config) {
    return config?.translate?.enabled !== false;
}

/**
 * Translate `text` into `to`, detecting the source.
 *
 * @returns {Promise<{text: string, detected: string}>}
 */
export async function translate(text, to = "en", { fetchImpl = fetch } = {}) {
    const trimmed = String(text ?? "").trim();

    if (trimmed.length === 0) throw new TranslateError("EMPTY", "nothing to translate");
    if (trimmed.length > TRANSLATE_RULES.MAX_LENGTH) {
        throw new TranslateError("TOO_LONG", `${trimmed.length} characters is over the limit`);
    }

    const url =
        `${TRANSLATE_RULES.ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(to)}` +
        `&dt=t&q=${encodeURIComponent(trimmed)}`;

    let response;
    try {
        response = await fetchImpl(url, {
            // ⚠️ Without a browser-ish User-Agent this endpoint sometimes answers with a block
            // page rather than JSON. That is exactly the fragility being documented.
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(TRANSLATE_RULES.TIMEOUT_MS),
        });
    } catch (err) {
        throw new TranslateError("UNREACHABLE", `the endpoint did not answer: ${err.message}`);
    }

    if (!response.ok) {
        throw new TranslateError("HTTP_ERROR", `the endpoint answered ${response.status}`);
    }

    let body;
    try {
        body = await response.json();
    } catch {
        throw new TranslateError("BAD_SHAPE", "the endpoint did not return JSON");
    }

    // The shape is a nested array: [[[chunk, original, …], …], …, detectedLang, …]. Undocumented,
    // so every level is checked rather than indexed hopefully.
    if (!Array.isArray(body) || !Array.isArray(body[0])) {
        throw new TranslateError("BAD_SHAPE", "the endpoint returned an unexpected shape");
    }

    const translated = body[0]
        .map((chunk) => (Array.isArray(chunk) ? chunk[0] : null))
        .filter((chunk) => typeof chunk === "string")
        .join("");

    if (translated.length === 0) {
        throw new TranslateError("EMPTY_RESULT", "the endpoint returned nothing usable");
    }

    return {
        text: translated,
        detected: typeof body[2] === "string" ? body[2] : "unknown",
    };
}
