/**
 * Unit: wordle's scoring, keyboard and sessions.
 *
 * The scoring tests matter most, because duplicate-letter handling is what almost every
 * homemade wordle gets wrong — and it is the part **his version got right**, so these exist to
 * stop a later "simplification" breaking it.
 */

import assert from "node:assert/strict";

import {
    MARK,
    OUTCOME,
    KEYBOARD_ROWS,
    WORDLE_RULES,
    WordleSessions,
    emptyKeyboard,
    scoreGuess,
    updateKeyboard,
    validateGuess,
} from "../../app/data/wordle.js";
import { WORDLE_WORDS } from "../../database/seeds/wordle_words.js";

/** Compact notation so an expectation reads like a board row: "GNM" = hit, near, miss. */
const marks = (s) =>
    [...s].map((c) => ({ G: MARK.HIT, N: MARK.NEAR, M: MARK.MISS })[c]);

export default [
    // ── scoring ──────────────────────────────────────────────────────────────
    {
        label: "an exact guess is all green",
        fn: () => {
            assert.deepEqual(scoreGuess("crane", "crane"), marks("GGGGG"));
        },
    },
    {
        label: "a guess sharing nothing is all red",
        fn: () => {
            assert.deepEqual(scoreGuess("mommy", "grief"), marks("MMMMM"));
        },
    },
    {
        label: "right letter, wrong place is yellow",
        fn: () => {
            //  t r a i n  vs  a b o u t
            //  t -> in the word, elsewhere; a -> in the word, elsewhere
            assert.deepEqual(scoreGuess("train", "about"), marks("NMNMM"));
        },
    },
    {
        label: "🔑 DOUBLE LETTERS — a guess with two of a letter the target has once gets ONE mark",
        fn: () => {
            // "geese" vs "eagle": the target has two e's, so two of the guess's three e's mark.
            const result = scoreGuess("geese", "eagle");
            const greens = result.filter((m) => m === MARK.HIT).length;
            const yellows = result.filter((m) => m === MARK.NEAR).length;
            assert.equal(greens + yellows, 3, `expected 3 marked, got ${greens} green + ${yellows} yellow`);

            // The clearer case: one target 'l', two guessed 'l's — exactly one may mark.
            const single = scoreGuess("lolly", "lemon");
            const marked = single.filter((m) => m !== MARK.MISS).length;
            const lPositions = [0, 2, 3];
            const markedLs = lPositions.filter((i) => single[i] !== MARK.MISS).length;
            assert.equal(markedLs, 1, "only one of the three L's may mark against a single-L target");
            assert.ok(marked >= 1);
        },
    },
    {
        label: "🔑 a GREEN consumes its target letter, so a duplicate elsewhere goes red",
        fn: () => {
            // target "abide" has one 'a', at index 0. Guess "aroma" has 'a' at 0 and 4.
            const result = scoreGuess("aroma", "abide");
            assert.equal(result[0], MARK.HIT, "the positional a is green");
            assert.equal(result[4], MARK.MISS, "the second a must NOT be yellow — the only a is used");
        },
    },
    {
        label: "greens are found before yellows, whatever the order in the word",
        fn: () => {
            // target "sassy": three s's. Guess "asses".
            const result = scoreGuess("asses", "sassy");
            const markedCount = result.filter((m) => m !== MARK.MISS).length;
            // Guess has s at 1,2,4 and target has s at 0,2,3 — three s's available, three marked,
            // plus the shared 'e'? target has no e, so exactly the s's and the a.
            assert.ok(markedCount >= 3, `expected at least the three s's marked, got ${markedCount}`);
            assert.equal(result[2], MARK.HIT, "position 2 is s in both");
        },
    },
    {
        label: "scoring works at every length his range allows, 4 to 6",
        fn: () => {
            assert.deepEqual(scoreGuess("cold", "cold"), marks("GGGG"));
            assert.deepEqual(scoreGuess("stone", "stone"), marks("GGGGG"));
            assert.deepEqual(scoreGuess("silver", "silver"), marks("GGGGGG"));
        },
    },
    {
        label: "scoring a mismatched length THROWS rather than indexing off the end",
        fn: () => {
            // His version carried on with a short guess and raised IndexError deep inside.
            assert.throws(() => scoreGuess("ab", "abcd"), /equal lengths/);
            assert.throws(() => scoreGuess("abcde", "abcd"), /equal lengths/);
        },
    },
    {
        label: "every position gets exactly one mark, always",
        fn: () => {
            const words = ["cold", "stone", "silver", "eagle", "sassy", "abide"];
            for (const target of words) {
                for (const guess of words) {
                    if (guess.length !== target.length) continue;
                    const result = scoreGuess(guess, target);
                    assert.equal(result.length, guess.length);
                    for (const mark of result) {
                        assert.ok(
                            [MARK.HIT, MARK.NEAR, MARK.MISS].includes(mark),
                            `unexpected mark ${mark} for ${guess}/${target}`,
                        );
                    }
                }
            }
        },
    },

    // ── the keyboard tracker ─────────────────────────────────────────────────
    {
        label: "⭐ HIS KEYBOARD — two rows, a-m and n-z, 26 letters, all blank to start",
        fn: () => {
            assert.equal(KEYBOARD_ROWS.length, 2);
            assert.equal(KEYBOARD_ROWS[0].length, 13);
            assert.equal(KEYBOARD_ROWS[1].length, 13);
            assert.equal(KEYBOARD_ROWS[0][0], "a");
            assert.equal(KEYBOARD_ROWS[0][12], "m");
            assert.equal(KEYBOARD_ROWS[1][0], "n");
            assert.equal(KEYBOARD_ROWS[1][12], "z");

            const keyboard = emptyKeyboard();
            assert.equal(Object.keys(keyboard).length, 26);
            assert.ok(Object.values(keyboard).every((m) => m === MARK.BLANK));
        },
    },
    {
        label: "🔑 the best-known state wins — green never degrades to yellow or red",
        fn: () => {
            let keyboard = emptyKeyboard();

            // 'a' green from the first guess.
            keyboard = updateKeyboard(keyboard, "abcd", marks("GMMM"));
            assert.equal(keyboard.a, MARK.HIT);

            // A later guess where 'a' happens to score yellow must NOT downgrade it.
            keyboard = updateKeyboard(keyboard, "bcda", marks("MMMN"));
            assert.equal(keyboard.a, MARK.HIT, "green must survive a later yellow");

            // Red must not overwrite yellow either.
            keyboard = updateKeyboard(keyboard, "exyz", marks("NMMM"));
            assert.equal(keyboard.e, MARK.NEAR);
            keyboard = updateKeyboard(keyboard, "eqrs", marks("MMMM"));
            assert.equal(keyboard.e, MARK.NEAR, "yellow must survive a later red");
        },
    },
    {
        label: "a red letter can be upgraded later — it only means 'not seen yet' was wrong",
        fn: () => {
            let keyboard = updateKeyboard(emptyKeyboard(), "zzzz", marks("MMMM"));
            assert.equal(keyboard.z, MARK.MISS);
            keyboard = updateKeyboard(keyboard, "zabc", marks("GMMM"));
            assert.equal(keyboard.z, MARK.HIT, "red is not final");
        },
    },
    {
        label: "letters never guessed stay blank",
        fn: () => {
            const keyboard = updateKeyboard(emptyKeyboard(), "abcd", marks("GNMM"));
            assert.equal(keyboard.q, MARK.BLANK);
            assert.equal(keyboard.z, MARK.BLANK);
        },
    },

    // ── validating a guess ───────────────────────────────────────────────────
    {
        label: "⭐ HIS RULE — a guess does NOT have to be a real word",
        fn: () => {
            // His own prompt: "Enter your guess word (could be meaningless)".
            assert.equal(validateGuess("xxxxx", "crane"), null);
            assert.equal(validateGuess("qwert", "crane"), null);
        },
    },
    {
        label: "⭐ HIS RULE — the wrong length is rejected, and by a code the caller can act on",
        fn: () => {
            assert.equal(validateGuess("cat", "crane")?.code, "TOO_SHORT");
            assert.equal(validateGuess("cranes", "crane")?.code, "TOO_LONG");
            // The expected length comes back so the message can name it.
            assert.equal(validateGuess("cat", "crane")?.expected, 5);
        },
    },
    {
        label: "case and whitespace do not matter; non-letters are refused",
        fn: () => {
            assert.equal(validateGuess("CRANE", "crane"), null);
            assert.equal(validateGuess("  crane  ", "crane"), null);
            assert.equal(validateGuess("cr4ne", "crane")?.code, "NOT_LETTERS");
            assert.equal(validateGuess("cr-ne", "crane")?.code, "NOT_LETTERS");
            assert.equal(validateGuess("", "crane")?.code, "NOT_LETTERS");
            assert.equal(validateGuess(null, "crane")?.code, "BAD_GUESS");
            // Thai letters are letters to Python's isalpha(), which is how his filter let them in.
            assert.equal(validateGuess("สวัสดี", "crane")?.code, "NOT_LETTERS");
        },
    },

    // ── sessions ─────────────────────────────────────────────────────────────
    {
        label: "🔑 FIXED — the six board rows are INDEPENDENT, not six aliases of one array",
        fn: () => {
            // His: `for i in range(6): ls.append(temp_ls)` — the same list object six times, so
            // writing one row wrote all of them.
            const sessions = new WordleSessions();
            const game = sessions.start({ channelId: "c", guildId: "g", starterId: "p", target: "crane" });

            sessions.record("c", "p", "adieu");
            sessions.record("c", "p", "stone");

            assert.equal(game.rows.length, 2);
            assert.notEqual(game.rows[0], game.rows[1]);
            assert.notEqual(game.rows[0].marks, game.rows[1].marks);
            assert.equal(game.rows[0].guess, "adieu");
            assert.equal(game.rows[1].guess, "stone");
            sessions.end("c");
        },
    },
    {
        label: "🔑 FIXED — one game PER CHANNEL, not one bot-wide",
        fn: () => {
            const sessions = new WordleSessions();
            sessions.start({ channelId: "c1", guildId: "g", starterId: "p1", target: "crane" });
            sessions.start({ channelId: "c2", guildId: "g", starterId: "p2", target: "stone" });

            assert.equal(sessions.size, 2);
            assert.equal(sessions.get("c1").target, "crane");
            assert.equal(sessions.get("c2").target, "stone");

            // Guessing in one channel does not touch the other.
            sessions.record("c1", "p1", "crane");
            assert.equal(sessions.get("c1").finished, true);
            assert.equal(sessions.get("c2").finished, false);
            assert.equal(sessions.get("c2").rows.length, 0);

            assert.throws(
                () => sessions.start({ channelId: "c1", guildId: "g", starterId: "p3", target: "abide" }),
                /already running/,
            );
            sessions.end("c1");
            sessions.end("c2");
        },
    },
    {
        label: "solving ends the game and names the attempt",
        fn: () => {
            const sessions = new WordleSessions();
            sessions.start({ channelId: "c", guildId: "g", starterId: "p", target: "crane" });
            sessions.record("c", "p", "stone");
            const result = sessions.record("c", "p", "crane");

            assert.equal(result.solved, true);
            assert.equal(result.attempt, 2);
            assert.equal(result.game.finished, true);
            assert.equal(result.game.outcome, OUTCOME.SOLVED);
            sessions.end("c");
        },
    },
    {
        label: "six wrong guesses exhausts it, and a seventh is refused",
        fn: () => {
            const sessions = new WordleSessions();
            sessions.start({ channelId: "c", guildId: "g", starterId: "p", target: "crane" });

            let last = null;
            for (let i = 0; i < WORDLE_RULES.MAX_ATTEMPTS; i += 1) {
                last = sessions.record("c", "p", "stone");
            }
            assert.equal(last.exhausted, true);
            assert.equal(last.attemptsLeft, 0);
            assert.equal(last.game.outcome, OUTCOME.EXHAUSTED);

            // A finished game accepts nothing more.
            assert.equal(sessions.record("c", "p", "abide"), null);
            sessions.end("c");
        },
    },
    {
        label: "the keyboard accumulates across guesses within a game",
        fn: () => {
            const sessions = new WordleSessions();
            const game = sessions.start({ channelId: "c", guildId: "g", starterId: "p", target: "crane" });

            // "stone" vs "crane": n and e land on the same index in both, so both are GREEN.
            sessions.record("c", "p", "stone");
            assert.equal(game.keyboard.n, MARK.HIT, "n is index 3 in both words");
            assert.equal(game.keyboard.e, MARK.HIT, "e is index 4 in both words");
            assert.equal(game.keyboard.s, MARK.MISS);
            assert.equal(game.keyboard.t, MARK.MISS);
            assert.equal(game.keyboard.o, MARK.MISS);

            // "nacre" is the wrong-place case: every letter is in "crane", none in its place
            // except the final e.
            sessions.record("c", "p", "nacre");
            assert.equal(game.keyboard.c, MARK.NEAR, "c is in crane, but not at index 2");
            assert.equal(game.keyboard.r, MARK.NEAR, "r is in crane, but not at index 3");
            assert.equal(game.keyboard.a, MARK.NEAR, "a is in crane, but not at index 1");

            // ✅ FIXED — the winning guess updates the keyboard too. His yellow/red pass sat
            // inside `if not correct:`, so the final guess never touched the tracker and the
            // finished board showed a keyboard that disagreed with it.
            sessions.record("c", "p", "crane");
            assert.equal(game.keyboard.c, MARK.HIT, "upgraded from near by the winning guess");
            assert.equal(game.keyboard.r, MARK.HIT);
            assert.equal(game.keyboard.a, MARK.HIT);
            sessions.end("c");
        },
    },
    {
        label: "a target outside his 4-6 range, or with non-letters, is refused at the door",
        fn: () => {
            const sessions = new WordleSessions();
            assert.throws(() => sessions.start({ channelId: "c", starterId: "p", target: "abc" }), /4-6/);
            assert.throws(() => sessions.start({ channelId: "c", starterId: "p", target: "abcdefg" }), /4-6/);
            assert.throws(() => sessions.start({ channelId: "c", starterId: "p", target: "ab1de" }), /bad wordle target/);
            assert.equal(sessions.size, 0, "a refused start must not leave a session behind");
        },
    },

    // ── the word list ────────────────────────────────────────────────────────
    {
        label: "🔑 the seeded dictionary satisfies his rules — 4-6 letters, lowercase a-z, unique",
        fn: () => {
            assert.ok(WORDLE_WORDS.length > 500, `only ${WORDLE_WORDS.length} words seeded`);

            for (const entry of WORDLE_WORDS) {
                assert.match(entry.word, /^[a-z]+$/, `"${entry.word}" is not lowercase a-z`);
                assert.ok(
                    entry.word.length >= WORDLE_RULES.MIN_LENGTH && entry.word.length <= WORDLE_RULES.MAX_LENGTH,
                    `"${entry.word}" is ${entry.word.length} letters`,
                );
                assert.equal(entry.length, entry.word.length, `"${entry.word}" has a wrong length column`);
            }

            assert.equal(new Set(WORDLE_WORDS.map((w) => w.word)).size, WORDLE_WORDS.length, "duplicates");
        },
    },
    {
        label: "all three of his lengths are actually available to draw",
        fn: () => {
            for (const length of [4, 5, 6]) {
                const count = WORDLE_WORDS.filter((w) => w.length === length).length;
                assert.ok(count > 50, `only ${count} words of length ${length} — a /wordle length:${length} would repeat`);
            }
        },
    },
    {
        label: "every seeded word can be played and solved end to end",
        fn: () => {
            // A sanity sweep: start a game on a sample of real words and solve each, which would
            // catch a word the session refuses or scoring cannot mark all-green.
            const sessions = new WordleSessions();
            const sample = WORDLE_WORDS.filter((_, i) => i % 47 === 0);

            for (const [i, entry] of sample.entries()) {
                const key = `c${i}`;
                sessions.start({ channelId: key, guildId: "g", starterId: "p", target: entry.word });
                const result = sessions.record(key, "p", entry.word.toUpperCase());
                assert.equal(result.solved, true, `"${entry.word}" could not be solved by itself`);
                assert.ok(result.marks.every((m) => m === MARK.HIT), `"${entry.word}" is not all green`);
                sessions.end(key);
            }
            assert.equal(sessions.size, 0);
        },
    },
];
