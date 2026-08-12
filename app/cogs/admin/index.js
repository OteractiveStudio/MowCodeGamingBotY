/**
 * app/cogs/admin/index.js — `/admin`, the bot owner's tools.
 *
 * Descended from his `data_editor_cog` (`data fish|player read|set|reset`), `status_stats_cog`
 * (`stats`) and the admin-gated half of `server_settings_cog`.
 *
 * ⭐ EVERY COMMAND HERE IS GATED BY `config.bot.admin_ids`, checked ONCE at the top of dispatch
 * below rather than per-branch. His `data` command re-read `is_admin` and re-tested it in each
 * branch — and **his `file` command forgot to test it at all** (see the ❌ list). One gate that
 * every path goes through is the only shape that cannot be forgotten in a new branch.
 *
 * ⭐ INSPECTIONS ARE PRIVATE, CHANGES ARE ANNOUNCED. The command defers **ephemerally**, so the
 * admin always gets a quiet reply — reads like `player`, `stats` and `cogs` are just noise to
 * everyone else. Mutations then post a **separate public message** through `announce()`, because
 * an admin silently moving coins or editing a fish price is exactly what an economy should not
 * allow. See the note on `defer` below for why it has to work that way round.
 *
 * ⭐ AND EVERY MUTATION IS ATTRIBUTED. `log_economy.actor_id` has existed since migration 002
 * and nothing has ever written it — this is what it was for. An `admin_adjust` row now records
 * **who** made the change as well as what changed, so "where did these coins come from?" has an
 * answer that names a person.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ❌ THREE OF HIS ADMIN FEATURES ARE DELIBERATELY NOT PORTED
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. ❌ **THE FILE EXPLORER (`file_explorer_cog`).** It listed a directory on the bot host into
 *    a channel and uploaded any file from it, and:
 *      · **it had NO admin check whatsoever** — every other admin feature tested `is_admin`;
 *        this one did not, so anyone in any of the twelve servers could use it;
 *      · `if arg in "..."` is a **substring test against the literal string `"..."`**, so `""`,
 *        `"."`, `".."` and `"..."` all matched and an empty argument walked the path upward;
 *      · `file_location` was a **class attribute mutated in place**, so one person's `cd`
 *        changed the directory for every user in every server;
 *      · the "is the new directory real" guard ran `os.listdir(self.file_location)` — the OLD
 *        path — so it validated the wrong thing.
 *    Even gated to admins, "read arbitrary files off the host into a chat message" is not a
 *    feature worth rebuilding. If a file needs to reach Discord, that is a deliberate upload,
 *    not a browsable filesystem. **This is a security decision, not an oversight** — it is
 *    written down here so nobody ports it later thinking it was simply missed.
 *
 * 2. ❌ **`data player reset all`.** His confirmed it with a random integer typed back, which is
 *    the right instinct, but wiping every player from a chat message is a footgun with no undo.
 *    `DevTools/maintenance/reset-players.mjs` does it properly — dry-run by default, prints who
 *    it will delete, and **writes a backup outside the repo first**. Per-player reset IS here.
 *
 * 3. ❌ **COG RELOAD/UNLOAD.** `list` is here; reload is not. His ran on `discord.py`'s
 *    `load_extension`, which could drop and re-import a module. **ES modules cache by URL and
 *    that cache cannot be invalidated**, so a "reload" would import nothing new and report
 *    success — worse than not having it. Restarting is the honest answer.
 */

import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    InteractionContextType,
} from "discord.js";
import { QueryTypes } from "sequelize";

import { respond } from "../../bot/respond.js";
import { isBotAdmin, botAdminIds } from "../../bot/permissions.js";
import { ensurePlayer, getPlayerWithState } from "../../data/player.js";
import { addMoney, getState, toInt, expCap } from "../../data/economy.js";
import { getInventory } from "../../data/inventory.js";

const COIN = "🪙";

/** His provisioning defaults, from the SQL in `ensurePlayer`. A reset returns a player to these. */
const PROVISION_DEFAULTS = { money: 200, fishing_rod: 10, inventory_size: 1, exp: 0, level: 1, magical_crystal: 0, fishing_count: 0 };

/** Which fish fields his `data fish set` allowed. Kept exactly — price and tier, nothing else. */
const FISH_FIELDS = ["price", "tier"];

export default {
    name: "admin",
    description: "Bot owner tools. Gated by config.bot.admin_ids.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("admin")
                .setDescription("Bot owner tools.")
                .setContexts(InteractionContextType.Guild)
                .addSubcommand((sub) =>
                    sub
                        .setName("money")
                        .setDescription("Adjust a player's balance. Recorded against your name.")
                        .addUserOption((o) => o.setName("player").setDescription("Who.").setRequired(true))
                        .addIntegerOption((o) =>
                            o
                                .setName("amount")
                                .setDescription("How much to add. Negative to take away.")
                                .setRequired(true),
                        )
                        .addStringOption((o) =>
                            o.setName("note").setDescription("Why — goes in the ledger.").setRequired(false),
                        )
                        .addBooleanOption((o) =>
                            o
                                .setName("grant_exp")
                                .setDescription("Also grant exp equal to the amount? Default: NO.")
                                .setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("player")
                        .setDescription("Everything the database knows about a player.")
                        .addUserOption((o) => o.setName("player").setDescription("Who.").setRequired(true)),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("reset")
                        .setDescription("Return ONE player to starting values. Asks first.")
                        .addUserOption((o) => o.setName("player").setDescription("Who.").setRequired(true)),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("fish")
                        .setDescription("Change a fish's price or tier.")
                        .addStringOption((o) =>
                            o.setName("fish").setDescription("Which fish.").setRequired(true).setAutocomplete(true),
                        )
                        .addStringOption((o) =>
                            o
                                .setName("field")
                                .setDescription("What to change.")
                                .setRequired(true)
                                .addChoices(
                                    { name: "price — what it sells for", value: "price" },
                                    { name: "tier — rarity, weight is 10 - tier", value: "tier" },
                                ),
                        )
                        .addIntegerOption((o) =>
                            o.setName("value").setDescription("The new value.").setRequired(true).setMinValue(0),
                        ),
                )
                .addSubcommand((sub) => sub.setName("stats").setDescription("Bot and database health."))
                .addSubcommand((sub) => sub.setName("cogs").setDescription("What is loaded right now.")),

            /**
             * ⭐ EPHEMERAL AT DEFER TIME, WHICH IS THE ONLY TIME IT CAN BE DECIDED.
             *
             * ⚠️ This is here because I got it wrong first. `dispatch.js` defers every chat-input
             * command before calling it, and `editReply()` **cannot change ephemerality after the
             * fact** — so `respond(..., { flags: Ephemeral })` is silently dropped and the reply
             * comes out PUBLIC. `respond.js` even documents that, and a passing test caught it
             * anyway: a `flags` argument that does nothing is worse than none.
             *
             * So the whole command defers privately, and the mutations post their public record
             * with an explicit `channel.send()` — see `announce()`. The admin gets a quiet
             * confirmation; the channel gets the accountability.
             */
            defer: "ephemeral",

            async autocomplete(interaction, ctx) {
                // ⚠️ Autocomplete is NOT gated — it cannot be, because Discord sends it before the
                // command runs and a non-admin cannot execute anything anyway. It only ever
                // reveals fish names, which /fishing rates already shows publicly.
                const typed = interaction.options.getFocused().trim().toLowerCase();
                const rows = await ctx.db.sequelize.query(
                    `SELECT fish_key, display_name FROM ${ctx.db.schema}.mst_fish
                      WHERE lower(fish_key) LIKE :like ORDER BY fish_key LIMIT 25`,
                    { replacements: { like: `%${typed}%` }, type: QueryTypes.SELECT },
                );
                await interaction.respond(
                    rows.map((row) => ({ name: row.display_name ?? row.fish_key, value: row.fish_key })),
                );
            },

            async execute(interaction, ctx) {
                // ⭐ THE ONE GATE. Every subcommand passes through here.
                if (!isBotAdmin(ctx.config, interaction.user.id)) {
                    await refuse(interaction, ctx);
                    return;
                }

                const sub = interaction.options.getSubcommand();
                if (sub === "money") return adjustMoney(interaction, ctx);
                if (sub === "player") return showPlayer(interaction, ctx);
                if (sub === "reset") return askReset(interaction, ctx);
                if (sub === "fish") return setFish(interaction, ctx);
                if (sub === "stats") return showStats(interaction, ctx);
                return showCogs(interaction, ctx);
            },
        },
    ],

    events: [],

    async handleComponent(interaction, ctx) {
        const [, action, argument] = String(interaction.customId).split(":");

        // ⚠️ RE-CHECKED on the click, not trusted from the button's existence. A customId is
        // client-supplied data: anyone who can see the message can send its id back.
        if (!isBotAdmin(ctx.config, interaction.user.id)) {
            await respond(interaction, {
                content: "That control is not yours.",
            });
            return;
        }

        if (action === "reset-confirm") return doReset(interaction, ctx, argument);
        if (action === "reset-cancel") {
            await interaction.update({
                content: "Cancelled. Nothing was changed.",
                embeds: [],
                components: [],
            });
            return;
        }

        await respond(interaction, {
            content: "That control isn't one I recognise.",
        });
    },
};

/**
 * Refuse, and say who CAN do it.
 *
 * ⚠️ Logged at `warning`. Someone probing the admin commands is worth seeing in a log, and his
 * version refused silently from four different branches.
 */
async function refuse(interaction, ctx) {
    const admins = botAdminIds(ctx.config);

    await respond(interaction, {
        content:
            "**That is an owner command.**" +
            (admins.length > 0
                ? ` Ask one of: ${admins.map((id) => `<@${id}>`).join(", ")}.`
                : " No bot admins are configured, so nobody can run it — set `bot.admin_ids` in `config.json`."),
    });

    await ctx.log(
        `admin: ${interaction.user.id} tried /admin ${interaction.options.getSubcommand()} and is not an admin`,
        "warning",
        import.meta.url,
    );
}

/**
 * Post a mutation to the channel, publicly.
 *
 * ⚠️ `channel.send()` rather than `followUp()` on purpose. The command's reply is ephemeral, and
 * a follow-up to an ephemeral interaction inherits that privacy — which would make the "public
 * record" invisible to everyone but the admin, i.e. exactly not a record. An explicit channel
 * send cannot be wrong about who sees it.
 *
 * ⚠️ A failure here is LOGGED, never swallowed. The mutation has already happened; if the channel
 * post fails the accountability trail is thinner and somebody should be able to find out why.
 * A silent `.catch(() => {})` in this position is the legacy's `except: pass` habit.
 */
async function announce(interaction, ctx, embed) {
    try {
        await interaction.channel.send({ embeds: [embed] });
        return true;
    } catch (err) {
        await ctx.log(
            `admin: the change was made but could not be announced in ${interaction.channelId} — ${err.message}`,
            "warning",
            import.meta.url,
        );
        return false;
    }
}

// ── money ────────────────────────────────────────────────────────────────────

async function adjustMoney(interaction, ctx) {
    const target = interaction.options.getUser("player");
    const amount = interaction.options.getInteger("amount");
    const note = interaction.options.getString("note") ?? null;
    const grantExp = interaction.options.getBoolean("grant_exp") ?? false;

    if (amount === 0) {
        await respond(interaction, {
            content: "**Zero changes nothing.** Pick an amount.",
        });
        return;
    }

    await ensurePlayer(ctx.db, target);
    const before = toInt((await getState(ctx.db, target.id)).money, "money");

    const result = await addMoney(ctx.db, {
        discordId: target.id,
        amount,
        reason: "admin_adjust",
        // ⚠️ NO EXP BY DEFAULT. His `money_add` always granted exp equal to the money, so an
        // admin topping someone up by 10,000 would have handed them ~13 levels as a side effect.
        // Opt in with grant_exp:true if that is genuinely what you want.
        expDelta: grantExp ? amount : 0,
        ref: note ? `admin:${note}`.slice(0, 200) : "admin",
        guildId: interaction.guildId,
        // ⭐ THE POINT. This column has existed unused since migration 002.
        actorId: interaction.user.id,
    });

    const embed = new EmbedBuilder()
        .setColor(amount > 0 ? 0x2ecc71 : 0xe67e22)
        .setTitle("⚙️ Balance adjusted")
        .setDescription(
            `${target} ${amount > 0 ? "received" : "lost"} ${COIN} **${Math.abs(amount)}**, ` +
            `by ${interaction.user}.`,
        )
        .addFields(
            { name: "Before", value: `${COIN} ${before}`, inline: true },
            { name: "After", value: `${COIN} **${result.money}**`, inline: true },
            { name: "Exp", value: grantExp ? `+${amount}` : "unchanged", inline: true },
        )
        .setFooter({ text: "Recorded in the ledger as admin_adjust, against the admin's own id." });

    if (note) embed.addFields({ name: "Note", value: note });

    const announced = await announce(interaction, ctx, embed);
    await respond(interaction, {
        content: announced
            ? `Done — ${target} is now on ${COIN} **${result.money}**. Posted in the channel.`
            : `Done — ${target} is now on ${COIN} **${result.money}**. ⚠️ Could not post it publicly; it is in the log.`,
        embeds: [embed],
    });

    await ctx.log(
        `admin: ${interaction.user.id} adjusted ${target.id} by ${amount} ` +
        `(${before} -> ${result.money})${grantExp ? " WITH exp" : ""}${note ? ` — ${note}` : ""}`,
        "warning",
        import.meta.url,
    );
}

// ── player ───────────────────────────────────────────────────────────────────

async function showPlayer(interaction, ctx) {
    const target = interaction.options.getUser("player");
    const row = await getPlayerWithState(ctx.db, target.id);

    if (!row) {
        await respond(interaction, {
            content: `**${target.tag ?? target.username} has never used the bot** — no row exists.`,
        });
        return;
    }

    const items = await getInventory(ctx.db, target.id);

    const [ledger] = await ctx.db.sequelize.query(
        `SELECT count(*)::int AS rows,
                coalesce(sum(money_delta), 0)::bigint AS net,
                min(occurred_on) AS first_seen,
                max(occurred_on) AS last_seen
           FROM ${ctx.db.schema}.log_economy WHERE discord_id = :id`,
        { replacements: { id: String(target.id) }, type: QueryTypes.SELECT },
    );

    const money = toInt(row.money, "money");
    const cap = expCap(Number(row.level), Number(row.magical_crystal));

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`⚙️ ${row.username ?? target.username}`)
        .setThumbnail(target.displayAvatarURL?.() ?? null)
        .addFields(
            {
                name: "Identity",
                value: [
                    `id \`${row.discord_id}\``,
                    `username \`${row.username ?? "—"}\``,
                    `global_name \`${row.global_name ?? "—"}\``,
                    `bot \`${row.is_bot}\``,
                ].join("\n"),
                inline: true,
            },
            {
                name: "Economy",
                value: [
                    `${COIN} **${money}**`,
                    `exp **${row.exp}** / ${cap}`,
                    `level **${row.level}**`,
                    `💎 **${row.magical_crystal}**`,
                ].join("\n"),
                inline: true,
            },
            {
                name: "Game",
                value: [
                    `rods **${row.fishing_rod}**`,
                    `slots **${row.inventory_size}**`,
                    `catches **${row.fishing_count}**`,
                    `last steal \`${row.last_steal_at ?? "never"}\``,
                ].join("\n"),
                inline: true,
            },
            {
                name: "Inventory",
                value: items.length > 0 ? items.map((i) => `${i.item_key} ×${i.quantity}`).join(", ") : "_empty_",
            },
            {
                name: "Ledger",
                value:
                    `**${ledger.rows}** rows, net ${COIN} **${ledger.net}**\n` +
                    `first \`${ledger.first_seen ?? "—"}\`\nlast \`${ledger.last_seen ?? "—"}\``,
            },
        )
        .setFooter({ text: `first seen ${row.first_seen_at} · last seen ${row.last_seen_at}` });

    // ⚠️ A mismatch here means something wrote money outside app/data/economy.js.
    const net = toInt(ledger.net, "net");
    if (ledger.rows > 0 && net !== money) {
        embed.addFields({
            name: "⚠️ The ledger does not reconcile",
            value: `Ledger sums to **${net}** but the balance is **${money}**. Something wrote money outside the economy module.`,
        });
    }

    await respond(interaction, { embeds: [embed] });
}

// ── reset ────────────────────────────────────────────────────────────────────

/**
 * Ask before resetting.
 *
 * ⭐ His confirmation was a random integer the admin had to type back
 * (`data player reset all 417`). Same instinct, better mechanism: the target is encoded in the
 * button's customId, so there is **no pending-confirmation state to strand** — which is the bug
 * that dogged his market's reaction flow.
 */
async function askReset(interaction, ctx) {
    const target = interaction.options.getUser("player");
    const row = await getPlayerWithState(ctx.db, target.id);

    if (!row) {
        await respond(interaction, {
            content: `**${target.username} has no row to reset.**`,
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("⚠️ Reset this player?")
        .setDescription(
            `${target} goes back to starting values. **Their ledger history is kept** — the reset ` +
            "is written as one more entry, so it stays explainable.",
        )
        .addFields(
            {
                name: "Now",
                value: `${COIN} ${row.money} · level ${row.level} · ${row.fishing_count} catches · ${row.fishing_rod} rods`,
            },
            {
                name: "After",
                value:
                    `${COIN} ${PROVISION_DEFAULTS.money} · level ${PROVISION_DEFAULTS.level} · ` +
                    `0 catches · ${PROVISION_DEFAULTS.fishing_rod} rods · items cleared`,
            },
        )
        .setFooter({ text: "To clear EVERY player, use DevTools/maintenance/reset-players.mjs — it takes a backup." });

    await respond(interaction, {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`admin:reset-confirm:${target.id}`)
                    .setLabel("Reset them")
                    .setEmoji("♻️")
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("admin:reset-cancel")
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Secondary),
            ),
        ],
    });

    void ctx;
}

async function doReset(interaction, ctx, targetId) {
    if (!/^[0-9]{1,32}$/.test(String(targetId ?? ""))) {
        await respond(interaction, {
            content: "That button carried a target I cannot read.",
        });
        return;
    }

    const state = await getState(ctx.db, targetId);
    if (!state) {
        await interaction.update({ content: "That player no longer has a row.", embeds: [], components: [] });
        return;
    }

    const money = toInt(state.money, "money");
    const delta = PROVISION_DEFAULTS.money - money;

    // ⚠️ ONE TRANSACTION, and the money moves through addMoney so the ledger keeps its chain.
    // Writing the state directly would leave `explainBalance()` reporting the player as broken —
    // which is exactly the mistake the retired legacy importer made.
    await ctx.db.sequelize.transaction(async (transaction) => {
        await addMoney(ctx.db, {
            discordId: targetId,
            amount: delta,
            reason: "admin_adjust",
            expDelta: 0,
            ref: "admin:reset",
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            transaction,
        });

        // Everything that is not money. The exp/level/crystal reset happens here rather than
        // through the cascade, because a reset is not a progression event.
        await ctx.db.sequelize.query(
            `UPDATE ${ctx.db.schema}.mst_player_state
                SET exp = :exp, level = :level, magical_crystal = :crystal,
                    fishing_rod = :rods, inventory_size = :slots, fishing_count = :catches,
                    last_steal_at = NULL, updated_at = now()
              WHERE discord_id = :id`,
            {
                replacements: {
                    id: String(targetId),
                    exp: PROVISION_DEFAULTS.exp,
                    level: PROVISION_DEFAULTS.level,
                    crystal: PROVISION_DEFAULTS.magical_crystal,
                    rods: PROVISION_DEFAULTS.fishing_rod,
                    slots: PROVISION_DEFAULTS.inventory_size,
                    catches: PROVISION_DEFAULTS.fishing_count,
                },
                transaction,
            },
        );

        await ctx.db.sequelize.query(
            `DELETE FROM ${ctx.db.schema}.mst_player_item WHERE discord_id = :id`,
            { replacements: { id: String(targetId) }, transaction },
        );
    });

    const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle("♻️ Player reset")
        .setDescription(
            `<@${targetId}> is back to starting values, by ${interaction.user}.\n` +
            `Balance ${COIN} ${money} → ${COIN} **${PROVISION_DEFAULTS.money}**, items cleared.`,
        )
        .setFooter({ text: "Their ledger history is intact — the reset is one more admin_adjust row." });

    await interaction.update({ embeds: [embed], components: [] });

    // ⭐ Announced in the channel too — the confirmation above is ephemeral, and a reset is
    // exactly the kind of change that must not be invisible to the person it happened to.
    await announce(interaction, ctx, embed);

    await ctx.log(
        `admin: ${interaction.user.id} RESET player ${targetId} (was ${money} coins)`,
        "warning",
        import.meta.url,
    );
}

// ── fish ─────────────────────────────────────────────────────────────────────

async function setFish(interaction, ctx) {
    const key = interaction.options.getString("fish");
    const field = interaction.options.getString("field");
    const value = interaction.options.getInteger("value");

    if (!FISH_FIELDS.includes(field)) {
        await respond(interaction, {
            content: `**You can only set ${FISH_FIELDS.join(" or ")}** — his rule.`,
        });
        return;
    }

    // ⚠️ Tier is bounded 0-9 in SQL because the draw weight is `10 - tier`: tier 10 would be
    // undrawable and tier 11 would subtract from the pool. Caught here with an explanation
    // rather than as a raw constraint violation.
    if (field === "tier" && (value < 0 || value > 9)) {
        await respond(interaction, {
            content:
                "**Tier must be 0-9.** The draw weight is `10 - tier`, so tier 10 could never be " +
                "caught and tier 11 would take weight away from the pool.",
        });
        return;
    }

    const rows = await ctx.db.sequelize.query(
        `UPDATE ${ctx.db.schema}.mst_fish
            SET ${field === "price" ? "price" : "tier"} = :value, updated_at = now()
          WHERE fish_key = :key
      RETURNING fish_key, display_name, price, tier`,
        { replacements: { key, value }, type: QueryTypes.SELECT },
    );

    if (rows.length === 0) {
        await respond(interaction, {
            content: `**No fish called \`${key}\`.** Try the autocomplete.`,
        });
        return;
    }

    const fish = rows[0];
    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("⚙️ Fish updated")
        .setDescription(`**${fish.display_name ?? fish.fish_key}** — \`${field}\` is now **${value}**.`)
        .addFields(
            { name: "Price", value: `${COIN} ${fish.price}`, inline: true },
            { name: "Tier", value: `${fish.tier} (weight ${10 - Number(fish.tier)})`, inline: true },
        )
        .setFooter({ text: `Changed by ${interaction.user.username}. Takes effect on the next cast.` });

    const announced = await announce(interaction, ctx, embed);
    await respond(interaction, {
        content: announced
            ? "Done, and posted in the channel."
            : "Done. ⚠️ Could not post it publicly; it is in the log.",
        embeds: [embed],
    });

    await ctx.log(
        `admin: ${interaction.user.id} set fish ${key}.${field} = ${value}`,
        "warning",
        import.meta.url,
    );
}

// ── stats ────────────────────────────────────────────────────────────────────

async function showStats(interaction, ctx) {
    const [counts] = await ctx.db.sequelize.query(
        `SELECT (SELECT count(*)::int FROM ${ctx.db.schema}.mst_player) AS players,
                (SELECT count(*)::int FROM ${ctx.db.schema}.mst_player_state WHERE money < 0) AS in_debt,
                (SELECT coalesce(sum(money), 0)::bigint FROM ${ctx.db.schema}.mst_player_state) AS coins,
                (SELECT count(*)::int FROM ${ctx.db.schema}.log_economy) AS ledger_rows,
                (SELECT count(*)::int FROM ${ctx.db.schema}.mst_player_item) AS item_rows,
                (SELECT count(*)::int FROM ${ctx.db.schema}.txn_purchase) AS purchases,
                (SELECT count(*)::int FROM ${ctx.db.schema}.mst_wordle_word) AS words,
                (SELECT count(*)::int FROM ${ctx.db.schema}.mst_guild) AS guilds_known`,
        { type: QueryTypes.SELECT },
    );

    const byReason = await ctx.db.sequelize.query(
        `SELECT reason, count(*)::int AS n, coalesce(sum(money_delta), 0)::bigint AS net
           FROM ${ctx.db.schema}.log_economy
          GROUP BY reason ORDER BY n DESC LIMIT 12`,
        { type: QueryTypes.SELECT },
    );

    const uptimeMs = ctx.client?.uptime ?? 0;
    const hours = Math.floor(uptimeMs / 3600000);
    const minutes = Math.floor((uptimeMs % 3600000) / 60000);

    const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("⚙️ Bot and database")
        .addFields(
            {
                name: "Bot",
                value: [
                    `guilds **${ctx.client?.guilds?.cache?.size ?? "?"}** (${counts.guilds_known} registered)`,
                    `uptime **${hours}h ${minutes}m**`,
                    `cogs **${ctx.cogs?.length ?? "?"}** · commands **${ctx.commands?.size ?? "?"}**`,
                    `ws ping **${Math.round(ctx.client?.ws?.ping ?? -1)}ms**`,
                ].join("\n"),
                inline: true,
            },
            {
                name: "Players",
                value: [
                    `rows **${counts.players}**`,
                    `in debt **${counts.in_debt}**`,
                    `coins in circulation ${COIN} **${counts.coins}**`,
                    `item rows **${counts.item_rows}**`,
                ].join("\n"),
                inline: true,
            },
            {
                name: "Records",
                value: [
                    `ledger **${counts.ledger_rows}**`,
                    `purchases **${counts.purchases}**`,
                    `wordle words **${counts.words}**`,
                ].join("\n"),
                inline: true,
            },
        );

    if (byReason.length > 0) {
        embed.addFields({
            name: "Where the money moved",
            value: byReason
                .map((r) => `\`${String(r.reason).padEnd(16)}\` ${String(r.n).padStart(5)} rows · net ${r.net}`)
                .join("\n"),
        });
    }

    embed.setFooter({ text: `schema ${ctx.db.schema}` });

    await respond(interaction, { embeds: [embed] });
}

// ── cogs ─────────────────────────────────────────────────────────────────────

async function showCogs(interaction, ctx) {
    const cogs = ctx.cogs ?? [];

    const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("⚙️ Loaded cogs")
        .setDescription(
            cogs.length > 0
                ? cogs
                      .map((cog) => {
                          const names = (cog.commands ?? []).map((c) => `/${c.data.name}`).join(" ");
                          const bits = [];
                          if ((cog.events ?? []).length > 0) bits.push(`${cog.events.length} event(s)`);
                          if (typeof cog.handleComponent === "function") bits.push("components");
                          return `**${cog.name}** — ${names || "_no commands_"}${bits.length ? ` · ${bits.join(", ")}` : ""}`;
                      })
                      .join("\n")
                : "_none loaded, which should be impossible_",
        )
        .setFooter({
            text:
                "Reload is not offered: ES modules cache by URL and the cache cannot be " +
                "invalidated, so a reload would import nothing and claim success. Restart instead.",
        });

    await respond(interaction, { embeds: [embed] });
}
