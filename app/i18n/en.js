/**
 * app/i18n/en.js — the reference catalogue. Every other language is measured against this one.
 *
 * ⭐ KEYS ARE DOTTED AND GROUPED BY SURFACE, so a translator can see what they are working on.
 * ⚠️ Placeholders are `{named}`, never positional — a translator must be able to reorder them,
 * which is the whole reason `%s` is a bad idea in a file someone else edits.
 * ⚠️ Markdown, emoji and `<@mentions>` stay OUT of the strings wherever the layout allows, so a
 * translation cannot break the formatting by rewriting a backtick. Where they are unavoidable
 * they are kept short and obvious.
 */
export default {
    // ── /help ────────────────────────────────────────────────────────────────
    "help.title": "MowCode Gaming Bot",
    "help.intro":
        "A remake of the bot I wrote as a student, rebuilt on discord.js and Postgres. " +
        "Everything is a slash command — type `/` and the list appears.",
    "help.section.economy": "Coins and progression",
    "help.section.games": "Games",
    "help.section.other": "Everything else",
    "help.footer": "{commands} commands in {cogs} groups · /help name:<command> for one of them",
    "help.detail.footer": "Part of the {cog} group.",
    "help.unknown": "There is no command called \"{name}\". Try /help with no options.",
    "help.options": "Options",
    "help.subcommands": "Subcommands",
    "help.no_description": "No description.",

    // ── /rand ────────────────────────────────────────────────────────────────
    "rand.result": "{user}, you get **{value}**",
    "rand.range": "between {low} and {high}",
    "rand.same": "Both numbers are {value}, so that is the only answer there is.",
    "rand.credit": "The original of this one was written by มิกกี้.",

    // ── /trans ───────────────────────────────────────────────────────────────
    "trans.title": "Translation",
    "trans.from": "Detected",
    "trans.to": "Into",
    "trans.empty": "Give me something to translate.",
    "trans.too_long": "That is {length} characters and the limit is {max}.",
    "trans.failed":
        "The translation service did not answer. It is an unofficial endpoint, so this happens; " +
        "try again in a moment.",
    "trans.disabled": "Translation is switched off in this bot's configuration.",
    "trans.unknown_lang": "I do not know the language code \"{lang}\".",
    "trans.footer": "Translated on request via an unofficial Google endpoint.",

    // ── /server ──────────────────────────────────────────────────────────────
    "server.title": "Settings for {name}",
    "server.guild_only": "That only means something inside a server.",
    "server.language": "Language",
    "server.prefix": "Old prefix",
    "server.music_channel": "Music channel",
    "server.manager_role": "Manager role",
    "server.known_since": "Known since",
    "server.not_set": "not set",
    "server.first_time": "First time I have recorded this server.",
    "server.lang_set": "Language set to **{name}** (`{lang}`).",
    "server.lang_unsupported":
        "I do not have strings for \"{lang}\". I have: {supported}. " +
        "Unlike the original this bot uses written translations, not machine translation.",
    "server.lang_partial":
        "Heads up: {name} is {percent}% translated, so some messages will still be in English.",
    "server.prefix_set": "Old-style prefix set to `{prefix}`. It only redirects — see below.",
    "server.needs_manage_guild": "You need the Manage Server permission to change this.",
    "server.coverage": "Translations available",

    // ── the prefix redirect ──────────────────────────────────────────────────
    "prefix.redirect": "That is `/{command}` now. Type `/` and Discord will show you the list.",
    "prefix.redirect_unknown":
        "The old `{prefix}` commands are gone — everything is a slash command now. Try `/help`.",

    // ── /ping and /about ─────────────────────────────────────────────────────
    "ping.reply": "Awake. Gateway {ms}ms.",
    "about.title": "About",
    "about.body":
        "A remake of a Python bot from 2021-2024, rebuilt on discord.js with Postgres. " +
        "The original is kept as a frozen reference and read for intent, not translated.",
    "about.uptime": "Uptime",
    "about.guilds": "Servers",
    "about.commands": "Commands",

    // ── /feedback ────────────────────────────────────────────────────────────
    "feedback.title": "Feedback recorded",
    "feedback.thanks": "Thank you — it is in the database and the maintainers will see it.",
    "feedback.your_message": "What you said",
    "feedback.reference": "Reference",
    "feedback.remaining": "Left this hour",
    "feedback.private": "Only you can see this message.",
    "feedback.rate_limited":
        "That is {count} pieces of feedback in the last hour, which is the limit. " +
        "Nothing is lost. Come back in a bit if there is more.",
    "feedback.too_short": "Say a little more — at least {min} characters.",
    "feedback.too_long": "That is {length} characters and the limit is {max} — send the rest as a second one.",
    "feedback.empty": "There was nothing in that.",

    // ── restart ──────────────────────────────────────────────────────────────
    "restart.countdown": "Restarting in {seconds}…",
    "restart.now": "Restarting.",
    "restart.back": "I'm back! :D",
    "restart.no_supervisor":
        "Nothing is watching this process, so it would stop instead of restarting. " +
        "Start it with run_windows.bat (or run_linux.sh), which restarts on request.",

    // ── shared ───────────────────────────────────────────────────────────────
    "common.owner_only": "That is an owner command.",
    "common.something_broke": "Something broke running that. It has been logged.",
};
