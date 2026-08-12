/**
 * Unit: the dice game's rules.
 *
 * The interesting assertions here are the ones that pin down HIS numbers — `> 3` is high,
 * the ×3 is profit on top of the stake, and both Thai spellings of "low" must keep working.
 */

import assert from "node:assert/strict";

import {
    DICE_RULES,
    GUESS_ALIASES,
    parseGuess,
    acceptedGuesses,
    faceTraits,
    roll,
    animationFaces,
    isFaceBet,
    validateBet,
    resolveDice,
} from "../../app/data/dice.js";

export default [
    // ── his typed aliases ────────────────────────────────────────────────────
    {
        label: "every alias he accepted still parses",
        fn: () => {
            for (const [kind, aliases] of Object.entries(GUESS_ALIASES)) {
                for (const alias of aliases) assert.equal(parseGuess(alias), kind, `${alias} → ${kind}`);
            }
        },
    },
    {
        label: "🔑 BOTH Thai spellings of 'low' parse — ต่ำ and ตำ่ are different bytes, same word",
        fn: () => {
            // The tone mark and the vowel can be typed in either order. They look identical on
            // screen and are NOT equal as strings, which is why he listed both.
            assert.notEqual("ต่ำ", "ตำ่", "if these were equal, keeping both would be pointless");
            assert.equal(parseGuess("ต่ำ"), "low");
            assert.equal(parseGuess("ตำ่"), "low");
        },
    },
    {
        label: "a bare 1-6 parses to a NUMBER, and is recognised as a face bet",
        fn: () => {
            for (let face = 1; face <= 6; face += 1) {
                assert.equal(parseGuess(String(face)), face);
                assert.equal(isFaceBet(parseGuess(String(face))), true);
            }
            assert.equal(isFaceBet("even"), false);
            assert.equal(isFaceBet("high"), false);
        },
    },
    {
        label: "⚠️ FIXED — a face outside 1-6, or a non-ASCII digit, is refused",
        fn: () => {
            // His `guess.isnumeric()` accepted Unicode numerics that int() then parsed, so Thai
            // ๓ was a legal guess on a die whose faces read 3.
            assert.equal(parseGuess("๓"), null, "Thai digit must not be a face");
            assert.equal(parseGuess("٣"), null, "Arabic-Indic digit must not be a face");
            assert.equal(parseGuess("0"), null);
            assert.equal(parseGuess("7"), null);
            assert.equal(parseGuess("11"), null);
        },
    },
    {
        label: "case and whitespace do not matter; nonsense parses to null",
        fn: () => {
            assert.equal(parseGuess(" EVEN "), "even");
            assert.equal(parseGuess("HIGH"), "high");
            for (const input of ["", "  ", "z", "evenish", null, undefined, 4, {}]) {
                assert.equal(parseGuess(input), null, JSON.stringify(input));
            }
            assert.match(acceptedGuesses(), /even/);
            assert.match(acceptedGuesses(), /×3/);
        },
    },

    // ── his face maths ───────────────────────────────────────────────────────
    {
        label: "🔑 HIGH IS `> 3` — 4-5-6 high, 1-2-3 low, no face is a push",
        fn: () => {
            assert.deepEqual([1, 2, 3].map((f) => faceTraits(f).highLow), ["low", "low", "low"]);
            assert.deepEqual([4, 5, 6].map((f) => faceTraits(f).highLow), ["high", "high", "high"]);

            // Three of each, so high/low is an exactly even split.
            const highs = [1, 2, 3, 4, 5, 6].filter((f) => faceTraits(f).highLow === "high").length;
            assert.equal(highs, 3);
        },
    },
    {
        label: "even/odd splits three and three as well",
        fn: () => {
            assert.deepEqual([2, 4, 6].map((f) => faceTraits(f).evenOdd), ["even", "even", "even"]);
            assert.deepEqual([1, 3, 5].map((f) => faceTraits(f).evenOdd), ["odd", "odd", "odd"]);
        },
    },
    {
        label: "roll() only ever produces 1-6, and reaches all six",
        fn: () => {
            const seen = new Set();
            for (let i = 0; i < 6_000; i += 1) {
                const face = roll();
                assert.ok(Number.isInteger(face) && face >= 1 && face <= 6, `rolled ${face}`);
                seen.add(face);
            }
            assert.equal(seen.size, 6, `every face should appear; saw ${[...seen].sort().join(",")}`);
        },
    },
    {
        label: "the extremes of rng map to face 1 and face 6, never off the die",
        fn: () => {
            assert.equal(roll(() => 0), 1);
            assert.equal(roll(() => 0.999999), 6);
        },
    },

    // ── his payouts ──────────────────────────────────────────────────────────
    {
        label: "🔑 the ×3 is PROFIT ON TOP of the stake — his money_add(bet*3), not a 3× return",
        fn: () => {
            const win = resolveDice({ guess: 4, face: 4, bet: 10 });
            assert.equal(win.won, true);
            assert.equal(win.multiplier, DICE_RULES.FACE_PAYOUT);
            assert.equal(win.amount, 30, "10 staked returns +30 profit, four times the stake in hand");
            assert.equal(win.movements[0].reason, "game_win");
        },
    },
    {
        label: "even/odd/high/low pays 1:1",
        fn: () => {
            assert.equal(resolveDice({ guess: "even", face: 4, bet: 10 }).amount, 10);
            assert.equal(resolveDice({ guess: "high", face: 4, bet: 10 }).amount, 10);
            assert.equal(resolveDice({ guess: "low", face: 3, bet: 10 }).amount, 10);
            assert.equal(resolveDice({ guess: "odd", face: 3, bet: 10 }).amount, 10);
        },
    },
    {
        label: "a miss is −bet whatever was called",
        fn: () => {
            assert.equal(resolveDice({ guess: "even", face: 3, bet: 10 }).amount, -10);
            assert.equal(resolveDice({ guess: "high", face: 2, bet: 10 }).amount, -10);
            assert.equal(resolveDice({ guess: 5, face: 2, bet: 10 }).amount, -10);
            assert.equal(resolveDice({ guess: 5, face: 2, bet: 10 }).movements[0].reason, "game_loss");
        },
    },
    {
        label: "a face bet wins on exactly one of six faces, an either-or bet on exactly three",
        fn: () => {
            const faceWins = [1, 2, 3, 4, 5, 6].filter((f) => resolveDice({ guess: 4, face: f, bet: 1 }).won);
            assert.deepEqual(faceWins, [4]);

            const evenWins = [1, 2, 3, 4, 5, 6].filter((f) => resolveDice({ guess: "even", face: f, bet: 1 }).won);
            assert.deepEqual(evenWins, [2, 4, 6]);

            const highWins = [1, 2, 3, 4, 5, 6].filter((f) => resolveDice({ guess: "high", face: f, bet: 1 }).won);
            assert.deepEqual(highWins, [4, 5, 6]);
        },
    },
    {
        label: "🔑 the house edge lands on the LONG SHOT: even-money is EV 0, the face bet is −bet/3",
        fn: () => {
            const bet = 30;

            // even/odd/high/low: 3 of 6 faces win, paying 1:1
            const evenMoneyEv = (3 / 6) * bet + (3 / 6) * -bet;
            assert.equal(evenMoneyEv, 0, "the safe bets are free");

            // exact face: 1 of 6 wins, paying ×3 — a fair price for 1-in-6 would be ×5
            const faceEv = (1 / 6) * (bet * DICE_RULES.FACE_PAYOUT) + (5 / 6) * -bet;
            assert.ok(Math.abs(faceEv - -bet / 3) < 1e-9, `face EV ${faceEv} should be −bet/3`);

            // Same magnitude of edge as the coinflip high-roller brake, charged differently.
            assert.ok(faceEv < 0);
        },
    },
    {
        label: "the reported chance matches the bet type",
        fn: () => {
            assert.equal(resolveDice({ guess: 3, face: 1, bet: 2 }).chance, 1 / 6);
            assert.equal(resolveDice({ guess: "odd", face: 1, bet: 2 }).chance, 1 / 2);
        },
    },

    // ── his bet limits ───────────────────────────────────────────────────────
    {
        label: "his bet limits hold: 2-1000, never more than you have, default 10",
        fn: () => {
            assert.equal(DICE_RULES.DEFAULT_BET, 10);
            assert.equal(validateBet({ money: 100, bet: 10 }), null);
            assert.equal(validateBet({ money: 100, bet: 1 })?.code, "BET_TOO_LOW");
            assert.equal(validateBet({ money: 5_000, bet: 1_001 })?.code, "BET_TOO_HIGH");
            assert.equal(validateBet({ money: 100, bet: 101 })?.code, "CANNOT_AFFORD");
            assert.equal(validateBet({ money: 100, bet: 2.5 })?.code, "BAD_BET");
        },
    },
    {
        label: "⚠️ ORDER FIXED — under 2 coins is TOO_POOR before any bet figure is quoted",
        fn: () => {
            assert.equal(validateBet({ money: 1, bet: 10 })?.code, "TOO_POOR");
            assert.equal(validateBet({ money: 0, bet: 2 })?.code, "TOO_POOR");
            assert.equal(validateBet({ money: -30, bet: 2 })?.code, "TOO_POOR");
            // At exactly 2 the smallest bet is affordable, so play is allowed.
            assert.equal(validateBet({ money: 2, bet: 2 }), null);
        },
    },

    // ── the animation ────────────────────────────────────────────────────────
    {
        label: "🔑 the animation ENDS on the face that was settled — his 5 frames, real one last",
        fn: () => {
            const frames = animationFaces(5);
            assert.equal(frames.length, DICE_RULES.ANIMATION_FRAMES);
            assert.equal(frames.at(-1), 5, "the last frame must be the face that actually paid");
            for (const face of frames) assert.ok(face >= 1 && face <= 6);
        },
    },
    {
        label: "the animation's teaser frames are random, not a countdown",
        fn: () => {
            // Two runs should differ somewhere in the first four frames; if they never did, the
            // "rolling" frames would be decoration with no roll in them.
            const a = animationFaces(6).slice(0, -1).join("");
            let differs = false;
            for (let i = 0; i < 40 && !differs; i += 1) {
                if (animationFaces(6).slice(0, -1).join("") !== a) differs = true;
            }
            assert.ok(differs, "teaser frames appear to be fixed");
        },
    },
];
