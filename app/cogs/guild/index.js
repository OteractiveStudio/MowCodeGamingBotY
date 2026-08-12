/**
 * app/cogs/guild/index.js — per-guild settings and join/leave provisioning.
 *
 * From the legacy `server_settings_cog` (`server` info/set, `on_guild_join`, `on_guild_remove`).
 * Per-guild settings from day one was one of the genuinely good instincts in the original —
 * multi-tenant thinking in a student project — so it was in the scaffold from the start.
 *
 * ⭐ `/server set` NOW EXISTS. The decision it was waiting on — who may write settings — resolves
 * to **Discord's Manage Server permission**, and deliberately NOT `config.bot.admin_ids`. That is
 * the mirror image of the reasoning that made cancelling a game admin-only: cancelling someone's
 * game is a **bot** concern, so it belongs to whoever runs the bot; what language a server speaks
 * is a **server** concern, so it belongs to whoever runs the server. A bot owner sitting in ten
 * guilds should not be the only person able to set a language in any of them.
 *
 * ⭐ `mst_guild.prefix` has been stored since migration 001 and read by nothing. It is now read by
 * the old-prefix redirect in `app/cogs/utility/index.js`, and settable here.
 */

import {
    Events,
    SlashCommandBuilder,
    InteractionContextType,
    PermissionFlagsBits,
    EmbedBuilder,
} from "discord.js";

import { respond } from "../../bot/respond.js";
import { log } from "../../../lib/utility.js";
import { ensureGuild, markGuildLeft, getGuild, setGuildSettings } from "../../data/guild.js";
import { forgetGuildLocale, guildLang } from "../../bot/locale.js";
import { translator, isSupportedLang, languageName, supportedLangs, coverage } from "../../../lib/i18n.js";

export default {
    name: "guild",
    description: "Per-guild settings, and provisioning on join/leave.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("server")
                .setDescription("This server's bot settings.")
                // setDMPermission is deprecated in this discord.js version.
                .setContexts(InteractionContextType.Guild)
                .addSubcommand((sub) => sub.setName("show").setDescription("What is set right now."))
                .addSubcommand((sub) =>
                    sub
                        .setName("set")
                        .setDescription("Change a setting. Needs Manage Server.")
                        .addStringOption((option) =>
                            option
                                .setName("language")
                                .setDescription("Which language the bot answers in.")
                                .setRequired(false)
                                .setAutocomplete(true),
                        )
                        .addStringOption((option) =>
                            option
                                .setName("prefix")
                                .setDescription("Old-style prefix to recognise and redirect. 1-4 characters.")
                                .setRequired(false)
                                .setMinLength(1)
                                .setMaxLength(4),
                        ),
                ),

            async autocomplete(interaction) {
                const typed = interaction.options.getFocused().trim().toLowerCase();
                await interaction.respond(
                    supportedLangs()
                        .filter(
                            (code) =>
                                code.includes(typed) || languageName(code).toLowerCase().includes(typed),
                        )
                        .map((code) => ({ name: `${languageName(code)} (${code})`, value: code })),
                );
            },

            async execute(interaction, ctx) {
                if (!interaction.guildId) {
                    const s = translator(ctx.config.bot?.default_lang);
                    await respond(interaction, s("server.guild_only"));
                    return;
                }
                if (interaction.options.getSubcommand() === "set") {
                    return setSettings(interaction, ctx);
                }
                return showSettings(interaction, ctx);
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
                // The locale cache would otherwise hold this guild's settings for a minute after
                // the bot is gone from it. Harmless, but free to be tidy about.
                forgetGuildLocale(guild.id);
                await log(
                    `left guild ${guild.name ?? "(unknown)"} (${guild.id}) — ${marked} row(s) marked left, none deleted`,
                    import.meta.url,
                );
            },
        },
    ],
};

// ── /server show ─────────────────────────────────────────────────────────────

async function showSettings(interaction, ctx) {
    let row = await getGuild(ctx.db, interaction.guildId);
    let firstTime = false;

    if (!row) {
        // Provision lazily too: the bot may have joined while it was offline, so the join event
        // never arrived.
        const created = await ensureGuild(ctx.db, interaction.guild, {
            prefix: ctx.config.bot?.default_prefix,
            lang: ctx.config.bot?.default_lang,
        });
        row = created.row;
        firstTime = true;
    }

    const s = translator(row.lang);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(s("server.title", { name: row.name ?? interaction.guild.name }))
        .addFields(
            {
                name: s("server.language"),
                value: `${languageName(row.lang)} (\`${row.lang}\`)`,
                inline: true,
            },
            { name: s("server.prefix"), value: `\`${row.prefix ?? "+"}\``, inline: true },
            {
                name: s("server.known_since"),
                value: `<t:${toUnix(row.joined_at)}:D>`,
                inline: true,
            },
            {
                name: s("server.music_channel"),
                value: row.music_channel_id ? `<#${row.music_channel_id}>` : `\`${s("server.not_set")}\``,
                inline: true,
            },
            {
                name: s("server.manager_role"),
                value: row.manager_role_id ? `<@&${row.manager_role_id}>` : `\`${s("server.not_set")}\``,
                inline: true,
            },
        );

    // ⭐ Coverage is shown rather than a bare language list, so nobody sets a language and then
    // wonders why half the bot is still English. His advertised 64 languages and could not
    // actually speak any of them without a live translation call.
    embed.addFields({
        name: s("server.coverage"),
        value: coverage()
            .map((c) => `${c.name} (\`${c.lang}\`) — **${c.percent}%**`)
            .join("\n"),
    });

    if (firstTime) embed.setDescription(s("server.first_time"));

    await respond(interaction, { embeds: [embed] });
}

// ── /server set ──────────────────────────────────────────────────────────────

async function setSettings(interaction, ctx) {
    const lang = await guildLang(ctx, interaction.guildId);
    const s = translator(lang);

    // ⚠️ A SERVER setting, so a SERVER permission. See the file header.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await respond(interaction, s("server.needs_manage_guild"));
        return;
    }

    const wantedLang = interaction.options.getString("language");
    const wantedPrefix = interaction.options.getString("prefix");

    if (!wantedLang && !wantedPrefix) {
        await respond(interaction, "Give me something to set — `language` or `prefix`.");
        return;
    }

    const lines = [];
    const changes = {};

    if (wantedLang) {
        const code = wantedLang.toLowerCase();
        if (!isSupportedLang(code)) {
            // ⚠️ Named clearly rather than silently accepted. Storing a language the bot has no
            // strings for would make every message render as its key.
            await respond(
                interaction,
                s("server.lang_unsupported", {
                    lang: wantedLang,
                    supported: supportedLangs()
                        .map((c) => `${languageName(c)} (\`${c}\`)`)
                        .join(", "),
                }),
            );
            return;
        }
        changes.lang = code;

        const after = translator(code);
        lines.push(after("server.lang_set", { name: languageName(code), lang: code }));

        const cover = coverage().find((c) => c.lang === code);
        if (cover && cover.percent < 100) {
            lines.push(after("server.lang_partial", { name: cover.name, percent: cover.percent }));
        }
    }

    if (wantedPrefix) {
        // ⚠️ A prefix made of letters or digits would fire the redirect on ordinary words, and the
        // redirect's own cheap early-exit assumes punctuation. Refuse it here rather than let it
        // half-work.
        if (/[\p{L}\p{N}\s]/u.test(wantedPrefix)) {
            await respond(
                interaction,
                "A prefix has to be punctuation — letters, digits and spaces would fire on normal messages.",
            );
            return;
        }
        changes.prefix = wantedPrefix;
        lines.push(s("server.prefix_set", { prefix: wantedPrefix }));
    }

    // Provision first if the row does not exist, so the UPDATE has something to hit.
    if (!(await getGuild(ctx.db, interaction.guildId))) {
        await ensureGuild(ctx.db, interaction.guild, {
            prefix: ctx.config.bot?.default_prefix,
            lang: ctx.config.bot?.default_lang,
        });
    }

    const row = await setGuildSettings(ctx.db, interaction.guildId, changes);

    // ⚠️ Invalidate the cache, or the change is invisible for up to a minute — including in the
    // message that reports it.
    forgetGuildLocale(interaction.guildId);

    await respond(interaction, { content: lines.join("\n") });

    await log(
        `server settings changed in ${interaction.guildId} by ${interaction.user.id}: ` +
        `${JSON.stringify(changes)} (lang now ${row?.lang}, prefix now ${row?.prefix})`,
        import.meta.url,
    );
}

function toUnix(value) {
    return Math.floor(new Date(value).getTime() / 1000);
}
