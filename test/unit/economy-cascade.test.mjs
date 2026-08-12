/**
 * Unit: the progression cascade, with no database.
 *
 * These are the legacy's own rules, so each case names what the legacy did. If one of
 * these ever has to change, it is a GAME BALANCE decision and belongs to Ote, not a
 * refactor.
 *
 *   exp cap  = level * 10 + magical_crystal * 2
 *   at cap   → level +1, exp -= cap, check again (a big credit cascades)
 *   level 100 → +1 magical crystal, level -= 100
 *   exp < 0  → clamped to 0
 */

import assert from "node:assert/strict";

import {
    cascadeProgress,
    expCap,
    isBadEcon,
    toInt,
    BAD_ECON_THRESHOLD,
} from "../../app/data/economy.js";
import { assertThrows } from "../lib/harness.mjs";

const at = (level, crystal = 0, exp = 0) => ({ exp, level, magical_crystal: crystal });

export default [
    {
        label: "expCap is level*10 + crystals*2, as the legacy computed it",
        fn: () => {
            assert.equal(expCap(1, 0), 10);
            assert.equal(expCap(23, 0), 230);
            assert.equal(expCap(5, 3), 56);
            assert.equal(expCap(0, 0), 0);
        },
    },
    {
        label: "a gain below the cap just accumulates",
        fn: () => {
            const result = cascadeProgress({ ...at(5, 0, 3), expDelta: 6 });
            assert.equal(result.exp, 9);
            assert.equal(result.level, 5);
            assert.equal(result.levelsGained, 0);
        },
    },
    {
        label: "reaching the cap exactly levels up and leaves zero exp",
        fn: () => {
            const result = cascadeProgress({ ...at(5, 0, 0), expDelta: 50 });
            assert.equal(result.level, 6);
            assert.equal(result.exp, 0);
            assert.equal(result.levelsGained, 1);
        },
    },
    {
        label: "the remainder carries over instead of being lost",
        fn: () => {
            const result = cascadeProgress({ ...at(5, 0, 0), expDelta: 57 });
            assert.equal(result.level, 6);
            assert.equal(result.exp, 7);
        },
    },
    {
        label: "one big gain cascades through several levels",
        fn: () => {
            // level 1 cap 10, level 2 cap 20, level 3 cap 30 → 60 exp clears three.
            const result = cascadeProgress({ ...at(1, 0, 0), expDelta: 60 });
            assert.equal(result.level, 4);
            assert.equal(result.exp, 0);
            assert.equal(result.levelsGained, 3);
        },
    },
    {
        label: "level 99 → 100 becomes a magical crystal and level 0",
        fn: () => {
            // At level 99 the cap is 990.
            const result = cascadeProgress({ ...at(99, 0, 0), expDelta: 990 });
            assert.equal(result.magical_crystal, 1, "no crystal was awarded");
            assert.equal(result.crystalsGained, 1);
            assert.equal(result.level, 0, "level should wrap to 0 after the conversion");
            assert.ok(result.level < 100, "level must never settle at or above 100");
        },
    },
    {
        label: "crystals raise the cap permanently, by 2 each",
        fn: () => {
            assert.equal(expCap(10, 0), 100);
            assert.equal(expCap(10, 5), 110);

            // With a crystal, the same exp goes less far.
            const without = cascadeProgress({ ...at(10, 0, 0), expDelta: 100 });
            const with5 = cascadeProgress({ ...at(10, 5, 0), expDelta: 100 });
            assert.equal(without.levelsGained, 1);
            assert.equal(with5.levelsGained, 0);
        },
    },
    {
        label: "negative exp is clamped to 0, never below — the legacy's own guard",
        fn: () => {
            const result = cascadeProgress({ ...at(5, 0, 4), expDelta: -100 });
            assert.equal(result.exp, 0);
            assert.equal(result.level, 5, "losing exp must not cost a level");
            assert.equal(result.levelsGained, 0);
        },
    },
    {
        label: "the level-0 zero-cap quirk is REPRODUCED, not fixed, and terminates",
        fn: () => {
            // At level 0 with no crystals the cap is 0, so `exp >= cap` is true even
            // for a zero gain and the legacy levels the player to 1. Kept because
            // changing it would change the game; asserted because it is surprising.
            const result = cascadeProgress({ ...at(0, 0, 0), expDelta: 0 });
            assert.equal(result.level, 1);
            assert.equal(result.exp, 0);
            assert.equal(result.levelsGained, 1);
        },
    },
    {
        label: "a player who just earned a crystal keeps progressing sanely",
        fn: () => {
            // The state right after a conversion: level 0, one crystal, cap 2.
            assert.equal(expCap(0, 1), 2);
            const result = cascadeProgress({ ...at(0, 1, 0), expDelta: 5 });
            assert.ok(result.level >= 1, "should have levelled at least once");
            assert.ok(result.level < 100);
            assert.ok(result.exp < expCap(result.level, result.magical_crystal));
        },
    },
    {
        label: "the cascade always settles below the cap, over a spread of inputs",
        fn: () => {
            for (const level of [0, 1, 7, 50, 98, 99]) {
                for (const crystal of [0, 1, 9]) {
                    for (const delta of [0, 1, 37, 500, 100_000]) {
                        const result = cascadeProgress({ ...at(level, crystal), expDelta: delta });
                        const cap = expCap(result.level, result.magical_crystal);
                        assert.ok(
                            result.exp < cap || cap === 0,
                            `settled above the cap: level=${level} crystal=${crystal} delta=${delta} → exp=${result.exp} cap=${cap}`,
                        );
                        assert.ok(result.level >= 0 && result.level < 100, "level left its range");
                        assert.ok(result.exp >= 0, "exp went negative");
                    }
                }
            }
        },
    },
    {
        label: "bad econ is below -20, and -20 itself is not bad econ",
        fn: () => {
            assert.equal(BAD_ECON_THRESHOLD, -20);
            assert.equal(isBadEcon(-21), true);
            assert.equal(isBadEcon(-20), false);
            assert.equal(isBadEcon(0), false);
            assert.equal(isBadEcon("925"), false, "must handle the string pg returns for BIGINT");
            assert.equal(isBadEcon("-100"), true);
        },
    },
    {
        label: "toInt refuses a value it would silently corrupt",
        fn: async () => {
            assert.equal(toInt("925"), 925);
            assert.equal(toInt(925), 925);
            assert.equal(toInt("-7"), -7);
            // Beyond 2^53 a JS number stops being exact — better to throw than to be
            // quietly wrong about someone's money.
            await assertThrows(() => toInt("9007199254740993"), "safe integer");
            await assertThrows(() => toInt("abc"), "safe integer");
            await assertThrows(() => toInt(1.5), "safe integer");
            await assertThrows(() => toInt(null), "safe integer");
        },
    },
];
