/**
 * app/cogs/guild/index.js — per-guild settings and join/leave provisioning.
 *
 * From the legacy `server_settings_cog` (`server` info/set, `on_guild_join`,
 * `on_guild_remove`). Per-guild settings from day one was one of the genuinely
 * good instincts in the original — multi-tenant thinking in a student project —
 * so it is here in the scaffold rather than bolted on later.
 *
 * ❌ NOT built yet: `/server set`. Writing settings needs the permission model
 * decided first (`manager_role_id` exists in the table for it). Reading is safe;
 * writing is a decision.
 */

import { Events, SlashCommandBuilder, InteractionContextType } from "discord.js";

import { log } from "../../../lib/utility.js";
import { ensureGuild, markGuildLeft, getGuild } from "../../data/guild.js";

export default {
    name: "guild",
    description: "Per-guild settings, and provisioning on join/leave.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("server")
                .setDescription("Show this server's bot settings.")
                // setDMPermission is deprecated in this discord.js version.
                .setContexts(InteractionContextType.Guild),

            async execute(interaction, ctx) {
                if (!interaction.guildId) {
                    await interaction.reply("That only means something inside a server.");
                    return;
                }

                const row = await getGuild(ctx.db, interaction.guildId);

                if (!row) {
                    // Provision lazily too: the bot may have joined while it was
                    // offline, so the join event never arrived.
                    const { row: created } = await ensureGuild(ctx.db, interaction.guild, {
                        prefix: ctx.config.bot?.default_prefix,
                        lang: ctx.config.bot?.default_lang,
                    });
                    await interaction.reply(
                        `First time I've recorded this server. Language \`${created.lang}\`, joined <t:${toUnix(created.joined_at)}:R>.`,
                    );
                    return;
                }

                await interaction.reply(
                    [
                        `**${row.name ?? interaction.guild.name}**`,
                        `language: \`${row.lang}\``,
                        `music channel: ${row.music_channel_id ? `<#${row.music_channel_id}>` : "`not set`"}`,
                        `manager role: ${row.manager_role_id ? `<@&${row.manager_role_id}>` : "`not set`"}`,
                        `known since: <t:${toUnix(row.joined_at)}:D>`,
                    ].join("\n"),
                );
            },
        },
    ],

    events: [
        {
            name: Events.GuildCreate,
            async handle(guild, ctx) {
                const { created } = await ensureGuild(ctx.db, guild, {
                    prefix: ctx.config.bot?.default_prefix,
                    lang: ctx.config.bot?.default_lang,
                });
                await log(
                    `joined guild ${guild.name} (${guild.id}) — ${created ? "new row" : "revived an existing row"}`,
                    import.meta.url,
                );
            },
        },
        {
            name: Events.GuildDelete,
            async handle(guild, ctx) {
                const marked = await markGuildLeft(ctx.db, guild.id);
                await log(
                    `left guild ${guild.name ?? "(unknown)"} (${guild.id}) — ${marked} row(s) marked left, none deleted`,
                    import.meta.url,
                );
            },
        },
    ],
};

function toUnix(value) {
    return Math.floor(new Date(value).getTime() / 1000);
}
