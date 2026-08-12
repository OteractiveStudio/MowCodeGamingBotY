/**
 * Unit: the coin flip's rules, and his high-roller brake.
 *
 * ⭐ The brake is tested by COUNTING 60,000 flips, not by reading the chance list. A
 * probability asserted by inspecting the code that produces it is not tested at all — the
 * only honest check is to run it and see where the outcomes land.
 */

import assert from "node:assert/strict";

import {
    COINFLIP_RULES,
    SIDE_ALIASES,
    parseSide,
    acceptedSides,
    opposite,
    maxBet,
    defaultBet,
    isHighRoller,
    chanceList,
    winChance,
    describeBrake,
    validateFlip,
    resolveFlip,
} from "../../app/data/coinflip.js";

const T = COINFLIP_RULES.HIGH_ROLLER_THRESHOLD;

/** A deterministic cycling rng, so a "random" choice is reproducible. */
function cycler(values) {
    let i = 0;
    return () => values[i++ % values.length];
}

export default [
    // ── his typed aliases ────────────────────────────────────────────────────
    {
        label: "every alias he accepted still parses — including both Thai words for tail",
        fn: () => {
            for (const alias of SIDE_ALIASES.head) assert.equal(parseSide(alias), "head", alias);
            for (const alias of SIDE_ALIASES.tail) assert.equal(parseSide(alias), "tail", alias);
            // The two he had for tail: the coin-toss word and the literal animal tail.
            assert.equal(parseSide("ก้อย"), "tail");
            assert.equal(parseSide("หาง"), "tail");
            assert.equal(parseSide("หัว"), "head");
        },
    },
    {
        label: "case and surrounding whitespace do not matter — his version rejected ' h '",
        fn: () => {
            assert.equal(parseSide("HEAD"), "head");
            assert.equal(parseSide("  h  "), "head");
            assert.equal(parseSide("\tTail\n"), "tail");
        },
    },
    {
        label: "nonsense parses to null rather than to a side",
        fn: () => {
            for (const input of ["", "   ", "x", "heads up", "3", null, undefined, 7, {}]) {
                assert.equal(parseSide(input), null, JSON.stringify(input));
            }
            // And the rejection message names the real options.
            assert.match(acceptedSides(), /head/);
            assert.match(acceptedSides(), /ก้อย/);
        },
    },
    { label: "opposite() is its own inverse", fn: () => {
        assert.equal(opposite("head"), "tail");
        assert.equal(opposite("tail"), "head");
        assert.equal(opposite(opposite("head")), "head");
    } },

    // ── his bet limits ───────────────────────────────────────────────────────
    {
        label: "the max bet is half your money, floored — and the default IS the max",
        fn: () => {
            assert.equal(maxBet(6), 3);
            assert.equal(maxBet(7), 3);
            assert.equal(maxBet(200), 100);
            assert.equal(maxBet(201), 100);
            assert.equal(defaultBet(200), maxBet(200));
        },
    },
    {
        label: "🔑 his min-6 rule is DERIVED: bet ≥ 3 and bet ≤ money/2 means money ≥ 6",
        fn: () => {
            // At exactly 6, there is precisely one legal bet, and it is 3.
            assert.equal(validateFlip({ money: 6, bet: 3 }), null);
            assert.equal(validateFlip({ money: 6, bet: 4 })?.code, "BET_TOO_HIGH");
            // One coin less and no legal bet exists, which is why the floor is 6 and not 5.
            assert.equal(maxBet(5), 2);
            assert.ok(maxBet(5) < COINFLIP_RULES.MIN_BET);
            assert.equal(validateFlip({ money: 5, bet: 3 })?.code, "TOO_POOR");
        },
    },
    {
        label: "⚠️ ORDER FIXED — a broke player is told they are broke, not given a bet figure",
        fn: () => {
            // His code computed a default of money//2 and announced it BEFORE this check, so a
            // player at 0 was told "the default bet is 0" and only then that they could not play.
            assert.equal(validateFlip({ money: 0, bet: 3 })?.code, "TOO_POOR");
            assert.equal(validateFlip({ money: 5, bet: 2 })?.code, "TOO_POOR");
            // Negative balances (bail, OX losses) reach here too and must not slip through.
            assert.equal(validateFlip({ money: -50, bet: 3 })?.code, "TOO_POOR");
        },
    },
    {
        label: "a non-integer or under-minimum bet is refused",
        fn: () => {
            assert.equal(validateFlip({ money: 100, bet: 2.5 })?.code, "BAD_BET");
            assert.equal(validateFlip({ money: 100, bet: 2 })?.code, "BET_TOO_LOW");
            assert.equal(validateFlip({ money: 100, bet: 51 })?.code, "BET_TOO_HIGH");
            assert.equal(validateFlip({ money: 100, bet: 50 }), null);
        },
    },

    // ── the brake: threshold semantics ───────────────────────────────────────
    {
        label: "⚠️ the brake starts at 100,001 — his test was `> 100000`, not `>=`",
        fn: () => {
            assert.equal(isHighRoller(T - 1), false);
            assert.equal(isHighRoller(T), false, "at exactly the threshold the coin is still fair");
            assert.equal(isHighRoller(T + 1), true);
        },
    },
    {
        label: "a NULL or infinite threshold disables the brake; UNDEFINED means 'use the default'",
        fn: () => {
            // ⚠️ The two are deliberately different, and the difference is load-bearing:
            // `undefined` hits the JS default parameter, so an omitted argument still gets his
            // 100,000. Only an EXPLICIT null (or Infinity) turns the brake off. The cog's
            // thresholdFrom() depends on exactly this — an absent config key must fall back to
            // his rule, while `"high_roller_threshold": null` must switch it off.
            assert.equal(isHighRoller(999_999_999, null), false, "explicit null → off");
            assert.equal(isHighRoller(999_999_999, Infinity), false, "unreachable → off");
            assert.equal(isHighRoller(999_999_999, undefined), true, "omitted → his default applies");
            assert.equal(isHighRoller(999_999_999), true, "omitted → his default applies");

            // And a tuned-down threshold engages it earlier.
            assert.equal(isHighRoller(1_000, 500), true);
            assert.equal(isHighRoller(400, 500), false);
        },
    },
    {
        label: "the chance list is built exactly as his was — the OPPOSITE of the guess is added",
        fn: () => {
            assert.deepEqual(chanceList("head", 100), ["head", "tail"]);
            assert.deepEqual(chanceList("head", T + 1), ["head", "tail", "tail"]);
            assert.deepEqual(chanceList("tail", T + 1), ["head", "tail", "head"]);
        },
    },
    {
        label: "🔑 it is biased against the PLAYER, not toward a side — both calls get 1/3",
        fn: () => {
            // The distinguishing property of his design: the weighting is rebuilt from the
            // player's own guess, so neither side is favoured in the abstract.
            assert.equal(winChance("head", T + 1), 1 / 3);
            assert.equal(winChance("tail", T + 1), 1 / 3);
            assert.equal(winChance("head", T), 1 / 2);
            assert.equal(winChance("tail", T), 1 / 2);
        },
    },

    // ── the brake: measured, not asserted ────────────────────────────────────
    {
        label: "🔑 MEASURED over 60,000 flips: fair is ~50%, braked is ~33%",
        fn: () => {
            const rng = Math.random;
            const runs = 30_000;

            let fairWins = 0;
            for (let i = 0; i < runs; i += 1) {
                if (resolveFlip({ guess: "head", money: 1_000, bet: 3, rng }).won) fairWins += 1;
            }

            let brakedWins = 0;
            for (let i = 0; i < runs; i += 1) {
                if (resolveFlip({ guess: "head", money: T + 1, bet: 3, rng }).won) brakedWins += 1;
            }

            const fairRate = fairWins / runs;
            const brakedRate = brakedWins / runs;

            // Generous windows: this is asserting the mechanic works, not the quality of Math.random.
            assert.ok(
                fairRate > 0.47 && fairRate < 0.53,
                `unbraked win rate ${fairRate.toFixed(3)} should sit near 0.500`,
            );
            assert.ok(
                brakedRate > 0.30 && brakedRate < 0.37,
                `braked win rate ${brakedRate.toFixed(3)} should sit near 0.333`,
            );
            assert.ok(
                brakedRate < fairRate - 0.1,
                `the brake must visibly lower the odds: ${brakedRate.toFixed(3)} vs ${fairRate.toFixed(3)}`,
            );
        },
    },
    {
        label: "the payout is 1:1 both ways, so unbraked EV is zero and braked EV is −bet/3",
        fn: () => {
            const bet = 30;
            // Unbraked: 1/2 × +30 + 1/2 × −30 = 0
            const fairEv = 0.5 * bet + 0.5 * -bet;
            assert.equal(fairEv, 0);
            // Braked: 1/3 × +30 + 2/3 × −30 = −10 = −bet/3
            const brakedEv = (1 / 3) * bet + (2 / 3) * -bet;
            assert.ok(Math.abs(brakedEv - -bet / 3) < 1e-9);
        },
    },
    {
        label: "a win is +bet and a loss is −bet, with the matching ledger reason",
        fn: () => {
            // rng 0 picks index 0, which is always "head" in the list.
            const win = resolveFlip({ guess: "head", money: 1_000, bet: 40, rng: () => 0 });
            assert.equal(win.won, true);
            assert.equal(win.amount, 40);
            assert.equal(win.movements[0].reason, "game_win");

            const loss = resolveFlip({ guess: "tail", money: 1_000, bet: 40, rng: () => 0 });
            assert.equal(loss.won, false);
            assert.equal(loss.landed, "head");
            assert.equal(loss.amount, -40);
            assert.equal(loss.movements[0].reason, "game_loss");
        },
    },
    {
        label: "every index of the braked list is reachable — the third entry is not dead",
        fn: () => {
            // rng cycling 0, 0.5, 0.99 hits indexes 0, 1, 2 of the 3-long braked list.
            const rng = cycler([0, 0.5, 0.99]);
            const landed = [
                resolveFlip({ guess: "head", money: T + 1, bet: 3, rng }).landed,
                resolveFlip({ guess: "head", money: T + 1, bet: 3, rng }).landed,
                resolveFlip({ guess: "head", money: T + 1, bet: 3, rng }).landed,
            ];
            assert.deepEqual(landed, ["head", "tail", "tail"]);
        },
    },

    // ── visible and logged, the two things Ote asked for ─────────────────────
    {
        label: "🔑 describeBrake() is null when fair, and carries BOTH a player line and a log line",
        fn: () => {
            assert.equal(describeBrake("head", T), null, "no brake, nothing to announce");

            const brake = describeBrake("head", T + 1);
            assert.ok(brake, "the brake must describe itself when engaged");

            // Ote: "but visible, yeah."
            assert.match(brake.player, /1 in 3/);
            assert.match(brake.player, /100,000/, "the player is told the threshold, not just the odds");

            // Ote: "but make it log when this system fired"
            assert.match(brake.log, /HIGH-ROLLER BRAKE FIRED/);
            assert.match(brake.log, /100001|100,001|> 100000/);
            assert.equal(brake.percent, 33);
            assert.equal(brake.odds, "1 in 3");
        },
    },
    {
        label: "the announced odds are DERIVED from the chance list, so they cannot drift",
        fn: () => {
            // Tuning the threshold must move the announcement with it, with nothing hardcoded.
            const brake = describeBrake("tail", 1_000, 500);
            assert.ok(brake);
            assert.equal(brake.chance, winChance("tail", 1_000, 500));
            assert.equal(brake.threshold, 500);
        },
    },
];
