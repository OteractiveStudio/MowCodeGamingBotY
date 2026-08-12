/**
 * app/cogs/player/index.js — player identity and provisioning.
 *
 * The legacy provisioned a player from `default_inventory` in config the first
 * time it saw them, which was the right instinct (new rows come from config, not
 * from a literal buried in code) and is kept.
 *
 * ⚠️ Coins, exp and levels now exist — they live in the `economy` cog, and
 * `/whoami` shows them. Items and inventory are still unbuilt.
 */

import { SlashCommandBuilder } from "discord.js";

import { ensurePlayer, countPlayers, getPlayerWithState } from "../../data/player.js";
import { expCap, toInt } from "../../data/economy.js";

export default {
    name: "player",
    description: "Player identity. Economy and progression are not built yet.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("whoami")
                .setDescription("Show what the bot has recorded about you."),

            async execute(interaction, ctx) {
                const { row, created } = await ensurePlayer(ctx.db, interaction.user);
                const player = await getPlayerWithState(ctx.db, interaction.user.id);
                const total = await countPlayers(ctx.db);
                const cap = expCap(player.level, player.magical_crystal);

                await interaction.reply(
                    [
                        created
                            ? `Recorded you for the first time, **${row.username ?? interaction.user.username}**.`
                            : `Already knew you, **${row.username ?? interaction.user.username}**.`,
                        `id \`${row.discord_id}\` · first seen <t:${toUnix(row.first_seen_at)}:R>`,
                        `🪙 \`${toInt(player.money, "money")}\` · level \`${player.level}\` · ` +
                        `exp \`${player.exp}/${cap}\`` +
                        (player.magical_crystal > 0 ? ` · 💎 \`${player.magical_crystal}\`` : ""),
                        `🎣 \`${player.fishing_rod}\` rod${player.fishing_rod === 1 ? "" : "s"} · ` +
                        `caught \`${player.fishing_count}\` · inventory size \`${player.inventory_size}\``,
                        `players known: \`${total}\``,
                        "",
                        "_Use `/money history` to see where your coins came from._",
                    ].join("\n"),
                );
            },
        },
    ],

    events: [],
};

function toUnix(value) {
    return Math.floor(new Date(value).getTime() / 1000);
}
