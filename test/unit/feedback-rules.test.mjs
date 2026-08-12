/**
 * Unit: feedback validation and tidying. No database.
 *
 * The bounds are declared in THREE places — the SQL CHECK, the slash command's
 * setMinLength/setMaxLength, and `FEEDBACK_RULES` — so these tests exist mostly to keep those
 * three honest with each other. A user who is silently rejected by a constraint learns nothing.
 */

import assert from "node:assert/strict";

import feedbackCog from "../../app/cogs/feedback/index.js";
import {
    FEEDBACK_RULES,
    FEEDBACK_STATUS,
    normaliseMessage,
    validateMessage,
} from "../../app/data/feedback.js";

const command = feedbackCog.commands[0];

export default [
    {
        label: "the command is /feedback with a required msg option, as Ote asked",
        fn: () => {
            const json = command.data.toJSON();
            assert.equal(json.name, "feedback");

            const msg = json.options.find((o) => o.name === "msg");
            assert.ok(msg, "there must be a msg option");
            assert.equal(msg.required, true);
        },
    },
    {
        label: "🔑 the command's length bounds MATCH FEEDBACK_RULES, so Discord rejects early",
        fn: () => {
            // Three declarations of the same rule: here, in the SQL CHECK, and in the builder.
            // If they drift, a user gets a constraint violation instead of an explanation.
            const msg = command.data.toJSON().options.find((o) => o.name === "msg");
            assert.equal(msg.min_length, FEEDBACK_RULES.MIN_LENGTH);
            assert.equal(msg.max_length, FEEDBACK_RULES.MAX_LENGTH);
        },
    },
    {
        label: "🔑 it defers EPHEMERALLY — feedback must not be republished into the channel",
        fn: () => {
            // TRAPS #14: passing `flags: Ephemeral` to respond() is silently dropped, because
            // dispatch defers publicly first and editReply cannot change it afterwards. This is
            // the only mechanism that works, and here it matters more than anywhere: the reply
            // quotes the message back, so a public one would republish what someone sent privately.
            assert.equal(command.defer, "ephemeral");
        },
    },
    {
        label: "it is NOT admin-gated — players are the point",
        fn: () => {
            // A guard against someone "tidying" this into the admin cog later.
            const source = String(command.execute);
            assert.ok(!/isBotAdmin/.test(source), "/feedback must not be gated to admins");
        },
    },

    // ── tidying ──────────────────────────────────────────────────────────────
    {
        label: "surrounding whitespace goes, and CRLF becomes LF",
        fn: () => {
            assert.equal(normaliseMessage("  hello  "), "hello");
            assert.equal(normaliseMessage("a\r\nb"), "a\nb");
            assert.equal(normaliseMessage("a\rb"), "a\nb");
        },
    },
    {
        label: "🔑 runs of blank lines collapse — a wall of newlines is not a message",
        fn: () => {
            // It would otherwise pass the SQL length CHECK on btrim() while rendering as an embed
            // full of nothing. "Valid in SQL" is not the same as "displayable".
            assert.equal(normaliseMessage("a\n\n\n\n\nb"), "a\n\nb");
            assert.equal(normaliseMessage("top\n\n\n\n\n\n\n\n\n\nbottom"), "top\n\nbottom");
            // Two newlines are a deliberate paragraph break and survive.
            assert.equal(normaliseMessage("a\n\nb"), "a\n\nb");
        },
    },
    {
        label: "trailing spaces on each line go, but the line breaks stay",
        fn: () => {
            assert.equal(normaliseMessage("a   \nb\t\nc"), "a\nb\nc");
        },
    },
    {
        label: "non-strings normalise to empty rather than throwing",
        fn: () => {
            for (const input of [null, undefined, 42, {}, []]) {
                assert.equal(normaliseMessage(input), "", JSON.stringify(input));
            }
        },
    },

    // ── validation ───────────────────────────────────────────────────────────
    {
        label: "a real message is accepted",
        fn: () => {
            assert.equal(validateMessage("the dice payout feels wrong on a called face"), null);
            assert.equal(validateMessage("bug"), null, "exactly the minimum length");
        },
    },
    {
        label: "empty, whitespace-only and too-short are each refused with their own code",
        fn: () => {
            assert.equal(validateMessage("")?.code, "EMPTY");
            assert.equal(validateMessage("   \n\n  ")?.code, "EMPTY");
            assert.equal(validateMessage(null)?.code, "EMPTY");
            assert.equal(validateMessage("ab")?.code, "TOO_SHORT");
        },
    },
    {
        label: "🔑 the length is measured AFTER tidying, not before",
        fn: () => {
            // "  a  " is 5 raw characters and 1 real one. Measuring the raw string would let a
            // message of pure padding through and then fail the SQL CHECK, which trims.
            assert.equal(validateMessage("  a  ")?.code, "TOO_SHORT");
            assert.equal(validateMessage(`  ${"x".repeat(FEEDBACK_RULES.MAX_LENGTH)}  `), null,
                "padding must not push a legal message over the limit");
        },
    },
    {
        label: "over the limit is refused, and the message says by how much",
        fn: () => {
            const problem = validateMessage("x".repeat(FEEDBACK_RULES.MAX_LENGTH + 1));
            assert.equal(problem?.code, "TOO_LONG");
            assert.match(problem.message, new RegExp(String(FEEDBACK_RULES.MAX_LENGTH + 1)));
            assert.match(problem.message, new RegExp(String(FEEDBACK_RULES.MAX_LENGTH)));

            // Exactly the limit is fine — an off-by-one here would reject a legal message.
            assert.equal(validateMessage("x".repeat(FEEDBACK_RULES.MAX_LENGTH)), null);
        },
    },
    {
        label: "the statuses are the four the SQL CHECK allows",
        fn: () => {
            assert.deepEqual(Object.values(FEEDBACK_STATUS).sort(), [
                "actioned", "declined", "new", "read",
            ]);
        },
    },
    {
        label: "the rate limit is a real window, not a per-restart counter",
        fn: () => {
            assert.ok(FEEDBACK_RULES.MAX_PER_WINDOW > 0);
            assert.ok(FEEDBACK_RULES.WINDOW_MS >= 60_000, "a window under a minute is not a limit");
        },
    },
];
