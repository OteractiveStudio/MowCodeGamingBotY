/**
 * app/cogs/steal/index.js — `/steal`, the command that makes five shop items real.
 *
 * Rules and reasoning live in `app/data/steal.js`. This file is the Discord surface and the one
 * transaction that moves the coins.
 *
 * ⭐ Public on purpose, like his was: the legacy announced the theft with
 * `"{victim} Your {n} BezCoin(s) has been stolen by {thief}!"` — pinging the victim in the channel.
 * Getting robbed quietly is not a game, so the announcement stays.
 */

import { SlashCommandBuilder, EmbedBuilder, MessageFlags, InteractionContextType } from "discord.js";
import { QueryTypes } from "sequelize";

import { respond } from "../../bot/respond.js";
import { ensurePlayer } from "../../data/player.js";
import { getState, addMoney, toInt } from "../../data/economy.js";
import { getInventory } from "../../data/inventory.js";
import {
    STEAL_TOOLS,
    STEAL_DEFENCES,
    STEAL_RULES,
    toolFor,
    validateSteal,
    resolveSteal,
    successChance,
    defencesAgainst,
    maxTakeable,
} from "../../data/steal.js";

const COIN = "🪙";

export default {
    name: "steal",
    description: "Rob someone, if you have the tools for it.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("steal")
                .setDescription("Try to take someone's coins. You need the right item.")
                .setContexts(InteractionContextType.Guild)
                .addUserOption((option) =>
                    option.setName("target").setDescription("Who to rob.").setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("tool")
                        .setDescription("What to use. It is consumed either way.")
                        .setRequired(true)
                        .addChoices(
                            { name: "🔑 Passkey — quiet, 35%", value: "passkey" },
                            { name: "🔪 Knife — 50%", value: "knife" },
                            { name: "🔫 Gun — 70%", value: "gun" },
                        ),
                ),

            async execute(interaction, ctx) {
                return attemptSteal(interaction, ctx);
            },
        },
        {
            data: new SlashCommandBuilder()
                .setName("crime")
                .setDescription("What the tools and the pets actually do.")
                .setContexts(InteractionContextType.Guild),

            async execute(interaction, ctx) {
                return explainCrime(interaction, ctx);
            },
        },
    ],

    events: [],
};

async function attemptSteal(interaction, ctx) {
    const victim = interaction.options.getUser("target");
    const toolKey = interaction.options.getString("tool");
    const tool = toolFor(toolKey);

    await ensurePlayer(ctx.db, interaction.user);
    if (!victim.bot) await ensurePlayer(ctx.db, victim);

    const thiefState = await getState(ctx.db, interaction.user.id);
    const victimState = victim.bot ? null : await getState(ctx.db, victim.id);
    const thiefItems = await getInventory(ctx.db, interaction.user.id);
    const held = thiefItems.find((item) => item.item_key === toolKey);

    const problem = validateSteal({
        thiefId: interaction.user.id,
        victimId: victim.id,
        victimIsBot: victim.bot,
        tool,
        heldQuantity: held?.quantity ?? 0,
        thiefMoney: toInt(thiefState.money, "money"),
        victimMoney: victimState ? toInt(victimState.money, "money") : 0,
        lastStealAt: thiefState.last_steal_at,
    });

    if (problem) {
        await respond(interaction, { content: `**${problem.message}.**`, flags: MessageFlags.Ephemeral });
        return;
    }

    const victimItems = (await getInventory(ctx.db, victim.id)).map((item) => item.item_key);

    const outcome = resolveSteal({
        thiefId: interaction.user.id,
        victimId: victim.id,
        tool,
        victimItems,
        thiefMoney: toInt(thiefState.money, "money"),
        victimMoney: toInt(victimState.money, "money"),
    });

    // ⚠️ ONE TRANSACTION: consume the tool, stamp the cooldown, move the coins, write the ledger.
    // A steal that took the coins but not the passkey — or the reverse — would be a free crime or a
    // stolen item with nothing to show. The legacy did each of these as its own whole-file rewrite.
    await ctx.db.sequelize.transaction(async (transaction) => {
        // The tool is spent whether or not the attempt worked. Failing still used it up.
        await ctx.db.sequelize.query(
            `UPDATE ${ctx.db.schema}.mst_player_item
                SET quantity = quantity - 1, updated_at = now()
              WHERE discord_id = :id AND item_key = :item`,
            { replacements: { id: String(interaction.user.id), item: toolKey }, transaction },
        );
        // A zero-quantity row is deleted, never stored — the CHECK in SQL requires it.
        await ctx.db.sequelize.query(
            `DELETE FROM ${ctx.db.schema}.mst_player_item
              WHERE discord_id = :id AND item_key = :item AND quantity <= 0`,
            { replacements: { id: String(interaction.user.id), item: toolKey }, transaction },
        );

        await ctx.db.sequelize.query(
            `UPDATE ${ctx.db.schema}.mst_player_state
                SET last_steal_at = now(), updated_at = now()
              WHERE discord_id = :id`,
            { replacements: { id: String(interaction.user.id) }, transaction },
        );

        for (const movement of outcome.movements) {
            await addMoney(ctx.db, {
                discordId: movement.discordId,
                amount: movement.amount,
                // Crime pays no exp: it is a transfer of someone else's work, and coupling exp to it
                // would make robbing a levelling strategy.
                expDelta: 0,
                reason: movement.reason,
                ref: `steal:${toolKey}`,
                guildId: interaction.guildId,
                actorId: String(interaction.user.id),
                transaction,
            });
        }
    });

    const embed = new EmbedBuilder().setColor(outcome.succeeded ? 0x00ff00 : 0xff0000);

    if (outcome.succeeded && outcome.amount > 0) {
        embed
            .setTitle("💰 Robbed!")
            .setDescription(
                `${interaction.user} ${tool.verb} ${victim} and took ${COIN} **${outcome.amount}**.\n` +
                `The ${toolKey} was used up.`,
            );
    } else if (outcome.succeeded) {
        embed
            .setTitle("Pockets empty")
            .setDescription(`${interaction.user} got in, but ${victim} had nothing worth taking.`);
    } else {
        const bail = outcome.movements[0]?.amount ?? 0;
        embed.setTitle("🚨 Caught!").setDescription(
            [
                `${interaction.user} tried to rob ${victim} and failed.`,
                outcome.defences.length > 0
                    ? `**${outcome.defences.map((d) => d.note).join(" and ")}.**`
                    : null,
                bail < 0 ? `Bail cost ${COIN} **${Math.abs(bail)}**.` : "No coins to post bail with.",
                `The ${toolKey} was used up anyway.`,
            ]
                .filter(Boolean)
                .join("\n"),
        );
    }

    embed.setFooter({
        text: `chance ${Math.round(outcome.chance * 100)}% · cooldown ${STEAL_RULES.COOLDOWN_MS / 60000} min`,
    });

    await respond(interaction, { embeds: [embed] });

    await ctx.log(
        `steal: ${interaction.user.id} used ${toolKey} on ${victim.id} — ` +
        `${outcome.succeeded ? `took ${outcome.amount}` : "failed"} at ${Math.round(outcome.chance * 100)}%`,
        import.meta.url,
    );
}

/** What the items do — the answer his shop descriptions promised and never delivered. */
async function explainCrime(interaction, ctx) {
    await ensurePlayer(ctx.db, interaction.user);
    const items = (await getInventory(ctx.db, interaction.user.id)).map((item) => item.item_key);
    const state = await getState(ctx.db, interaction.user.id);

    const tools = Object.entries(STEAL_TOOLS)
        .map(([key, tool]) => {
            const mine = items.includes(key);
            return (
                `${mine ? "✅" : "▫️"} **${key}** — ${Math.round(tool.chance * 100)}% base, a ` +
                `${tool.kind}${mine ? " (you have one)" : ""}`
            );
        })
        .join("\n");

    const defences = Object.entries(STEAL_DEFENCES)
        .map(([key, defence]) => {
            const mine = items.includes(key);
            return (
                `${mine ? "🛡️" : "▫️"} **${key}** — −${Math.round(defence.reduction * 100)}% against ` +
                `${defence.against.join(" and ")}${mine ? " (protecting you)" : ""}`
            );
        })
        .join("\n");

    // What a thief with each tool would actually face against this player right now.
    const exposure = Object.entries(STEAL_TOOLS)
        .map(([key, tool]) => {
            const chance = successChance(tool, defencesAgainst(tool.kind, items));
            return `${key} → ${Math.round(chance * 100)}%`;
        })
        .join(" · ");

    const embed = new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle("🔪 Crime")
        .setDescription(
            "Every tool is **consumed** whether it works or not. Failing costs a third of your " +
            "coins as bail. Succeeding takes up to a third of theirs.",
        )
        .addFields(
            { name: "Tools", value: tools },
            { name: "Defences", value: defences },
            {
                name: "Your exposure right now",
                value:
                    `${exposure}\n` +
                    `Someone could take up to ${COIN} **${maxTakeable(toInt(state.money, "money"))}** from you.`,
            },
        )
        .setFooter({ text: `Cooldown ${STEAL_RULES.COOLDOWN_MS / 60000} minutes between attempts.` });

    await respond(interaction, { embeds: [embed] });
    void QueryTypes;
}
