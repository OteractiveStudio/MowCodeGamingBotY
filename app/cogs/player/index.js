/**
 * app/cogs/player/index.js — player identity and provisioning.
 *
 * The legacy provisioned a player from `default_inventory` in config the first
 * time it saw them, which was the right instinct (new rows come from config, not
 * from a literal buried in code) and is kept.
 *
 * ❌ NOT built yet: money, exp, level, crystals, inventory, items. Those are the
 * economy slice and they need their own tables — `mst_player_state`,
 * `mst_player_item`, `log_economy` — plus the balance rules from the digest.
 * This cog is identity only, so `mst_player` has a real writer and the atomic
 * upsert is exercised for true.
 */

import { SlashCommandBuilder } from "discord.js";

import { ensurePlayer, countPlayers } from "../../data/player.js";

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
                const total = await countPlayers(ctx.db);

                await interaction.reply(
                    [
                        created
                            ? `Recorded you for the first time, **${row.username ?? interaction.user.username}**.`
                            : `Already knew you, **${row.username ?? interaction.user.username}**.`,
                        `id \`${row.discord_id}\` · first seen <t:${toUnix(row.first_seen_at)}:R>`,
                        `players known: \`${total}\``,
                        "",
                        "_No wallet yet — economy is the next slice._",
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
