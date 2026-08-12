/**
 * app/cogs/economy/index.js — money, giving, and the ledger.
 *
 * The legacy `inventory_cog` — `money`, `fishingrod`, `inv` — was the last file he
 * touched, 2024-08-30. This is its descendant.
 *
 * ⭐ `/money history` is new, and it is the point of the rewrite made visible: the
 * legacy could tell you a balance, but never why it was that number. Every mutation
 * writes a `log_economy` row in the same transaction, so the balance can be
 * reconstructed and checked against itself.
 *
 * ❌ Not here yet: admin adjust (needs the permission model decided), `cheat`/`steal`
 * (need items — knife, gun, passkey — and a rule set), and fishing.
 */

import { SlashCommandBuilder } from "discord.js";

import { ensurePlayer, getPlayerWithState } from "../../data/player.js";
import {
    transfer,
    explainBalance,
    expCap,
    isBadEcon,
    toInt,
    BAD_ECON_THRESHOLD,
} from "../../data/economy.js";

const COIN = "🪙";

export default {
    name: "economy",
    description: "Coins, giving them away, and where they came from.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("money")
                .setDescription("Coins: check a balance, give some away, or read the ledger.")
                .addSubcommand((sub) =>
                    sub
                        .setName("balance")
                        .setDescription("How many coins you (or someone else) have.")
                        .addUserOption((option) =>
                            option
                                .setName("player")
                                .setDescription("Whose balance to check. Defaults to you."),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("give")
                        .setDescription("Give some of your coins to another player.")
                        .addUserOption((option) =>
                            option
                                .setName("player")
                                .setDescription("Who receives the coins.")
                                .setRequired(true),
                        )
                        .addIntegerOption((option) =>
                            option
                                .setName("amount")
                                .setDescription("How many coins to give.")
                                .setMinValue(1)
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("history")
                        .setDescription("Where your coins came from — the ledger, newest first."),
                ),

            async execute(interaction, ctx) {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === "balance") return balance(interaction, ctx);
                if (subcommand === "give") return give(interaction, ctx);
                if (subcommand === "history") return history(interaction, ctx);

                await interaction.reply(`Unknown subcommand \`${subcommand}\`.`);
            },
        },
    ],

    events: [],
};

async function balance(interaction, ctx) {
    const target = interaction.options.getUser("player") ?? interaction.user;

    // Provision on sight, exactly as the legacy did — a player exists the first time
    // the bot has a reason to know about them.
    await ensurePlayer(ctx.db, target);
    const player = await getPlayerWithState(ctx.db, target.id);

    const money = toInt(player.money, "money");
    const cap = expCap(player.level, player.magical_crystal);
    const isSelf = target.id === interaction.user.id;

    const lines = [
        `**${player.global_name ?? player.username ?? target.username}** — ${COIN} \`${money}\``,
        `level \`${player.level}\` · exp \`${player.exp}/${cap}\`` +
        (player.magical_crystal > 0 ? ` · 💎 \`${player.magical_crystal}\`` : ""),
        `🎣 \`${player.fishing_rod}\` rod${player.fishing_rod === 1 ? "" : "s"} · ` +
        `caught \`${player.fishing_count}\``,
    ];

    if (isBadEcon(money)) {
        lines.push(
            `\n⚠️ ${isSelf ? "You are" : "They are"} below \`${BAD_ECON_THRESHOLD}\` — bad econ.`,
        );
    }

    await interaction.reply(lines.join("\n"));
}

async function give(interaction, ctx) {
    const recipient = interaction.options.getUser("player");
    const amount = interaction.options.getInteger("amount");

    if (recipient.id === interaction.user.id) {
        await interaction.reply("You cannot give coins to yourself.");
        return;
    }
    if (recipient.bot) {
        await interaction.reply("Bots have no use for coins.");
        return;
    }

    // Both sides must exist before money can move between them.
    await ensurePlayer(ctx.db, interaction.user);
    await ensurePlayer(ctx.db, recipient);

    try {
        const result = await transfer(ctx.db, {
            fromId: interaction.user.id,
            toId: recipient.id,
            amount,
            guildId: interaction.guildId,
        });

        await interaction.reply(
            `${interaction.user} gave ${COIN} \`${amount}\` to ${recipient}.\n` +
            `You now have \`${result.sender.money}\`; they have \`${result.recipient.money}\`.`,
        );
    } catch (err) {
        if (err.message.startsWith("insufficient funds")) {
            const player = await getPlayerWithState(ctx.db, interaction.user.id);
            await interaction.reply(
                `You only have ${COIN} \`${toInt(player.money, "money")}\` — not enough to give \`${amount}\`.`,
            );
            return;
        }
        throw err;
    }
}

async function history(interaction, ctx) {
    await ensurePlayer(ctx.db, interaction.user);
    const ledger = await explainBalance(ctx.db, interaction.user.id, 10);

    if (ledger.total === 0) {
        await interaction.reply("Nothing has happened to your coins yet.");
        return;
    }

    const rows = ledger.entries.map((entry) => {
        const delta = toInt(entry.money_delta, "money_delta");
        const sign = delta >= 0 ? "+" : "";
        const gained =
            entry.levels_gained > 0
                ? ` (level +${entry.levels_gained}${entry.crystals_gained > 0 ? `, 💎 +${entry.crystals_gained}` : ""})`
                : "";
        return `\`${sign}${delta}\` → \`${entry.money_after}\` · ${entry.reason}` +
            (entry.ref ? ` · ${entry.ref}` : "") + gained;
    });

    const lines = [
        `**Your ledger** — ${ledger.total} entr${ledger.total === 1 ? "y" : "ies"}, newest first:`,
        ...rows,
    ];

    // Say it out loud when the ledger and the live row disagree. That would mean a
    // write happened outside the data layer, which is exactly what this table exists
    // to catch.
    if (!ledger.chainIsConsistent || !ledger.matchesLiveBalance) {
        lines.push(
            `\n⚠️ This ledger does not reconcile: ledger says \`${ledger.ledgerBalance}\`, ` +
            `your balance is \`${ledger.liveBalance}\`. Report this.`,
        );
    }

    await interaction.reply(lines.join("\n"));
}
