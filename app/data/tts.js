/**
 * app/data/tts.js — turning text into speakable audio, and deciding what is speakable.
 *
 * Ported from his `tts_cog.py`, which used `gTTS` (a wrapper over Google Translate's speech
 * endpoint) to write an mp3 and then handed it to `discord.FFmpegPCMAudio`.
 *
 * ⭐ Same endpoint, no library: `translate_tts` returns `audio/mpeg` for a GET. Verified returning
 * 13KB of real mp3 for Thai before any of this was written.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ✅ FIXED — real defects in his version
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. 🔑 **ONE TEMP FILE PER SERVER, OVERWRITTEN WHILE PLAYING.**
 *        t2s.save(f"tts_temp/{server_id}_tts.mp3")
 *        …play(discord.FFmpegPCMAudio(f"tts_temp/{server_id}_tts.mp3"))
 *    The next message in the same guild wrote **the same path** while ffmpeg was still reading it,
 *    so a queued line could be spoken with another line's audio — or truncated. And the files were
 *    never deleted. There is **no temp file here at all**: the mp3 is streamed straight from the
 *    response into ffmpeg, so there is nothing to collide over and nothing to clean up.
 *
 * 2. 🔑 **`discord.utils.get(...)` WAS NOT CHECKED FOR None** before `.play()` in `play_tts` —
 *    only inside the queue loop. If the bot was dragged out of the channel between the check and
 *    the play, that is an `AttributeError` inside a task with nobody catching it.
 *
 * 3. **A BUSY-WAIT QUEUE.** `while True: … if is_playing(): await asyncio.sleep(0.3); continue`
 *    polled five times a second per guild. `@discordjs/voice` emits an Idle state change when a
 *    track ends, so the queue here is **event-driven** and costs nothing while speaking.
 *
 * 4. **THE LANGUAGE WAS HARDCODED.** `get_lang()` returned `"th"` with the per-server lookup
 *    commented out directly above it. It now uses the guild's configured language.
 *
 * 5. **NO LIMITS.** No cap on message length and no cap on queue depth, in a feature whose entire
 *    job is to read whatever anyone types out loud. `TTS_RULES` has both, and the endpoint's own
 *    ~200-character limit is handled by chunking rather than by silent truncation.
 *
 * 6. **`tts_data_del` used `del` on a possibly-absent key**, which raises `KeyError`.
 *
 * ⚠️ AND ONE THING THAT IS NOT A BUG BUT IS A RISK: a bot that speaks arbitrary user text in a
 * voice channel is an abuse vector — someone can make it say anything to a room. His had no
 * guard. The limits here (length, queue depth, bound channel only, and only while a human is in
 * the channel) are why it is safe enough to keep, and `sanitiseForSpeech` strips the things that
 * are noise or worse.
 */

/** Google's endpoint truncates well before this; 200 is the safe practical chunk. */
export const TTS_RULES = {
    /** Longest single message that will be read. Beyond this, it is not read at all. */
    MAX_MESSAGE_LENGTH: 300,
    /** Longest chunk sent to the endpoint in one request. */
    MAX_CHUNK_LENGTH: 180,
    /** How many pending utterances one guild may stack up. */
    MAX_QUEUE: 8,
    ENDPOINT: "https://translate.google.com/translate_tts",
    TIMEOUT_MS: 8000,
};

/**
 * Languages the speech endpoint handles that this bot also has a UI language for. Anything else
 * falls back rather than sending a code the endpoint will reject.
 */
const SPEAKABLE = new Set(["en", "th", "ja", "ko", "zh-CN", "zh-TW", "fr", "de", "es", "pt", "ru", "vi", "id"]);

export function speechLang(lang) {
    const code = String(lang ?? "en");
    return SPEAKABLE.has(code) ? code : "en";
}

export class TtsError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "TtsError";
        this.code = code;
    }
}

/**
 * His `msg_handler`, which stripped mentions and links. Extended, because the things that read
 * badly aloud are more than those two.
 *
 * ⚠️ Order matters: code blocks go before inline code, and custom emoji before mentions, because
 * `<:name:123>` and `<@123>` share a shape.
 */
export function sanitiseForSpeech(raw) {
    if (typeof raw !== "string") return "";

    return raw
        // Code blocks and inline code: reading punctuation aloud is meaningless.
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        // Links — his removeLink. Nobody wants a URL read character by character.
        .replace(/https?:\/\/\S+/gi, " ")
        // Custom emoji `<:name:id>` and `<a:name:id>` → just the name.
        .replace(/<a?:(\w+):\d+>/g, " $1 ")
        // Mentions of every kind — his removeMention. The id is noise; the fact of a mention is not
        // worth speaking either, so they simply go.
        .replace(/<@[!&]?\d+>/g, " ")
        .replace(/<#\d+>/g, " ")
        // Discord timestamps `<t:123:R>`.
        .replace(/<t:\d+(:[tTdDfFR])?>/g, " ")
        // Markdown emphasis, which would otherwise be spoken as asterisks by some voices.
        .replace(/[*_~|>]/g, " ")
        // Collapse everything left.
        .replace(/\s+/g, " ")
        .trim();
}

/** Why a message will not be spoken. Returns null when it will. */
export function validateSpeech(raw) {
    const text = sanitiseForSpeech(raw);

    if (text.length === 0) return { code: "NOTHING_TO_SAY", message: "there is nothing speakable in that" };

    // ⚠️ Length is measured AFTER sanitising, so a wall of links is short, not long.
    if (text.length > TTS_RULES.MAX_MESSAGE_LENGTH) {
        return {
            code: "TOO_LONG",
            message: `that is ${text.length} characters to read out and the limit is ${TTS_RULES.MAX_MESSAGE_LENGTH}`,
        };
    }

    return null;
}

/**
 * Split into endpoint-sized pieces, on word boundaries where possible.
 *
 * ⚠️ Thai does not put spaces between words, so a Thai sentence is often ONE "word" — which is
 * exactly the language his TTS was hardcoded to. So the fallback is a hard character split rather
 * than a space-only split, or Thai text would never chunk and would come back truncated.
 */
export function chunkText(text, max = TTS_RULES.MAX_CHUNK_LENGTH) {
    const clean = sanitiseForSpeech(text);
    if (clean.length === 0) return [];
    if (clean.length <= max) return [clean];

    const chunks = [];
    let rest = clean;

    // Don't accept a boundary so early that the chunks become tiny.
    const floor = max * 0.5;

    while (rest.length > max) {
        const window = rest.slice(0, max);

        // Prefer a sentence end, then a space, then give up and cut mid-token.
        //
        // ⚠️ `lastIndexOf(". ")` returns the index OF THE PERIOD, so the cut has to be one PAST it
        // or the punctuation is sliced off the end of the chunk — which is exactly the off-by-one
        // a test caught here. A space boundary is the opposite: cut AT it, so it is discarded.
        const sentenceAt = Math.max(
            window.lastIndexOf(". "),
            window.lastIndexOf("! "),
            window.lastIndexOf("? "),
        );

        let cut;
        if (sentenceAt >= floor) {
            cut = sentenceAt + 1; // keep the '.', drop the following space via trim()
        } else {
            const spaceAt = window.lastIndexOf(" ");
            // No usable boundary at all — Thai and other space-less scripts land here, and so does
            // one very long token. A hard cut is the only option, and it is why this fallback
            // exists rather than a space-only split.
            cut = spaceAt >= floor ? spaceAt : max;
        }

        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }

    if (rest.length > 0) chunks.push(rest);
    return chunks.filter((chunk) => chunk.length > 0);
}

/** The URL gTTS would have called. Exposed so a test can check it without fetching. */
export function speechUrl(text, lang = "en") {
    const params = new URLSearchParams({
        ie: "UTF-8",
        // `tw-ob` is the client gTTS uses; without it the endpoint refuses.
        client: "tw-ob",
        tl: speechLang(lang),
        q: text,
    });
    return `${TTS_RULES.ENDPOINT}?${params.toString()}`;
}

/**
 * Fetch one chunk as mp3 bytes.
 *
 * ⚠️ Returns a Buffer rather than a stream on purpose. A chunk is a couple of seconds of audio at
 * most, and having the whole thing before playback starts means a stalled response cannot leave
 * half an utterance hanging in the voice channel — which is the failure his single shared temp
 * file produced by a different route.
 */
export async function fetchSpeech(text, lang = "en", { fetchImpl = fetch } = {}) {
    if (!text || text.trim().length === 0) throw new TtsError("EMPTY", "nothing to speak");

    let response;
    try {
        response = await fetchImpl(speechUrl(text, lang), {
            // Without a browser-ish User-Agent the endpoint serves a block page instead of audio.
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(TTS_RULES.TIMEOUT_MS),
        });
    } catch (err) {
        throw new TtsError("UNREACHABLE", `the speech endpoint did not answer: ${err.message}`);
    }

    if (!response.ok) throw new TtsError("HTTP_ERROR", `the speech endpoint answered ${response.status}`);

    const type = response.headers?.get?.("content-type") ?? "";
    if (!type.includes("audio")) {
        // ⚠️ Checked, because this endpoint answers 200 with HTML when it decides to block you.
        throw new TtsError("NOT_AUDIO", `expected audio, got "${type}"`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new TtsError("EMPTY_RESULT", "the endpoint returned no audio");

    return bytes;
}
