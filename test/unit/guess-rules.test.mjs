/**
 * Unit: the guessing game's rules, with no database and no Discord.
 *
 * These encode GAME BALANCE, so a change to one of these numbers is Ote's decision, not a
 * refactor. Every case names where the number came from.
 *
 * 🔑 The most important case here is "nobody guessed a player-set target" — that is the bug
 * he asked to have fixed, and the test asserts the FIXED behaviour with the legacy's own
 * wrong behaviour written down beside it.
 */

import assert from "node:assert/strict";

import {
    GUESS_RULES,
    OUTCOME,
    payoutMultiplier,
    winnings,
    perGuessLoss,
    settle,
    validateStart,
    validateGuess,
    compareGuess,
    GuessSessions,
} from "../../app/data/guess.js";

const STARTER = "700000000000000001";
const ALICE = "700000000000000002";
const BOB = "700000000000000003";

/** A finished game, with whatever the case needs overridden. */
const gameOf = (overrides = {}) => ({
    bet: 70,
    withBot: true,
    starterId: STARTER,
    attempts: 0,
    guesses: [],
    target: 42,
    ...overrides,
});

const byPlayer = (movements) => {
    const map = new Map();
    for (const movement of movements) {
        map.set(movement.discordId, (map.get(movement.discordId) ?? 0) + movement.amount);
    }
    return map;
};

export default [
    {
        label: "his numbers: bet 10-1000, 7 attempts, target 1-100, 5 minutes",
        fn: () => {
            assert.equal(GUESS_RULES.MIN_BET, 10);
            assert.equal(GUESS_RULES.MAX_BET, 1000);
            assert.equal(GUESS_RULES.DEFAULT_BET, 10);
            assert.equal(GUESS_RULES.MAX_ATTEMPTS, 7);
            assert.equal(GUESS_RULES.MIN_TARGET, 1);
            assert.equal(GUESS_RULES.MAX_TARGET, 100);
            assert.equal(GUESS_RULES.LIFETIME_MS, 5 * 60 * 1000);
        },
    },
    {
        label: "the payout ladder is ×5 / ×2 / ×1.5 / ×0.5 / nothing",
        fn: () => {
            assert.equal(payoutMultiplier(1), 5);
            assert.equal(payoutMultiplier(2), 2);
            assert.equal(payoutMultiplier(3), 2);
            assert.equal(payoutMultiplier(4), 1.5);
            assert.equal(payoutMultiplier(5), 1.5);
            assert.equal(payoutMultiplier(6), 0.5);
            assert.equal(payoutMultiplier(7), 0);
            assert.equal(payoutMultiplier(0), 0);
        },
    },
    {
        label: "the fractional multipliers TRUNCATE, as int(bet*1.5) did",
        fn: () => {
            assert.equal(winnings(15, 4), 22, "int(15*1.5) is 22, not 23");
            assert.equal(winnings(15, 6), 7, "int(15*0.5) is 7, not 8");
            assert.equal(winnings(100, 1), 500);
            assert.equal(winnings(100, 3), 200);
            assert.equal(winnings(100, 7), 0);
        },
    },
    {
        label: "a losing guesser pays round(guesses × bet ÷ 7) — seven guesses costs the bet",
        fn: () => {
            assert.equal(perGuessLoss(7, 70), 70, "all seven guesses should cost the whole bet");
            assert.equal(perGuessLoss(1, 70), 10);
            assert.equal(perGuessLoss(3, 70), 30);
            // Rounding, not truncation: 2*10/7 = 2.857 -> 3
            assert.equal(perGuessLoss(2, 10), 3);
        },
    },
    {
        label: "a first-try win pays ×5 and the winner pays no guess cost",
        fn: () => {
            const movements = settle(
                gameOf({ attempts: 1, guesses: [{ playerId: ALICE, value: 42 }] }),
                OUTCOME.CORRECT,
                ALICE,
            );
            const totals = byPlayer(movements);
            assert.equal(totals.get(ALICE), 350, "70 × 5");
            assert.equal(totals.has(STARTER), false, "the bot set the target, so nobody loses a bet");
        },
    },
    {
        label: "everyone who guessed and lost pays, and the winner is exempt",
        fn: () => {
            const movements = settle(
                gameOf({
                    attempts: 4,
                    guesses: [
                        { playerId: BOB, value: 10 },
                        { playerId: BOB, value: 20 },
                        { playerId: ALICE, value: 30 },
                        { playerId: ALICE, value: 42 },
                    ],
                }),
                OUTCOME.CORRECT,
                ALICE,
            );
            const totals = byPlayer(movements);
            assert.equal(totals.get(ALICE), winnings(70, 4), "the winner keeps the whole prize");
            assert.equal(totals.get(BOB), -perGuessLoss(2, 70), "two guesses, two sevenths");
        },
    },
    {
        label: "when a PLAYER set the target and it is guessed, that player loses the bet",
        fn: () => {
            const movements = settle(
                gameOf({
                    withBot: false,
                    attempts: 2,
                    guesses: [
                        { playerId: ALICE, value: 5 },
                        { playerId: ALICE, value: 42 },
                    ],
                }),
                OUTCOME.CORRECT,
                ALICE,
            );
            const totals = byPlayer(movements);
            assert.equal(totals.get(STARTER), -70, "their target was cracked");
            assert.equal(totals.get(ALICE), winnings(70, 2));
        },
    },
    {
        label: "🔑 FIXED — nobody guesses a player-set target: THE STARTER wins, not the last guesser",
        fn: () => {
            // The legacy said the starter won and then paid `guesser`, the last person to
            // guess:
            //     end_field += f"{players[0]} **won the game with the target you choose.**"
            //     end_field += self.guess_money_process(ctx, guesser, bet)
            // The message and the payout disagreed. Ote: "fix my old logic bug and go on".
            const movements = settle(
                gameOf({
                    withBot: false,
                    attempts: 7,
                    guesses: [
                        { playerId: ALICE, value: 1 },
                        { playerId: ALICE, value: 2 },
                        { playerId: ALICE, value: 3 },
                        { playerId: ALICE, value: 4 },
                        { playerId: ALICE, value: 5 },
                        { playerId: BOB, value: 6 },
                        { playerId: BOB, value: 7 },
                    ],
                }),
                OUTCOME.EXHAUSTED,
            );
            const totals = byPlayer(movements);

            assert.equal(totals.get(STARTER), 70, "the target-setter should win the bet");
            // BOB guessed last. Under the legacy he would have received +70 and been exempt
            // from his own guess cost.
            assert.equal(totals.get(BOB), -perGuessLoss(2, 70), "the last guesser must NOT be paid");
            assert.equal(totals.get(ALICE), -perGuessLoss(5, 70));
        },
    },
    {
        label: "nobody guesses the BOT's target: no winner, and the guessers still pay",
        fn: () => {
            const movements = settle(
                gameOf({
                    withBot: true,
                    attempts: 7,
                    guesses: Array.from({ length: 7 }, (unused, i) => ({ playerId: ALICE, value: i + 1 })),
                }),
                OUTCOME.EXHAUSTED,
            );
            const totals = byPlayer(movements);
            assert.equal(totals.has(STARTER), false, "there is no target-setter to pay");
            assert.equal(totals.get(ALICE), -70, "seven guesses is the whole bet");
        },
    },
    {
        label: "⚠️ CHANGED — a timeout now bills the guessers exactly like running out of attempts",
        fn: () => {
            // The legacy charged nothing on the 5-minute expiry but charged everyone when the
            // attempts ran out — the same non-outcome with a different bill.
            const guesses = [
                { playerId: ALICE, value: 1 },
                { playerId: BOB, value: 2 },
            ];
            const timeout = byPlayer(settle(gameOf({ attempts: 2, guesses }), OUTCOME.TIMEOUT));
            const exhausted = byPlayer(settle(gameOf({ attempts: 2, guesses }), OUTCOME.EXHAUSTED));
            assert.deepEqual([...timeout.entries()].sort(), [...exhausted.entries()].sort());
            assert.equal(timeout.get(ALICE), -perGuessLoss(1, 70));
        },
    },
    {
        label: "the starter cancelling forfeits the bet, and nobody else pays",
        fn: () => {
            const movements = settle(
                gameOf({ attempts: 2, guesses: [{ playerId: ALICE, value: 1 }] }),
                OUTCOME.CANCELLED_BY_STARTER,
            );
            assert.equal(movements.length, 1);
            assert.equal(movements[0].discordId, STARTER);
            assert.equal(movements[0].amount, -70);
        },
    },
    {
        label: "a moderator cancelling costs nobody anything — his rule, kept",
        fn: () => {
            const movements = settle(
                gameOf({ attempts: 3, guesses: [{ playerId: ALICE, value: 1 }] }),
                OUTCOME.CANCELLED_BY_MODERATOR,
            );
            assert.deepEqual(movements, []);
        },
    },
    {
        label: "a seventh-attempt win pays nothing but still exempts the winner from the cost",
        fn: () => {
            const movements = settle(
                gameOf({
                    attempts: 7,
                    guesses: [
                        ...Array.from({ length: 6 }, (unused, i) => ({ playerId: BOB, value: i + 1 })),
                        { playerId: ALICE, value: 42 },
                    ],
                }),
                OUTCOME.CORRECT,
                ALICE,
            );
            const totals = byPlayer(movements);
            assert.equal(totals.has(ALICE), false, "×0 means no row at all, not a zero row");
            assert.equal(totals.get(BOB), -perGuessLoss(6, 70));
        },
    },
    {
        label: "every settlement's reason is one the ledger accepts",
        fn: () => {
            const allowed = new Set(["game_win", "game_loss"]);
            for (const outcome of Object.values(OUTCOME)) {
                const movements = settle(
                    gameOf({
                        withBot: false,
                        attempts: 3,
                        guesses: [{ playerId: ALICE, value: 1 }],
                    }),
                    outcome,
                    ALICE,
                );
                for (const movement of movements) {
                    assert.ok(allowed.has(movement.reason), `${outcome} used reason "${movement.reason}"`);
                    assert.ok(movement.note, "every movement should say why, for the ledger");
                }
            }
        },
    },
    {
        label: "validateStart enforces the bet floor, ceiling and affordability",
        fn: () => {
            assert.equal(validateStart({ bet: 50, target: null, balance: 500 }), null);
            assert.equal(validateStart({ bet: 9, target: null, balance: 500 }).code, "BET_TOO_LOW");
            assert.equal(validateStart({ bet: 1001, target: null, balance: 5000 }).code, "BET_TOO_HIGH");
            assert.equal(validateStart({ bet: 500, target: null, balance: 499 }).code, "CANNOT_AFFORD");
            assert.equal(validateStart({ bet: 10.5, target: null, balance: 500 }).code, "BAD_BET");
            // Exactly affordable is allowed.
            assert.equal(validateStart({ bet: 500, target: null, balance: 500 }), null);
        },
    },
    {
        label: "validateStart checks a player-set target is in range",
        fn: () => {
            assert.equal(validateStart({ bet: 10, target: 1, balance: 100 }), null);
            assert.equal(validateStart({ bet: 10, target: 100, balance: 100 }), null);
            assert.equal(validateStart({ bet: 10, target: 0, balance: 100 }).code, "BAD_TARGET");
            assert.equal(validateStart({ bet: 10, target: 101, balance: 100 }).code, "BAD_TARGET");
        },
    },
    {
        label: "validateGuess refuses out of range, repeats, and the target-setter",
        fn: () => {
            const game = gameOf({
                withBot: false,
                guesses: [{ playerId: ALICE, value: 50 }],
            });
            assert.equal(validateGuess(game, BOB, 51), null);
            assert.equal(validateGuess(game, BOB, 0).code, "OUT_OF_RANGE");
            assert.equal(validateGuess(game, BOB, 101).code, "OUT_OF_RANGE");

            const repeat = validateGuess(game, BOB, 50);
            assert.equal(repeat.code, "ALREADY_GUESSED");
            assert.equal(repeat.by, ALICE, "it should say who took that number");

            assert.equal(validateGuess(game, STARTER, 51).code, "IS_TARGET_SETTER");
            // Against the bot the starter is just another player.
            assert.equal(validateGuess(gameOf({ withBot: true }), STARTER, 51), null);
        },
    },
    {
        label: "compareGuess says higher / lower / correct from the guesser's side",
        fn: () => {
            assert.equal(compareGuess(50, 42), "higher");
            assert.equal(compareGuess(30, 42), "lower");
            assert.equal(compareGuess(42, 42), "correct");
        },
    },
    {
        label: "one game per channel, and different channels are independent",
        fn: () => {
            const sessions = new GuessSessions();
            sessions.start({ channelId: "c1", starterId: STARTER, bet: 10, target: 7 });
            assert.equal(sessions.has("c1"), true);
            assert.equal(sessions.has("c2"), false);

            let threw = false;
            try {
                sessions.start({ channelId: "c1", starterId: BOB, bet: 10, target: 8 });
            } catch {
                threw = true;
            }
            assert.ok(threw, "a second game in the same channel must be refused");

            // A different channel is fine — this is what the legacy got right and OX did not.
            sessions.start({ channelId: "c2", starterId: BOB, bet: 10, target: 8 });
            assert.equal(sessions.get("c1").target, 7);
            assert.equal(sessions.get("c2").target, 8);
        },
    },
    {
        label: "an omitted target means the bot picks one, in range",
        fn: () => {
            const sessions = new GuessSessions();
            for (let i = 0; i < 50; i += 1) {
                const game = sessions.start({ channelId: `c${i}`, starterId: STARTER, bet: 10, target: null });
                assert.equal(game.withBot, true);
                assert.ok(Number.isInteger(game.target));
                assert.ok(game.target >= 1 && game.target <= 100, `target ${game.target} out of range`);
            }
        },
    },
    {
        label: "🔑 the per-channel lock serialises overlapping guesses",
        fn: async () => {
            // Without this, two players clicking at the same instant both read attempts = 3
            // and both write 4. The legacy's guard was one module-level boolean shared by
            // every channel, which gave up after ten seconds.
            const sessions = new GuessSessions();
            sessions.start({ channelId: "race", starterId: STARTER, bet: 10, target: 99 });

            const order = [];
            await Promise.all(
                Array.from({ length: 10 }, (unused, i) =>
                    sessions.withLock("race", async () => {
                        const before = sessions.get("race").attempts;
                        // Yield, so an unlocked implementation would definitely interleave.
                        await new Promise((resolve) => setTimeout(resolve, 1));
                        sessions.record("race", ALICE, i + 1);
                        order.push([before, sessions.get("race").attempts]);
                    }),
                ),
            );

            assert.equal(sessions.get("race").attempts, 10, "attempts were lost to a race");
            for (const [index, [before, after]] of order.entries()) {
                assert.equal(before, index, `entry ${index} saw attempts=${before}`);
                assert.equal(after, index + 1);
            }
        },
    },
    {
        label: "the lock map does not grow forever",
        fn: async () => {
            const sessions = new GuessSessions();
            for (let i = 0; i < 20; i += 1) {
                await sessions.withLock(`ch${i}`, async () => {});
            }
            assert.equal(sessions.locks.size, 0, "finished locks should be dropped");
        },
    },
];
