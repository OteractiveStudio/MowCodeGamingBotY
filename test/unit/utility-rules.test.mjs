/**
 * Unit: /help, /rand, /trans and the prefix redirect.
 *
 * `/trans` is tested with an INJECTED fetch, so the suite never touches the network. The endpoint
 * it wraps is unofficial and will break one day; these checks are about how this code behaves
 * when it does.
 */

import assert from "node:assert/strict";

import utilityCog from "../../app/cogs/utility/index.js";
import {
    TRANSLATE_RULES,
    TranslateError,
    translate,
    translateEnabled,
} from "../../app/data/translate.js";

const [helpCommand, randCommand, transCommand] = utilityCog.commands;

/** A fetch that returns whatever shape a test wants, without a socket. */
function fakeFetch(payload, { ok = true, status = 200, json = true } = {}) {
    return async () => ({
        ok,
        status,
        async json() {
            if (!json) throw new Error("not json");
            return payload;
        },
    });
}

export default [
    // ── the cog's shape ──────────────────────────────────────────────────────
    {
        label: "the cog declares /help, /rand and /trans, plus one message listener",
        fn: () => {
            assert.deepEqual(
                utilityCog.commands.map((c) => c.data.toJSON().name),
                ["help", "rand", "trans"],
            );
            assert.equal(utilityCog.events.length, 1, "the prefix redirect is the only listener");
            assert.equal(typeof utilityCog.events[0].handle, "function");
        },
    },
    {
        label: "/help offers autocomplete over command names",
        fn: () => {
            assert.equal(typeof helpCommand.autocomplete, "function");
            const json = helpCommand.data.toJSON();
            assert.equal(json.options[0].name, "name");
            assert.equal(json.options[0].autocomplete, true);
            assert.equal(json.options[0].required, false, "/help with no argument must work");
        },
    },
    {
        label: "/rand takes two OPTIONAL bounds — his defaults were 10 and 1",
        fn: () => {
            const json = randCommand.data.toJSON();
            assert.deepEqual(json.options.map((o) => o.name), ["a", "b"]);
            assert.ok(json.options.every((o) => !o.required), "both bounds default");
        },
    },
    {
        label: "/trans caps its input at the same length the data layer enforces",
        fn: () => {
            const json = transCommand.data.toJSON();
            const text = json.options.find((o) => o.name === "text");
            assert.equal(text.required, true);
            assert.equal(text.max_length, TRANSLATE_RULES.MAX_LENGTH);
        },
    },

    // ── translate: the happy path ────────────────────────────────────────────
    {
        label: "a normal response is joined from its chunks and reports the detected language",
        fn: async () => {
            // The real shape: [[[chunk, original, …], …], null, "th", …]
            const result = await translate("สวัสดี", "en", {
                fetchImpl: fakeFetch([[["Hello", "สวัสดี"], [" there", " ที่นั่น"]], null, "th"]),
            });
            assert.equal(result.text, "Hello there");
            assert.equal(result.detected, "th");
        },
    },
    {
        label: "a missing detected language degrades to 'unknown' rather than undefined",
        fn: async () => {
            const result = await translate("hi", "th", { fetchImpl: fakeFetch([[["สวัสดี", "hi"]]]) });
            assert.equal(result.text, "สวัสดี");
            assert.equal(result.detected, "unknown");
        },
    },

    // ── translate: every way it can fail ─────────────────────────────────────
    {
        label: "empty and over-long input are refused BEFORE any request is made",
        fn: async () => {
            let called = false;
            const spy = async () => {
                called = true;
                throw new Error("should not have been called");
            };

            await assert.rejects(() => translate("", "en", { fetchImpl: spy }), /nothing to translate/);
            await assert.rejects(() => translate("   ", "en", { fetchImpl: spy }), /nothing to translate/);
            await assert.rejects(
                () => translate("x".repeat(TRANSLATE_RULES.MAX_LENGTH + 1), "en", { fetchImpl: spy }),
                /over the limit/,
            );
            assert.equal(called, false, "no network call should have been attempted");
        },
    },
    {
        label: "🔑 an unreachable endpoint becomes a typed error, not a raw fetch failure",
        fn: async () => {
            const boom = async () => {
                throw new Error("ETIMEDOUT");
            };
            await assert.rejects(
                () => translate("hello", "th", { fetchImpl: boom }),
                (err) => err instanceof TranslateError && err.code === "UNREACHABLE",
            );
        },
    },
    {
        label: "an HTTP error code is reported as one",
        fn: async () => {
            await assert.rejects(
                () => translate("hello", "th", { fetchImpl: fakeFetch(null, { ok: false, status: 429 }) }),
                (err) => err.code === "HTTP_ERROR" && /429/.test(err.message),
            );
        },
    },
    {
        label: "🔑 HTML instead of JSON is caught — this endpoint really does serve block pages",
        fn: async () => {
            await assert.rejects(
                () => translate("hello", "th", { fetchImpl: fakeFetch(null, { json: false }) }),
                (err) => err.code === "BAD_SHAPE",
            );
        },
    },
    {
        label: "🔑 an unexpected JSON shape is caught rather than indexed hopefully",
        fn: async () => {
            // Every level is checked, because the shape is undocumented and can change.
            for (const payload of [null, {}, "text", [], [null], [{}], [123]]) {
                await assert.rejects(
                    () => translate("hello", "th", { fetchImpl: fakeFetch(payload) }),
                    (err) => err instanceof TranslateError,
                    `payload ${JSON.stringify(payload)} should have been refused`,
                );
            }
        },
    },
    {
        label: "chunks that are not strings are skipped, and an all-empty result errors",
        fn: async () => {
            const mixed = await translate("hi", "th", {
                fetchImpl: fakeFetch([[["a", "x"], [null, "y"], ["b", "z"]]]),
            });
            assert.equal(mixed.text, "ab");

            await assert.rejects(
                () => translate("hi", "th", { fetchImpl: fakeFetch([[[null], [undefined]]]) }),
                (err) => err.code === "EMPTY_RESULT",
            );
        },
    },
    {
        label: "translation defaults ON but can be switched off in config",
        fn: () => {
            assert.equal(translateEnabled({}), true, "his was always on");
            assert.equal(translateEnabled({ translate: {} }), true);
            assert.equal(translateEnabled({ translate: { enabled: false } }), false);
            assert.equal(translateEnabled(null), true);
        },
    },

    // ── the prefix redirect ──────────────────────────────────────────────────
    {
        label: "🔑 the redirect ignores anything starting with a letter, digit or space",
        fn: async () => {
            // The cheapest early exit, and the one that keeps this listener free on a busy
            // channel — TRAPS #11. A locale lookup that throws proves it was never reached.
            const ctx = {
                config: {},
                get db() {
                    throw new Error("the redirect looked up the guild for a plain message");
                },
                async log() {},
                commands: new Map([["fishing", {}]]),
            };

            for (const content of ["hello", "fishing", "42 things", "  spaced", ""]) {
                let replied = false;
                await utilityCog.events[0].handle(
                    {
                        author: { bot: false, id: "1" },
                        guildId: "g",
                        content,
                        async reply() {
                            replied = true;
                        },
                    },
                    ctx,
                );
                assert.equal(replied, false, `"${content}" should have been ignored`);
            }
        },
    },
    {
        label: "bots and DMs are ignored before anything else",
        fn: async () => {
            const ctx = {
                get db() {
                    throw new Error("should not have been reached");
                },
                async log() {},
            };

            let replied = false;
            const reply = async () => {
                replied = true;
            };

            await utilityCog.events[0].handle(
                { author: { bot: true, id: "1" }, guildId: "g", content: "+fishing", reply },
                ctx,
            );
            await utilityCog.events[0].handle(
                { author: { bot: false, id: "1" }, guildId: null, content: "+fishing", reply },
                ctx,
            );
            assert.equal(replied, false);
        },
    },
];
