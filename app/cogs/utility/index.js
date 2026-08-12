/**
 * app/cogs/utility/index.js — `/help`, `/rand`, `/trans`, and the old-prefix redirect.
 *
 * Three small legacy commands Ote asked for back, plus the answer to *"prefix commands? is this
 * still work?"*.
 *
 * ⭐ **YES, PREFIX COMMANDS STILL WORK** — they need the Message Content privileged intent, which
 * this bot already has enabled for typed guesses and wordle. What has changed is that Discord
 * pushed everything toward slash commands: they are discoverable, validated, autocompleted, and
 * usable without the privileged intent at all. Message Content also becomes gated behind
 * verification above 100 servers.
 *
 * ⚠️ **SO THE PREFIX COMMANDS ARE NOT REBUILT — THEY REDIRECT.** Rebuilding them would mean an
 * adapter that fakes an Interaction for every handler (options API, defer, editReply, buttons,
 * modals, ephemerality), and every one of those has no message equivalent — a modal cannot be
 * opened from a message at all. That adapter would be a second command surface to keep in step
 * with the first, forever, for a mechanism Discord is moving away from.
 *
 * What IS worth having: his players have `\fishing` in their fingers after three years. So typing
 * the old prefix gets a one-line "that is `/fishing` now" instead of silence. `/server set prefix`
 * sets which prefix is recognised, and `mst_guild.prefix` — stored since the first migration and
 * read by nothing — is finally read.
 */

import {
    SlashCommandBuilder,
    EmbedBuilder,
    InteractionContextType,
    Events,
} from "discord.js";

import { respond } from "../../bot/respond.js";
import { guildLang, guildLocale } from "../../bot/locale.js";
import { translator, supportedLangs } from "../../../lib/i18n.js";
import {
    TRANSLATE_RULES,
    TranslateError,
    translate,
    translateEnabled,
} from "../../data/translate.js";

/** Which commands belong under which heading in `/help`. Anything unlisted falls to "other". */
const HELP_SECTIONS = {
    economy: ["money", "fishing", "market", "inventory"],
    games: ["guess", "ox", "blackjack", "bj", "coinflip", "dice", "wordle", "steal", "crime"],
};

export default {
    name: "utility",
    description: "Help, dice-free randomness, translation, and the old-prefix redirect.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("help")
                .setDescription("What this bot can do.")
                .setContexts(InteractionContextType.Guild)
                .addStringOption((option) =>
                    option
                        .setName("name")
                        .setDescription("A command to explain in detail.")
                        .setRequired(false)
                        .setAutocomplete(true),
                ),

            async autocomplete(interaction, ctx) {
                const typed = interaction.options.getFocused().trim().toLowerCase();
                const names = [...(ctx.commands?.keys() ?? [])]
                    .filter((name) => name.includes(typed))
                    .slice(0, 25);
                await interaction.respond(names.map((name) => ({ name: `/${name}`, value: name })));
            },

            async execute(interaction, ctx) {
                return showHelp(interaction, ctx);
            },
        },
        {
            data: new SlashCommandBuilder()
                .setName("rand")
                .setDescription("A random whole number between two bounds.")
                .setContexts(InteractionContextType.Guild)
                .addIntegerOption((option) =>
                    option.setName("a").setDescription("One end. Default 1.").setRequired(false),
                )
                .addIntegerOption((option) =>
                    option.setName("b").setDescription("The other end. Default 10.").setRequired(false),
                ),

            async execute(interaction, ctx) {
                return rollRandom(interaction, ctx);
            },
        },
        {
            data: new SlashCommandBuilder()
                .setName("trans")
                .setDescription("Translate something, on request.")
                .setContexts(InteractionContextType.Guild)
                .addStringOption((option) =>
                    option
                        .setName("text")
                        .setDescription("What to translate.")
                        .setRequired(true)
                        .setMaxLength(TRANSLATE_RULES.MAX_LENGTH),
                )
                .addStringOption((option) =>
                    option
                        .setName("into")
                        .setDescription("Language code. Default: this server's language.")
                        .setRequired(false),
                ),

            async execute(interaction, ctx) {
                return doTranslate(interaction, ctx);
            },
        },
    ],

    events: [
        {
            /**
             * ⭐ THE OLD-PREFIX REDIRECT. Ote's `mst_guild.prefix` is finally read.
             *
             * ⚠️ Ordered so a message that is not a command costs nothing — TRAPS #11. Bot check,
             * then a cheap first-character test, then the cached locale, and only then anything
             * else. His equivalent ran a network translation on every message in every server.
             */
            name: Events.MessageCreate,
            async handle(message, ctx) {
                if (message.author?.bot) return;
                if (!message.guildId) return;

                const content = message.content?.trim();
                // The shortest possible early exit: prefixes are punctuation, so a message that
                // starts with a letter or digit can never be one.
                if (!content || /^[\p{L}\p{N}\s]/u.test(content)) return;

                const { prefix, lang } = await guildLocale(ctx, message.guildId);
                if (!prefix || !content.startsWith(prefix)) return;

                const rest = content.slice(prefix.length).trim();
                if (rest.length === 0) return;

                // ⚠️ Only ever redirects a plausible command word. Without this, a channel where
                // people use "+" or "!" conversationally would get answered constantly.
                const word = rest.split(/\s+/)[0].toLowerCase();
                if (!/^[a-z_]{2,32}$/.test(word)) return;

                const s = translator(lang);
                const known = ctx.commands?.has(word);

                // Legacy names that were renamed, so muscle memory still lands somewhere useful.
                const RENAMED = {
                    inv: "inventory",
                    stats: "money",
                    bj: "blackjack",
                    cf: "coinflip",
                    xo: "ox",
                    file: "admin",
                    data: "admin",
                    cheat: "admin",
                    wordleplus: "wordle",
                };

                const target = known ? word : RENAMED[word];
                if (!target) return; // Not a command of ours, old or new — stay quiet.

                await message.reply({
                    content: s("prefix.redirect", { command: target }),
                    allowedMentions: { repliedUser: false },
                });

                await ctx.log(
                    `prefix redirect: ${message.author.id} typed "${prefix}${word}" -> /${target}`,
                    import.meta.url,
                );
            },
        },
    ],
};

// ── /help ────────────────────────────────────────────────────────────────────

async function showHelp(interaction, ctx) {
    const lang = await guildLang(ctx, interaction.guildId);
    const s = translator(lang);
    const wanted = interaction.options.getString("name");

    if (wanted) return showOneCommand(interaction, ctx, s, wanted.replace(/^\//, "").toLowerCase());

    // ⭐ BUILT FROM THE LIVE REGISTRY, not a hand-written list. His help was a hardcoded string
    // that had already drifted — it advertised `wordle` as playable when no wordle command
    // existed, and described a "gray" miss colour when the code drew red. A list generated from
    // what is actually loaded cannot say that.
    const entries = [...(ctx.commands?.entries() ?? [])].map(([name, entry]) => ({
        name,
        description: entry.command.data.toJSON().description,
        cog: entry.cogName ?? "?",
    }));

    const sectionFor = (name) => {
        if (HELP_SECTIONS.economy.includes(name)) return "economy";
        if (HELP_SECTIONS.games.includes(name)) return "games";
        return "other";
    };

    const grouped = { economy: [], games: [], other: [] };
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        grouped[sectionFor(entry.name)].push(entry);
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(s("help.title"))
        .setDescription(s("help.intro"));

    for (const [key, label] of [
        ["economy", s("help.section.economy")],
        ["games", s("help.section.games")],
        ["other", s("help.section.other")],
    ]) {
        if (grouped[key].length === 0) continue;
        embed.addFields({
            name: label,
            value: grouped[key]
                .map((e) => `**/${e.name}** — ${e.description || s("help.no_description")}`)
                .join("\n"),
        });
    }

    embed.setFooter({
        text: s("help.footer", { commands: entries.length, cogs: ctx.cogs?.length ?? "?" }),
    });

    await respond(interaction, { embeds: [embed] });
}

async function showOneCommand(interaction, ctx, s, name) {
    const entry = ctx.commands?.get(name);
    if (!entry) {
        await respond(interaction, { content: s("help.unknown", { name }) });
        return;
    }

    const json = entry.command.data.toJSON();
    const subcommands = (json.options ?? []).filter((o) => o.type === 1);
    const plainOptions = (json.options ?? []).filter((o) => o.type !== 1);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`/${json.name}`)
        .setDescription(json.description || s("help.no_description"));

    if (subcommands.length > 0) {
        embed.addFields({
            name: s("help.subcommands"),
            value: subcommands
                .map((sub) => {
                    const args = (sub.options ?? [])
                        .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
                        .join(" ");
                    return `**${sub.name}** ${args}\n${sub.description}`;
                })
                .join("\n\n"),
        });
    }

    if (plainOptions.length > 0) {
        embed.addFields({
            name: s("help.options"),
            value: plainOptions
                .map((o) => `${o.required ? `<${o.name}>` : `[${o.name}]`} — ${o.description}`)
                .join("\n"),
        });
    }

    embed.setFooter({ text: s("help.detail.footer", { cog: entry.cogName ?? "?" }) });

    await respond(interaction, { embeds: [embed] });
}

// ── /rand ────────────────────────────────────────────────────────────────────

/**
 * His `rand`, with one behaviour changed.
 *
 * ⚠️ FIXED — his refused equal bounds:
 *     if input_a == input_b: await ctx.send("Please enter the data in a valid format...")
 * `\rand 5 5` is not invalid input, it is a question with one answer. Telling someone their
 * format is wrong when it is not sends them to read the help for nothing. It answers 5 now, and
 * says why there was only ever one answer.
 *
 * ⭐ His comment credits this one to **มิกกี้**, and that credit is carried into the footer.
 */
async function rollRandom(interaction, ctx) {
    const lang = await guildLang(ctx, interaction.guildId);
    const s = translator(lang);

    const a = interaction.options.getInteger("a") ?? 1;
    const b = interaction.options.getInteger("b") ?? 10;

    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const value = low + Math.floor(Math.random() * (high - low + 1));

    const embed = new EmbedBuilder()
        .setColor(0x1abc9c)
        .setTitle("🎲 " + value)
        .setDescription(s("rand.result", { user: interaction.user.toString(), value }))
        .setFooter({ text: `${s("rand.range", { low, high })} · ${s("rand.credit")}` });

    if (low === high) {
        embed.addFields({ name: "​", value: s("rand.same", { value: low }) });
    }

    await respond(interaction, { embeds: [embed] });
}

// ── /trans ───────────────────────────────────────────────────────────────────

async function doTranslate(interaction, ctx) {
    const lang = await guildLang(ctx, interaction.guildId);
    const s = translator(lang);

    if (!translateEnabled(ctx.config)) {
        await respond(interaction, { content: s("trans.disabled") });
        return;
    }

    const text = interaction.options.getString("text");
    const into = (interaction.options.getString("into") ?? lang).toLowerCase();

    // ⚠️ A loose sanity check only. The endpoint knows far more codes than this bot has
    // catalogues for — translating INTO Japanese is fine even though the bot cannot speak it.
    if (!/^[a-z]{2}(-[a-zA-Z]{2,4})?$/.test(into)) {
        await respond(interaction, { content: s("trans.unknown_lang", { lang: into }) });
        return;
    }

    try {
        const result = await translate(text, into);

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(s("trans.title"))
            .setDescription(result.text)
            .addFields(
                { name: s("trans.from"), value: `\`${result.detected}\``, inline: true },
                { name: s("trans.to"), value: `\`${into}\``, inline: true },
            )
            .setFooter({ text: s("trans.footer") });

        await respond(interaction, { embeds: [embed] });
    } catch (err) {
        if (err instanceof TranslateError) {
            const message =
                err.code === "EMPTY"
                    ? s("trans.empty")
                    : err.code === "TOO_LONG"
                      ? s("trans.too_long", { length: text.length, max: TRANSLATE_RULES.MAX_LENGTH })
                      : s("trans.failed");

            await respond(interaction, { content: message });

            // ⚠️ Logged at warning, not swallowed: this is a third-party endpoint that WILL break
            // one day, and when it does someone needs to be able to see that in a log rather than
            // guess from user reports.
            await ctx.log(
                `trans: ${err.code} translating ${text.length} chars into ${into} — ${err.message}`,
                "warning",
                import.meta.url,
            );
            return;
        }
        throw err;
    }
}

export { supportedLangs };
