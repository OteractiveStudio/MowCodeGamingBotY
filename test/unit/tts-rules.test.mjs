/**
 * Unit: what gets spoken, and how it is chopped up. No network, no voice channel.
 *
 * ⚠️ The audio path itself (endpoint → ffmpeg → ogg/opus) is verified separately against the real
 * services, because mocking it would only prove the mock works. What IS tested here is every
 * decision made *before* a byte is fetched — which is where his version had its defects.
 */

import assert from "node:assert/strict";

import ttsCog from "../../app/cogs/tts/index.js";
import {
    TTS_RULES,
    TtsError,
    chunkText,
    fetchSpeech,
    sanitiseForSpeech,
    speechLang,
    speechUrl,
    validateSpeech,
} from "../../app/data/tts.js";

const command = ttsCog.commands[0];

/** A fetch that returns whatever a test wants, without a socket. */
function fakeFetch(body, { ok = true, status = 200, type = "audio/mpeg" } = {}) {
    return async () => ({
        ok,
        status,
        headers: { get: () => type },
        async arrayBuffer() {
            return body;
        },
    });
}

export default [
    // ── the cog's shape ──────────────────────────────────────────────────────
    {
        label: "the cog declares /tts with his four actions, plus a message listener",
        fn: () => {
            const json = command.data.toJSON();
            assert.equal(json.name, "tts");
            assert.deepEqual(
                json.options.map((o) => o.name).sort(),
                ["join", "leave", "say", "stop"],
            );
            assert.equal(ttsCog.events.length, 1, "reading the bound channel aloud is the feature");
            assert.equal(typeof ttsCog.setup, "function", "the dependency report is logged on load");
        },
    },
    {
        label: "/tts say is capped at the same length the data layer enforces",
        fn: () => {
            const say = command.data.toJSON().options.find((o) => o.name === "say");
            const text = say.options.find((o) => o.name === "text");
            assert.equal(text.required, true);
            assert.equal(text.max_length, TTS_RULES.MAX_MESSAGE_LENGTH);
        },
    },

    // ── sanitising: his msg_handler, extended ────────────────────────────────
    {
        label: "⭐ HIS RULES — mentions and links are stripped before anything is spoken",
        fn: () => {
            assert.equal(sanitiseForSpeech("hey <@123456> come here"), "hey come here");
            assert.equal(sanitiseForSpeech("look at https://example.com/thing now"), "look at now");
            assert.equal(sanitiseForSpeech("in <#987> please"), "in please");
            assert.equal(sanitiseForSpeech("role <@&555> ping"), "role ping");
        },
    },
    {
        label: "code, emoji and markdown are handled — reading punctuation aloud is meaningless",
        fn: () => {
            assert.equal(sanitiseForSpeech("run ```js\nconst x = 1;\n``` ok"), "run ok");
            assert.equal(sanitiseForSpeech("use `npm test` first"), "use first");
            // A custom emoji keeps its NAME, which is the only speakable part of it.
            assert.equal(sanitiseForSpeech("nice <:wave:12345>"), "nice wave");
            assert.equal(sanitiseForSpeech("animated <a:spin:678>"), "animated spin");
            assert.equal(sanitiseForSpeech("**bold** and _thin_ and ~~gone~~"), "bold and thin and gone");
            assert.equal(sanitiseForSpeech("at <t:1700000000:R> ok"), "at ok");
        },
    },
    {
        label: "whitespace collapses, and non-strings become empty rather than throwing",
        fn: () => {
            assert.equal(sanitiseForSpeech("  a\n\n\nb   c  "), "a b c");
            for (const input of [null, undefined, 42, {}, []]) {
                assert.equal(sanitiseForSpeech(input), "", JSON.stringify(input));
            }
        },
    },
    {
        label: "🔑 a message of ONLY links or mentions is nothing to say, not a long message",
        fn: () => {
            // Length is measured AFTER sanitising, which is why this is NOTHING_TO_SAY and not
            // TOO_LONG. Measuring the raw string would get this backwards.
            assert.equal(validateSpeech("https://a.example https://b.example")?.code, "NOTHING_TO_SAY");
            assert.equal(validateSpeech("<@1> <@2> <@3>")?.code, "NOTHING_TO_SAY");
            assert.equal(validateSpeech("```\njust code\n```")?.code, "NOTHING_TO_SAY");
            assert.equal(validateSpeech("")?.code, "NOTHING_TO_SAY");
        },
    },
    {
        label: "🔑 a long message is refused — his had NO cap on what it would read out",
        fn: () => {
            assert.equal(validateSpeech("x".repeat(TTS_RULES.MAX_MESSAGE_LENGTH + 1))?.code, "TOO_LONG");
            assert.equal(validateSpeech("x".repeat(TTS_RULES.MAX_MESSAGE_LENGTH)), null, "exactly the cap is fine");
            // Padding must not tip a legal message over.
            assert.equal(validateSpeech(`   ${"x".repeat(TTS_RULES.MAX_MESSAGE_LENGTH)}   `), null);
        },
    },

    // ── chunking ─────────────────────────────────────────────────────────────
    {
        label: "short text is one chunk, and every chunk fits the endpoint's limit",
        fn: () => {
            assert.deepEqual(chunkText("hello there"), ["hello there"]);

            const long = "word ".repeat(120).trim();
            const chunks = chunkText(long);
            assert.ok(chunks.length > 1, "should have split");
            for (const chunk of chunks) {
                assert.ok(chunk.length <= TTS_RULES.MAX_CHUNK_LENGTH, `chunk is ${chunk.length}`);
            }
            // Nothing is lost: the words all survive in order.
            assert.equal(chunks.join(" ").split(/\s+/).length, long.split(/\s+/).length);
        },
    },
    {
        label: "🔑 THAI CHUNKS — the language his TTS was hardcoded to has NO SPACES",
        fn: () => {
            // A Thai sentence is often one "word", so a space-only split would never fire and the
            // text would come back truncated by the endpoint. The hard-cut fallback is what makes
            // the language he actually used work at all.
            const thai = "สวัสดีครับทุกคนนี่คือการทดสอบระบบอ่านออกเสียงภาษาไทย".repeat(6);
            assert.ok(!thai.includes(" "), "the test input must genuinely have no spaces");

            const chunks = chunkText(thai);
            assert.ok(chunks.length > 1, "space-less text must still split");
            for (const chunk of chunks) {
                assert.ok(chunk.length <= TTS_RULES.MAX_CHUNK_LENGTH, `chunk is ${chunk.length}`);
            }
            assert.equal(chunks.join(""), thai, "nothing may be dropped");
        },
    },
    {
        label: "chunking prefers sentence ends when there is one in range",
        fn: () => {
            const text = `${"a".repeat(100)}. ${"b".repeat(150)}`;
            const chunks = chunkText(text);
            assert.ok(chunks[0].endsWith("."), `first chunk ended "${chunks[0].slice(-12)}"`);
        },
    },
    {
        label: "empty input chunks to nothing rather than one empty chunk",
        fn: () => {
            assert.deepEqual(chunkText(""), []);
            assert.deepEqual(chunkText("   "), []);
            assert.deepEqual(chunkText("<@1>"), [], "sanitises to empty, so nothing to speak");
        },
    },

    // ── language ─────────────────────────────────────────────────────────────
    {
        label: "⚠️ FIXED — the language is no longer hardcoded to Thai",
        fn: () => {
            // His get_lang() returned "th" with the per-server lookup commented out above it.
            assert.equal(speechLang("th"), "th");
            assert.equal(speechLang("en"), "en");
            assert.equal(speechLang("ja"), "ja");
            // Anything the endpoint would reject falls back rather than erroring mid-utterance.
            assert.equal(speechLang("zz"), "en");
            assert.equal(speechLang(null), "en");
            assert.equal(speechLang(undefined), "en");
        },
    },
    {
        label: "the URL carries the client gTTS used — without it the endpoint refuses",
        fn: () => {
            const url = speechUrl("hi", "th");
            assert.match(url, /client=tw-ob/);
            assert.match(url, /tl=th/);
            assert.match(url, /q=hi/);
            assert.match(url, /^https:\/\/translate\.google\.com\/translate_tts\?/);

            // Text is encoded, not interpolated raw.
            assert.match(speechUrl("a b&c=d", "en"), /q=a\+b%26c%3Dd/);
        },
    },

    // ── fetching ─────────────────────────────────────────────────────────────
    {
        label: "audio comes back as a Buffer",
        fn: async () => {
            const bytes = await fetchSpeech("hi", "en", {
                fetchImpl: fakeFetch(new Uint8Array([0xff, 0xfb, 0x00]).buffer),
            });
            assert.ok(Buffer.isBuffer(bytes));
            assert.equal(bytes.length, 3);
        },
    },
    {
        label: "🔑 HTML with a 200 is caught — this endpoint serves block pages, not errors",
        fn: async () => {
            await assert.rejects(
                () =>
                    fetchSpeech("hi", "en", {
                        fetchImpl: fakeFetch(new Uint8Array([1]).buffer, { type: "text/html" }),
                    }),
                (err) => err instanceof TtsError && err.code === "NOT_AUDIO",
            );
        },
    },
    {
        label: "every other failure is a typed error too",
        fn: async () => {
            await assert.rejects(
                () => fetchSpeech("", "en", { fetchImpl: fakeFetch(new ArrayBuffer(1)) }),
                (err) => err.code === "EMPTY",
            );
            await assert.rejects(
                () => fetchSpeech("hi", "en", { fetchImpl: fakeFetch(null, { ok: false, status: 429 }) }),
                (err) => err.code === "HTTP_ERROR",
            );
            await assert.rejects(
                () =>
                    fetchSpeech("hi", "en", {
                        fetchImpl: async () => {
                            throw new Error("ETIMEDOUT");
                        },
                    }),
                (err) => err.code === "UNREACHABLE",
            );
            await assert.rejects(
                () => fetchSpeech("hi", "en", { fetchImpl: fakeFetch(new ArrayBuffer(0)) }),
                (err) => err.code === "EMPTY_RESULT",
            );
        },
    },

    // ── the limits that make this safe to keep ───────────────────────────────
    {
        label: "🔑 the queue is CAPPED — his was not, in a feature that reads whatever anyone types",
        fn: () => {
            assert.ok(TTS_RULES.MAX_QUEUE > 0 && TTS_RULES.MAX_QUEUE <= 20,
                `a queue cap of ${TTS_RULES.MAX_QUEUE} is not a cap`);
            // A single message can never fill the queue on its own, or one person could lock it.
            const worstCase = Math.ceil(TTS_RULES.MAX_MESSAGE_LENGTH / TTS_RULES.MAX_CHUNK_LENGTH);
            assert.ok(worstCase < TTS_RULES.MAX_QUEUE,
                `one message can produce ${worstCase} chunks against a queue of ${TTS_RULES.MAX_QUEUE}`);
        },
    },
    {
        label: "the request timeout is short enough not to strand an utterance",
        fn: () => {
            assert.ok(TTS_RULES.TIMEOUT_MS > 0 && TTS_RULES.TIMEOUT_MS <= 15_000);
        },
    },
];
