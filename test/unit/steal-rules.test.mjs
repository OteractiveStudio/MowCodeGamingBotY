/**
 * Unit: robbing and stealing, with no database.
 *
 * Four of these cases exist because his version got them wrong — each is labelled with what it did.
 * The cat/dog mapping is straight from his own item descriptions, which is worth asserting so a
 * future edit cannot quietly break the one detail he actually wrote down.
 */

import assert from "node:assert/strict";

import {
    STEAL_RULES,
    STEAL_TOOLS,
    STEAL_DEFENCES,
    toolFor,
    defencesAgainst,
    successChance,
    maxTakeable,
    amountStolen,
    bailFor,
    cooldownRemaining,
    validateSteal,
    resolveSteal,
} from "../../app/data/steal.js";

const THIEF = "600000000000000001";
const VICTIM = "600000000000000002";

const base = {
    thiefId: THIEF,
    victimId: VICTIM,
    victimIsBot: false,
    tool: STEAL_TOOLS.knife,
    heldQuantity: 1,
    thiefMoney: 300,
    victimMoney: 300,
    lastStealAt: null,
};

export default [
    {
        label: "his shares are kept: a third of theirs, a third of yours as bail",
        fn: () => {
            assert.equal(STEAL_RULES.MAX_SHARE, 1 / 3);
            assert.equal(STEAL_RULES.BAIL_SHARE, 1 / 3);
            assert.equal(maxTakeable(300), 100);
            assert.equal(bailFor(300), 100);
            // Floored, as his integer division was.
            assert.equal(maxTakeable(100), 33);
            assert.equal(bailFor(100), 33);
        },
    },
    {
        label: "🔑 the cat/dog split is exactly what his item text says",
        fn: () => {
            // "Cat can make noise and prevent you from being STOLEN."
            assert.deepEqual(STEAL_DEFENCES.cat.against, ["steal"]);
            // "Dog can protect you from being ROBBED or STOLEN."
            assert.deepEqual(STEAL_DEFENCES.dog.against, ["steal", "rob"]);

            // So a cat is no use against a knife or a gun.
            assert.deepEqual(defencesAgainst("rob", ["cat"]), []);
            assert.equal(defencesAgainst("rob", ["dog"]).length, 1);
            assert.equal(defencesAgainst("steal", ["cat"]).length, 1);
            assert.equal(defencesAgainst("steal", ["cat", "dog"]).length, 2);
        },
    },
    {
        label: "the tool ladder follows his prices — 600 / 1000 / 3000 buys a better chance",
        fn: () => {
            assert.equal(toolFor("passkey").kind, "steal");
            assert.equal(toolFor("knife").kind, "rob");
            assert.equal(toolFor("gun").kind, "rob");
            assert.ok(STEAL_TOOLS.passkey.chance < STEAL_TOOLS.knife.chance);
            assert.ok(STEAL_TOOLS.knife.chance < STEAL_TOOLS.gun.chance);
            assert.equal(toolFor("banana"), null);
            assert.equal(toolFor("KNIFE").kind, "rob", "keys are case-insensitive");
        },
    },
    {
        label: "defences subtract, and a well-defended target is nearly but never perfectly safe",
        fn: () => {
            assert.equal(successChance(STEAL_TOOLS.gun, []), 0.7);
            // A dog takes 50 points off a robbery.
            assert.ok(Math.abs(successChance(STEAL_TOOLS.gun, defencesAgainst("rob", ["dog"])) - 0.2) < 1e-9);
            // A passkey against both pets goes below zero, so it clamps.
            const both = defencesAgainst("steal", ["cat", "dog"]);
            assert.equal(successChance(STEAL_TOOLS.passkey, both), STEAL_RULES.MIN_CHANCE);
            assert.ok(STEAL_RULES.MIN_CHANCE > 0, "a determined thief always has a sliver");
        },
    },
    {
        label: "⚠️ FIXED — stealing from a broke player no longer crashes",
        fn: () => {
            // His `random.randrange(money // 3)` raised ValueError whenever that was 0 or less.
            assert.equal(maxTakeable(0), 0);
            assert.equal(maxTakeable(2), 0);
            assert.equal(maxTakeable(-50), 0, "a negative balance has nothing to take");
            assert.equal(amountStolen(0), 0);
            assert.equal(amountStolen(-50), 0);
        },
    },
    {
        label: "⚠️ FIXED — being in debt no longer PAYS you bail",
        fn: () => {
            // His `m = money // 3` on -60 is -20, and `money_add(-(-20))` credited 20.
            assert.equal(bailFor(-60), 0);
            assert.equal(bailFor(0), 0);
            assert.equal(bailFor(2), 0);
        },
    },
    {
        label: "⚠️ FIXED — a successful steal takes at least 1, never 0",
        fn: () => {
            // His `randrange(m)` returned 0 … m-1, so a success could take nothing and still burn
            // the attempt.
            for (const roll of [0, 0.001, 0.5, 0.999999]) {
                const amount = amountStolen(300, () => roll);
                assert.ok(amount >= 1 && amount <= 100, `roll ${roll} gave ${amount}`);
            }
            assert.equal(amountStolen(300, () => 0), 1);
            assert.equal(amountStolen(300, () => 0.999999), 100, "the top of the range is reachable");
        },
    },
    {
        label: "a cooldown exists at all, which his did not, and it counts down",
        fn: () => {
            const now = 1_000_000_000_000;
            assert.equal(cooldownRemaining(null, now), 0);
            assert.equal(cooldownRemaining(new Date(now - STEAL_RULES.COOLDOWN_MS), now), 0);
            assert.equal(
                cooldownRemaining(new Date(now - STEAL_RULES.COOLDOWN_MS / 2), now),
                STEAL_RULES.COOLDOWN_MS / 2,
            );
        },
    },
    {
        label: "validateSteal refuses the obvious: yourself, a bot, no tool, not held",
        fn: () => {
            assert.equal(validateSteal(base), null);
            assert.equal(validateSteal({ ...base, victimId: THIEF }).code, "SELF");
            assert.equal(validateSteal({ ...base, victimIsBot: true }).code, "BOT_VICTIM");
            assert.equal(validateSteal({ ...base, tool: null }).code, "NO_TOOL");
            assert.equal(validateSteal({ ...base, heldQuantity: 0 }).code, "TOOL_NOT_HELD");
        },
    },
    {
        label: "validateSteal refuses a target with nothing worth taking, and reports the cooldown",
        fn: () => {
            assert.equal(validateSteal({ ...base, victimMoney: 2 }).code, "VICTIM_TOO_POOR");

            const now = 1_000_000_000_000;
            const problem = validateSteal({
                ...base,
                lastStealAt: new Date(now - 60_000),
                now,
            });
            assert.equal(problem.code, "COOLDOWN");
            assert.ok(problem.remainingMs > 0);
            assert.match(problem.message, /minute/);
        },
    },
    {
        label: "a broke thief may still TRY — they simply cannot post bail",
        fn: () => {
            assert.equal(validateSteal({ ...base, thiefMoney: 0 }), null);
            const outcome = resolveSteal({
                thiefId: THIEF,
                victimId: VICTIM,
                tool: STEAL_TOOLS.knife,
                thiefMoney: 0,
                victimMoney: 300,
                random: () => 0.99, // above 0.5, so it fails
            });
            assert.equal(outcome.succeeded, false);
            assert.deepEqual(outcome.movements, [], "no bail row when there is nothing to take");
        },
    },
    {
        label: "a success moves coins from victim to thief, and only those two",
        fn: () => {
            const outcome = resolveSteal({
                thiefId: THIEF,
                victimId: VICTIM,
                tool: STEAL_TOOLS.gun,
                thiefMoney: 100,
                victimMoney: 300,
                random: () => 0.1, // below 0.7, so it succeeds; then 0.1 of the pool
            });
            assert.equal(outcome.succeeded, true);
            assert.equal(outcome.movements.length, 2);

            const victimRow = outcome.movements.find((m) => m.discordId === VICTIM);
            const thiefRow = outcome.movements.find((m) => m.discordId === THIEF);
            assert.equal(victimRow.amount, -thiefRow.amount, "a theft is zero-sum");
            assert.equal(victimRow.reason, "steal_loss");
            assert.equal(thiefRow.reason, "steal_gain");
            assert.ok(thiefRow.amount >= 1 && thiefRow.amount <= maxTakeable(300));
        },
    },
    {
        label: "a failure charges the thief bail and touches the victim not at all",
        fn: () => {
            const outcome = resolveSteal({
                thiefId: THIEF,
                victimId: VICTIM,
                tool: STEAL_TOOLS.passkey,
                thiefMoney: 300,
                victimMoney: 300,
                random: () => 0.99,
            });
            assert.equal(outcome.succeeded, false);
            assert.equal(outcome.movements.length, 1);
            assert.equal(outcome.movements[0].discordId, THIEF);
            assert.equal(outcome.movements[0].amount, -100);
            assert.equal(outcome.movements[0].reason, "steal_loss");
        },
    },
    {
        label: "a dog reports itself, so the victim knows why they were not robbed",
        fn: () => {
            const outcome = resolveSteal({
                thiefId: THIEF,
                victimId: VICTIM,
                tool: STEAL_TOOLS.knife,
                victimItems: ["dog"],
                thiefMoney: 300,
                victimMoney: 300,
                random: () => 0.99,
            });
            assert.equal(outcome.defences.length, 1);
            assert.equal(outcome.defences[0].itemKey, "dog");
            assert.match(outcome.defences[0].note, /dog/);
        },
    },
    {
        label: "every movement uses a ledger reason the schema accepts",
        fn: () => {
            const allowed = new Set(["steal_gain", "steal_loss"]);
            for (const roll of [0.01, 0.99]) {
                for (const tool of Object.values(STEAL_TOOLS)) {
                    for (const movement of resolveSteal({
                        thiefId: THIEF,
                        victimId: VICTIM,
                        tool,
                        thiefMoney: 300,
                        victimMoney: 300,
                        random: () => roll,
                    }).movements) {
                        assert.ok(allowed.has(movement.reason), `bad reason ${movement.reason}`);
                        assert.ok(movement.note, "a movement with no note explains nothing later");
                    }
                }
            }
        },
    },
    {
        label: "over 4,000 attempts the observed success rate matches the stated chance",
        fn: () => {
            // A rigged or inverted comparison would still pass the single-roll cases above.
            let state = 12345;
            const random = () => {
                state = (state * 1664525 + 1013904223) >>> 0;
                return state / 4294967296;
            };

            let wins = 0;
            const RUNS = 4000;
            for (let i = 0; i < RUNS; i += 1) {
                if (
                    resolveSteal({
                        thiefId: THIEF,
                        victimId: VICTIM,
                        tool: STEAL_TOOLS.knife,
                        thiefMoney: 300,
                        victimMoney: 300,
                        random,
                    }).succeeded
                ) {
                    wins += 1;
                }
            }
            const observed = wins / RUNS;
            assert.ok(
                Math.abs(observed - STEAL_TOOLS.knife.chance) < 0.05,
                `expected ~${STEAL_TOOLS.knife.chance}, saw ${observed.toFixed(3)}`,
            );
        },
    },
];
