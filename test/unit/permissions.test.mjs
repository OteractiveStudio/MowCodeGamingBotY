/**
 * Unit: who counts as a bot admin.
 *
 * ⚠️ This replaces the legacy's worst identity decision. `is_admin` read
 * `players_inv.json → info.is_admin`, a field on a PLAYER ROW that `reset_player` could wipe — so a
 * data reset could strip or grant admin without anyone touching an admin list. Admin identity now
 * lives in `config.json`, which is a file only someone with the machine can edit.
 */

import assert from "node:assert/strict";

import { isBotAdmin, botAdminIds } from "../../app/bot/permissions.js";

const OTE = "403536649222356992";
const OTED = "880012304740126720";
const STRANGER = "111111111111111111";

const config = { bot: { admin_ids: [OTE, OTED] } };

export default [
    {
        label: "the legacy admin_list ids are recognised",
        fn: () => {
            // These are the two ids from his settings.json admin_list.
            assert.equal(isBotAdmin(config, OTE), true);
            assert.equal(isBotAdmin(config, OTED), true);
            assert.equal(isBotAdmin(config, STRANGER), false);
        },
    },
    {
        label: "ids compare as strings, so a numeric id still matches",
        fn: () => {
            // Discord ids exceed 2^53, so anything numeric here would already be corrupted — but a
            // caller passing a number must not silently fail the check.
            assert.equal(isBotAdmin({ bot: { admin_ids: [123] } }, "123"), true);
            assert.equal(isBotAdmin({ bot: { admin_ids: ["123"] } }, 123), true);
        },
    },
    {
        label: "🔑 no admin list means NOBODY is an admin — it never defaults open",
        fn: () => {
            // The dangerous failure would be treating "unconfigured" as "everyone".
            assert.equal(isBotAdmin({}, OTE), false);
            assert.equal(isBotAdmin({ bot: {} }, OTE), false);
            assert.equal(isBotAdmin({ bot: { admin_ids: [] } }, OTE), false);
            assert.equal(isBotAdmin(null, OTE), false);
            assert.equal(isBotAdmin({ bot: { admin_ids: "not-an-array" } }, OTE), false);
        },
    },
    {
        label: "an undefined user is not an admin",
        fn: () => {
            assert.equal(isBotAdmin(config, undefined), false);
            assert.equal(isBotAdmin(config, null), false);
            assert.equal(isBotAdmin(config, ""), false);
        },
    },
    {
        label: "botAdminIds always returns an array, so callers need no guard",
        fn: () => {
            assert.deepEqual(botAdminIds(config), [OTE, OTED]);
            assert.deepEqual(botAdminIds({}), []);
            assert.deepEqual(botAdminIds(null), []);
        },
    },
];
