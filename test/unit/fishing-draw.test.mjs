/**
 * Unit: the weighted draw, with no database.
 *
 * These numbers are the legacy's. The pool builder was:
 *
 *     for i in fish_data: fish_list += [i] * (10 - fish_data[i]['tier'])
 *
 * and the displayed rate was `(10 - tier) / all_posible * 100`. Both are asserted
 * here against the nine seeded fish, so a change to the draw is a visible change to
 * game balance rather than a silent one.
 */

import assert from "node:assert/strict";

import {
    drawWeight,
    totalWeight,
    fishRate,
    drawFish,
    summariseCatch,
    animationFrame,
    animationFrameCount,
    seaPicture,
    SEA_PICTURES,
    AUTO_CAST_LIMIT,
} from "../../app/data/fishing.js";
import { FISH } from "../../database/seeds/reference_data.js";
import { assertThrows } from "../lib/harness.mjs";

// The seeded pool, in the order getFishPool returns it (tier, then key).
const POOL = [...FISH].sort((a, b) =>
    a.tier - b.tier || a.fish_key.localeCompare(b.fish_key),
);

/** A tiny deterministic generator, so a "random" draw is reproducible. */
function lcg(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

export default [
    {
        label: "weight is 10 - tier, the legacy pool builder",
        fn: () => {
            assert.equal(drawWeight(0), 10);
            assert.equal(drawWeight(2), 8);
            assert.equal(drawWeight(9), 1);
        },
    },
    {
        label: "the nine seeded fish total 66 weight",
        fn: () => {
            // 10 + 9 + 8 + 8 + 8 + 8 + 7 + 7 + 1
            assert.equal(POOL.length, 9);
            assert.equal(totalWeight(POOL), 66);
        },
    },
    {
        label: "rates match the legacy formula, and Nothing really is the likeliest",
        fn: () => {
            assert.equal(fishRate(0, POOL).toFixed(2), "15.15"); // Nothing, 10/66
            assert.equal(fishRate(1, POOL).toFixed(2), "13.64"); // Trash, 9/66
            assert.equal(fishRate(2, POOL).toFixed(2), "12.12");
            assert.equal(fishRate(3, POOL).toFixed(2), "10.61");
            assert.equal(fishRate(9, POOL).toFixed(2), "1.52"); // AmogusTheFish, 1/66
        },
    },
    {
        label: "the rarest fish is the most valuable — the legacy's own balance",
        fn: () => {
            const rarest = POOL.reduce((a, b) => (drawWeight(a.tier) <= drawWeight(b.tier) ? a : b));
            const dearest = POOL.reduce((a, b) => (a.price >= b.price ? a : b));
            assert.equal(rarest.fish_key, "AmogusTheFish");
            assert.equal(dearest.fish_key, "AmogusTheFish");
        },
    },
    {
        label: "a draw at the very bottom of the range returns the first fish",
        fn: () => {
            const fish = drawFish(POOL, () => 0);
            assert.equal(fish.fish_key, POOL[0].fish_key);
            assert.equal(fish.tier, 0, "the first fish should be the lowest tier");
        },
    },
    {
        label: "a draw at the very top of the range returns the last, without falling off",
        fn: () => {
            const fish = drawFish(POOL, () => 0.999999999);
            assert.equal(fish.fish_key, POOL[POOL.length - 1].fish_key);
        },
    },
    {
        label: "the weight boundaries land on the fish they should",
        fn: () => {
            // Nothing owns [0, 10) of 66, so 9.5/66 is still Nothing and 10.5/66 is not.
            assert.equal(drawFish(POOL, () => 9.5 / 66).fish_key, POOL[0].fish_key);
            assert.notEqual(drawFish(POOL, () => 10.5 / 66).fish_key, POOL[0].fish_key);
            assert.equal(drawFish(POOL, () => 10.5 / 66).fish_key, POOL[1].fish_key);
        },
    },
    {
        label: "over 60,000 draws the distribution matches the weights within 1.5 points",
        fn: () => {
            const random = lcg(20240922);
            const counts = new Map();
            const DRAWS = 60_000;

            for (let i = 0; i < DRAWS; i += 1) {
                const fish = drawFish(POOL, random);
                counts.set(fish.fish_key, (counts.get(fish.fish_key) ?? 0) + 1);
            }

            for (const fish of POOL) {
                const observed = ((counts.get(fish.fish_key) ?? 0) / DRAWS) * 100;
                const expected = fishRate(fish.tier, POOL);
                assert.ok(
                    Math.abs(observed - expected) < 1.5,
                    `${fish.fish_key}: expected ~${expected.toFixed(2)}%, saw ${observed.toFixed(2)}%`,
                );
            }

            // And the thing the players complain about is true: worthless catches are
            // nearly a third of all draws.
            const junk =
                ((counts.get("Nothing") ?? 0) + (counts.get("Trash") ?? 0)) / DRAWS * 100;
            assert.ok(junk > 25, `junk should dominate, saw ${junk.toFixed(2)}%`);
        },
    },
    {
        label: "an empty or zero-weight pool throws instead of returning undefined",
        fn: async () => {
            await assertThrows(() => drawFish([]), "empty fish pool");
            await assertThrows(() => drawFish(null), "empty fish pool");
            // Tier 10 would weigh 0 — the exact case the SQL CHECK prevents.
            await assertThrows(() => drawFish([{ fish_key: "x", tier: 10 }]), "zero or negative weight");
        },
    },
    {
        label: "the auto cap is the legacy's 30",
        fn: () => {
            assert.equal(AUTO_CAST_LIMIT, 30);
        },
    },
    {
        label: "the animation frame is his shape: a 10-wide sky over an 11-wide sea",
        fn: () => {
            // sky = 9 sunrises with the rower inserted -> 10 cells
            // sea = 10 waves with one creature inserted -> 11 cells
            const frame = animationFrame(() => 0);
            const lines = frame.split("\n");
            assert.equal(lines[0], "", "the frame should start with a newline, as his did");
            assert.equal([...lines[1].matchAll(/🌅/g)].length, 9);
            assert.ok(lines[1].includes("🚣‍♂️🎣"), "the rower is missing from the sky");
            assert.equal([...lines[2].matchAll(/🌊/g)].length, 10);
        },
    },
    {
        label: "the creature moves around and varies between frames",
        fn: () => {
            const random = lcg(4242);
            const frames = new Set();
            for (let i = 0; i < 40; i += 1) frames.add(animationFrame(random));
            assert.ok(frames.size > 5, `expected varied frames, got ${frames.size} distinct`);
        },
    },
    {
        label: "his own throttle is kept: runs of 21+ casts draw no frames",
        fn: () => {
            // The legacy condition was `if rod_left < 21`, which is what stopped a full
            // 30-rod run from being 30 message edits.
            assert.equal(animationFrameCount(1), 1);
            assert.equal(animationFrameCount(10), 10);
            assert.equal(animationFrameCount(20), 20);
            assert.equal(animationFrameCount(21), 0);
            assert.equal(animationFrameCount(30), 0);
        },
    },
    {
        label: "every sea picture is an https URL, and the gstatic thumbnails are gone",
        fn: () => {
            assert.ok(SEA_PICTURES.length > 0);
            for (const url of SEA_PICTURES) {
                assert.match(url, /^https:\/\//, `${url} is not https`);
                assert.ok(
                    !url.includes("gstatic.com"),
                    "a Google image thumbnail survived — those links are not stable",
                );
            }
            assert.ok(SEA_PICTURES.includes(seaPicture(() => 0)));
        },
    },
    {
        label: "summariseCatch groups by fish and sorts by what it earned",
        fn: () => {
            const summary = summariseCatch([
                { fish_key: "Nothing", display_name: "Nothing", tier: 0, price: 0 },
                { fish_key: "Squid", display_name: "Squid", tier: 2, price: 8 },
                { fish_key: "Squid", display_name: "Squid", tier: 2, price: 8 },
                { fish_key: "Nothing", display_name: "Nothing", tier: 0, price: 0 },
                { fish_key: "Nothing", display_name: "Nothing", tier: 0, price: 0 },
            ]);

            assert.equal(summary.length, 2);
            assert.equal(summary[0].fish_key, "Squid", "the earner should sort first");
            assert.equal(summary[0].count, 2);
            assert.equal(summary[0].earned, 16);
            assert.equal(summary[1].fish_key, "Nothing");
            assert.equal(summary[1].count, 3);
            assert.equal(summary[1].earned, 0);
        },
    },
];
