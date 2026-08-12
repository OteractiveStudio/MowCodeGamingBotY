/**
 * Unit: the published-command drift check.
 *
 * ⚠️ THE FIRST TEST IS THE IMPORTANT ONE. Discord returns fields we never sent (`id`,
 * `application_id`, `version`, `nsfw`, normalised `contexts`) and omits defaults we did
 * send (`required: false`). If the comparison reported drift on those, it would warn on
 * every boot — and a check that always complains is a check nobody reads. That is the
 * instrument lying about the subject, so the no-false-alarm case is asserted before any
 * real difference is.
 */

import assert from "node:assert/strict";

import { diffCommands, normaliseCommand, describeDifference } from "../../app/bot/registry.js";

/** What `SlashCommandBuilder.toJSON()` gives us for /money. */
const localMoney = {
    name: "money",
    description: "Coins: check a balance, give some away, or read the ledger.",
    options: [
        {
            type: 1,
            name: "balance",
            description: "How many coins you (or someone else) have.",
            options: [
                { type: 6, name: "player", description: "Whose balance to check. Defaults to you." },
            ],
        },
        {
            type: 1,
            name: "give",
            description: "Give some of your coins to another player.",
            options: [
                { type: 6, name: "player", description: "Who receives the coins.", required: true },
                {
                    type: 4,
                    name: "amount",
                    description: "How many coins to give.",
                    required: true,
                    min_value: 1,
                },
            ],
        },
    ],
};

/** The same command as Discord hands it back: extra fields, omitted defaults. */
const remoteMoney = {
    id: "1234567890123456789",
    application_id: "892820973030637608",
    version: "1234567890123456790",
    type: 1,
    nsfw: false,
    default_member_permissions: null,
    contexts: [0, 1, 2],
    integration_types: [0],
    name: "money",
    description: "Coins: check a balance, give some away, or read the ledger.",
    options: [
        {
            type: 1,
            name: "balance",
            description: "How many coins you (or someone else) have.",
            options: [
                { type: 6, name: "player", description: "Whose balance to check. Defaults to you." },
            ],
        },
        {
            type: 1,
            name: "give",
            description: "Give some of your coins to another player.",
            options: [
                { type: 6, name: "player", description: "Who receives the coins.", required: true },
                {
                    type: 4,
                    name: "amount",
                    description: "How many coins to give.",
                    required: true,
                    min_value: 1,
                },
            ],
        },
    ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export default [
    {
        label: "🔑 the same command, as Discord returns it, reports IN SYNC — no false alarm",
        fn: () => {
            const diff = diffCommands([localMoney], [remoteMoney]);
            assert.equal(
                diff.inSync,
                true,
                `false drift reported: ${JSON.stringify({ ...diff, inSync: undefined })}`,
            );
            assert.equal(diff.missing.length, 0);
            assert.equal(diff.extra.length, 0);
            assert.equal(diff.changed.length, 0);
        },
    },
    {
        label: "Discord's extra fields and normalised contexts are ignored entirely",
        fn: () => {
            const normalised = normaliseCommand(remoteMoney);
            assert.deepEqual(Object.keys(normalised).sort(), ["description", "name", "options"]);
            assert.equal(normalised.contexts, undefined);
            assert.equal(normalised.nsfw, undefined);
            assert.equal(normalised.id, undefined);
        },
    },
    {
        label: "an omitted `required` and an explicit `required: false` are the same thing",
        fn: () => {
            const explicit = clone(localMoney);
            explicit.options[0].options[0].required = false;
            const diff = diffCommands([explicit], [remoteMoney]);
            assert.equal(diff.inSync, true, "an explicit default was treated as a change");
        },
    },
    {
        label: "a command in the code but not on Discord is reported as MISSING",
        fn: () => {
            const diff = diffCommands([localMoney, { name: "steal", description: "rob someone" }], [
                remoteMoney,
            ]);
            assert.equal(diff.inSync, false);
            assert.deepEqual(diff.missing, ["steal"]);
            assert.equal(diff.extra.length, 0);
        },
    },
    {
        label: "a command on Discord but not in the code is reported as EXTRA",
        fn: () => {
            const diff = diffCommands([], [remoteMoney]);
            assert.equal(diff.inSync, false);
            assert.deepEqual(diff.extra, ["money"]);
            assert.equal(diff.missing.length, 0);
        },
    },
    {
        label: "a changed description is caught, and the reason says so",
        fn: () => {
            const edited = clone(localMoney);
            edited.description = "Coins, and where they came from.";
            const diff = diffCommands([edited], [remoteMoney]);
            assert.equal(diff.changed.length, 1);
            assert.equal(diff.changed[0].name, "money");
            assert.match(diff.changed[0].reason, /description differs/);
        },
    },
    {
        label: "a NEW option — the exact mistake this check exists for — is caught by name",
        fn: () => {
            // The realistic case: you add an option to a subcommand and forget to
            // re-register, so it silently never appears for anyone.
            const edited = clone(localMoney);
            edited.options[1].options.push({
                type: 3,
                name: "note",
                description: "Say why.",
            });
            const diff = diffCommands([edited], [remoteMoney]);
            assert.equal(diff.inSync, false);
            assert.match(diff.changed[0].reason, /under "give"/);
            assert.match(diff.changed[0].reason, /option count differs/);
        },
    },
    {
        label: "a flipped required, a changed min_value and a toggled autocomplete are all caught",
        fn: () => {
            const required = clone(localMoney);
            required.options[1].options[0].required = false;
            assert.match(
                diffCommands([required], [remoteMoney]).changed[0].reason,
                /required differs/,
            );

            const bounds = clone(localMoney);
            bounds.options[1].options[1].min_value = 5;
            assert.match(diffCommands([bounds], [remoteMoney]).changed[0].reason, /min\/max differs/);

            const auto = clone(localMoney);
            auto.options[1].options[0].autocomplete = true;
            assert.match(
                diffCommands([auto], [remoteMoney]).changed[0].reason,
                /autocomplete differs/,
            );
        },
    },
    {
        label: "a renamed subcommand is reported with both names",
        fn: () => {
            const renamed = clone(localMoney);
            renamed.options[0].name = "bal";
            const reason = diffCommands([renamed], [remoteMoney]).changed[0].reason;
            assert.match(reason, /"bal" in code/);
            assert.match(reason, /"balance" on Discord/);
        },
    },
    {
        label: "changed choices are caught",
        fn: () => {
            const local = {
                name: "x",
                description: "d",
                options: [
                    {
                        type: 3,
                        name: "mode",
                        description: "m",
                        choices: [{ name: "Auto", value: "auto" }],
                    },
                ],
            };
            const remote = clone(local);
            remote.options[0].choices = [{ name: "Auto", value: "auto" }, { name: "One", value: "one" }];
            assert.match(describeDifference(normaliseCommand(local), normaliseCommand(remote)), /choices differ/);
        },
    },
    {
        label: "an empty list on both sides is in sync, not a failure",
        fn: () => {
            const diff = diffCommands([], []);
            assert.equal(diff.inSync, true);
        },
    },
];
