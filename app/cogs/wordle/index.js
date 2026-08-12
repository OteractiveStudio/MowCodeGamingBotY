/**
 * app/cogs/wordle/index.js — `/wordle`.
 *
 * Rules and every fix live in `app/data/wordle.js`. This file is the Discord surface, the word
 * draw, and the message listener that lets people just type.
 *
 * ⭐ YOU TYPE YOUR GUESSES IN CHAT. Ote, on the guess game: *"can you make it the old style
 * where user type in chat to guess? it better ux then out in a form every time?"*, and later
 * *"plain chat better ux"*. Wordle is the game where that matters most — six guesses through a
 * modal would be six dialogs — and it is also what his own prototype did, reading raw `input()`.
 *
 * ⚠️ The listener is written against the worst habit in his codebase: `fishing_cog.on_message`
 * fired a **network translation request on every message in every server** just to test for the
 * word "fish". The order here is deliberate and every early return is free — bot check, then a
 * Map lookup, then a length/shape regex. A channel with no game costs one Map lookup.
 */

import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    InteractionContextType,
    Events,
} from "discord.js";
import { QueryTypes } from "sequelize";

import { respond } from "../../bot/respond.js";
import { isBotAdmin } from "../../bot/permissions.js";
import {
    WORDLE_RULES,
    WordleSessions,
    KEYBOARD_ROWS,
    MARK,
    OUTCOME,
    validateGuess,
} from "../../data/wordle.js";

const sessions = new WordleSessions();

export default {
    name: "wordle",
    description: "Guess the hidden word in six tries.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("wordle")
                .setDescription("Start a wordle in this channel. Everyone can guess by typing.")
                .setContexts(InteractionContextType.Guild)
                .addSubcommand((sub) =>
                    sub
                        .setName("start")
                        .setDescription("Start a game.")
                        .addIntegerOption((option) =>
                            option
                                .setName("length")
                                .setDescription("How many letters. Default: random 4-6, his original range.")
                                .setRequired(false)
                                .setMinValue(WORDLE_RULES.MIN_LENGTH)
                                .setMaxValue(WORDLE_RULES.MAX_LENGTH),
                        ),
                )
                .addSubcommand((sub) => sub.setName("board").setDescription("Show the current board again."))
                .addSubcommand((sub) => sub.setName("rules").setDescription("How it works.")),

            async execute(interaction, ctx) {
                const sub = interaction.options.getSubcommand();
                if (sub === "start") return startGame(interaction, ctx);
                if (sub === "board") return showBoard(interaction, ctx);
                return showRules(interaction);
            },
        },
    ],

    events: [
        {
            name: Events.MessageCreate,
            async handle(message, ctx) {
                if (message.author?.bot) return;

                const game = sessions.get(message.channelId);
                if (!game || game.finished) return;

                const text = message.content?.trim();
                // A bare word of a plausible length. Anything with a space is conversation, and
                // people must be able to talk in a channel that has a game running.
                if (!text || !/^[a-zA-Z]{3,8}$/.test(text)) return;

                await handleTypedGuess(message, ctx, text);
            },
        },
    ],

    async handleComponent(interaction, ctx) {
        const [, action] = String(interaction.customId).split(":");

        if (action === "giveup") return giveUp(interaction, ctx);

        await respond(interaction, {
            content: "That control isn't one I recognise.",
            flags: MessageFlags.Ephemeral,
        });
    },
};

// ── Drawing a word ───────────────────────────────────────────────────────────

/**
 * Pick a target from `mst_wordle_word`.
 *
 * ⭐ This one query replaces two third-party HTTP calls and an unbounded recursion — see the
 * data module's FIXED #1. `ORDER BY random()` over 2,000 rows is nothing.
 */
async function drawWord(db, length = null) {
    const rows = await db.sequelize.query(
        `SELECT word
           FROM ${db.schema}.mst_wordle_word
          WHERE is_answer AND is_active
            AND (:length IS NULL OR length = :length)
          ORDER BY random()
          LIMIT 1`,
        { replacements: { length }, type: QueryTypes.SELECT },
    );

    if (rows.length === 0) {
        throw new Error(
            length
                ? `no ${length}-letter words are seeded — run: npm run db:seed`
                : "the wordle dictionary is empty — run: npm run db:seed",
        );
    }
    return rows[0].word;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderRows(game) {
    const width = game.target.length;
    const lines = [];

    for (const row of game.rows) {
        lines.push(`${row.marks.join("")}  \`${row.guess.toUpperCase()}\``);
    }

    // Blank rows for what is left. ✅ FIXED #2 — built fresh each render, never shared arrays.
    for (let i = game.rows.length; i < WORDLE_RULES.MAX_ATTEMPTS; i += 1) {
        lines.push(MARK.BLANK.repeat(width));
    }

    return lines.join("\n");
}

/** ⭐ His keyboard tracker: A-M, then N-Z, each letter under its best-known state. */
function renderKeyboard(game) {
    return KEYBOARD_ROWS.map((row) => {
        const letters = row.map((letter) => `:regional_indicator_${letter}:`).join("");
        const marks = row.map((letter) => game.keyboard[letter]).join("");
        return `${letters}\n${marks}`;
    }).join("\n");
}

function boardView(game, { resultTitle = null, resultBody = null } = {}) {
    const embed = new EmbedBuilder()
        .setColor(game.finished ? (game.outcome === OUTCOME.SOLVED ? 0x2ecc71 : 0x808080) : 0x1e90ff)
        .setTitle("🟩 Wordle")
        .setDescription(
            [
                `The word is **${game.target.length} letters**. ` +
                `**Anyone here can guess — just type a word.**`,
                `_Guesses do not have to be real words._`,
            ].join("\n"),
        )
        .addFields(
            { name: `Board — ${game.rows.length}/${WORDLE_RULES.MAX_ATTEMPTS}`, value: renderRows(game) },
            { name: "Letters", value: renderKeyboard(game) },
        );

    if (resultTitle) {
        embed.addFields({ name: resultTitle, value: resultBody ?? "​" });
    }

    embed.setFooter({
        text: game.finished
            ? "Run /wordle start for another."
            : `${MARK.HIT} right place · ${MARK.NEAR} wrong place · ${MARK.MISS} not in the word · ` +
              `${WORDLE_RULES.LIFETIME_MS / 60000} min`,
    });

    const components = game.finished
        ? []
        : [
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                      .setCustomId("wordle:giveup")
                      .setLabel("Give up")
                      .setEmoji("🏳️")
                      .setStyle(ButtonStyle.Danger),
              ),
          ];

    return { embeds: [embed], components };
}

// ── Starting ─────────────────────────────────────────────────────────────────

async function startGame(interaction, ctx) {
    const channelId = interaction.channelId;
    const length = interaction.options.getInteger("length") ?? null;

    if (sessions.has(channelId)) {
        const running = sessions.get(channelId);
        await respond(interaction, {
            content:
                `**There is already a wordle running here** — ${running.rows.length}/` +
                `${WORDLE_RULES.MAX_ATTEMPTS} guesses in. Type a word to join it, ` +
                "or `/wordle board` to see it again.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    let target;
    try {
        target = await drawWord(ctx.db, length);
    } catch (err) {
        await respond(interaction, { content: `**${err.message}**`, flags: MessageFlags.Ephemeral });
        return;
    }

    // ⚠️ Created, then rolled back if the reply fails — an /ox game once left a channel blocked
    // by a session whose board never appeared.
    const game = await sessions.withLock(channelId, async () => {
        if (sessions.has(channelId)) return null;
        return sessions.start({
            channelId,
            guildId: interaction.guildId,
            starterId: interaction.user.id,
            target,
        });
    });

    if (!game) {
        await respond(interaction, {
            content: "**Someone else just started one.** Type a word to join it.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    try {
        const message = await respond(interaction, boardView(game));
        game.messageId = message?.id ?? null;
    } catch (err) {
        sessions.end(channelId);
        await ctx.log(
            `wordle: could not show the board in ${channelId}, game rolled back — ${err.message}`,
            "warning",
            import.meta.url,
        );
        return;
    }

    game.timer = setTimeout(() => {
        void expireGame(interaction, ctx).catch(() => {});
    }, game.expiresAt - Date.now());

    // ⚠️ The target is logged at DEBUG only. It is the answer: at info level it would sit in a
    // log someone might reasonably paste into a channel.
    await ctx.log(
        `wordle started in ${channelId} by ${interaction.user.id} — ${target.length} letters`,
        import.meta.url,
    );
    await ctx.log(`wordle target in ${channelId} is "${target}"`, "debug", import.meta.url);
}

async function showBoard(interaction, ctx) {
    const game = sessions.get(interaction.channelId);
    if (!game) {
        await respond(interaction, {
            content: "No wordle is running here. Start one with `/wordle start`.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    await respond(interaction, boardView(game));
    void ctx;
}

async function showRules(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x1e90ff)
        .setTitle("🟩 Wordle — how it works")
        .setDescription(
            [
                `A hidden word of **4 to 6 letters** and **${WORDLE_RULES.MAX_ATTEMPTS} guesses**.`,
                "",
                `${MARK.HIT} the letter is in the word, **in that place**`,
                `${MARK.NEAR} the letter is in the word, **somewhere else**`,
                `${MARK.MISS} the letter is **not in the word**`,
                "",
                "**Anyone in the channel can guess** — just type a word. A guess of the wrong " +
                "length costs you nothing, and **guesses do not have to be real words**.",
                "",
                "_4-6 letters rather than the usual 5 is the original's own range, and so is the " +
                "letter tracker under the board._",
            ].join("\n"),
        );

    await respond(interaction, { embeds: [embed] });
}

// ── Guessing ─────────────────────────────────────────────────────────────────

async function handleTypedGuess(message, ctx, text) {
    const channelId = message.channelId;

    const step = await sessions.withLock(channelId, async () => {
        const game = sessions.get(channelId);
        if (!game || game.finished) return { gone: true };

        const problem = validateGuess(text, game.target);
        if (problem) return { problem, game };

        return { result: sessions.record(channelId, message.author.id, text) };
    });

    if (step.gone) return;

    // ⚠️ A wrong-length guess costs NOTHING — his rule. It gets a short reaction rather than a
    // message, because a channel playing wordle will produce a lot of these and six lines of
    // "too short" would bury the board.
    if (step.problem) {
        if (step.problem.code === "TOO_SHORT" || step.problem.code === "TOO_LONG") {
            await message.react(step.problem.code === "TOO_SHORT" ? "🔽" : "🔼").catch(() => {
                // Reactions need Add Reactions; failing is cosmetic, so it stays quiet here —
                // but only because the guess was already rejected without cost.
            });
        }
        return;
    }

    const { game, solved, exhausted, attempt } = step.result;

    let resultTitle = null;
    let resultBody = null;

    if (solved) {
        resultTitle = `🎉 Solved in ${attempt}/${WORDLE_RULES.MAX_ATTEMPTS}`;
        resultBody = `${message.author} got it — the word was **${game.target.toUpperCase()}**.`;
    } else if (exhausted) {
        // ⭐ His reveal, tone included: "The answer is {target} lol."
        resultTitle = "Out of guesses";
        resultBody = `The answer was **${game.target.toUpperCase()}** lol.`;
    }

    if (solved || exhausted) sessions.end(channelId);

    // ⚠️ Delete the BOT's previous board and post a fresh one, NOT the player's message. Ote:
    // *"i mean you shoukd remove your message, not user's/ right?"* — the guesses staying visible
    // is the point of playing in a channel.
    await replaceBoard(message, ctx, game, { resultTitle, resultBody });

    await ctx.log(
        `wordle in ${channelId}: ${message.author.id} guessed "${text.toLowerCase()}" ` +
        `(${attempt}/${WORDLE_RULES.MAX_ATTEMPTS})${solved ? " — SOLVED" : exhausted ? " — exhausted" : ""}`,
        import.meta.url,
    );
}

/**
 * Post the board again and remove the previous one, so the newest board is always at the bottom
 * of a channel people are typing into.
 *
 * ⚠️ The delete is LOGGED when it fails. A silent `.catch(() => {})` here once hid a failing
 * delete in the guess game and left two boards stacked with no trace anywhere — the legacy's
 * `except: pass` habit reappearing in new code.
 */
async function replaceBoard(message, ctx, game, viewOptions) {
    const previousId = game.messageId;

    let posted = null;
    try {
        posted = await message.channel.send(boardView(game, viewOptions));
        game.messageId = posted.id;
    } catch (err) {
        await ctx.log(`wordle: could not post the board — ${err.message}`, "warning", import.meta.url);
        return;
    }

    if (!previousId) return;
    try {
        const old = await message.channel.messages.fetch(previousId);
        await old.delete();
    } catch (err) {
        await ctx.log(
            `wordle: could not remove the previous board ${previousId} — ${err.message}`,
            "warning",
            import.meta.url,
        );
    }
}

// ── Ending ───────────────────────────────────────────────────────────────────

/** Give up. The starter or a configured bot admin, same rule as the other games. */
async function giveUp(interaction, ctx) {
    const channelId = interaction.channelId;
    const game = sessions.get(channelId);

    if (!game) {
        await respond(interaction, {
            content: "No wordle is running here.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const allowed = interaction.user.id === game.starterId || isBotAdmin(ctx.config, interaction.user.id);
    if (!allowed) {
        await respond(interaction, {
            content: `Only <@${game.starterId}> or a bot admin can end this game.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    game.finished = true;
    game.outcome = OUTCOME.GAVE_UP;
    sessions.end(channelId);

    await interaction.update(
        boardView(game, {
            resultTitle: "🏳️ Gave up",
            resultBody: `The answer was **${game.target.toUpperCase()}**.`,
        }),
    );

    await ctx.log(`wordle in ${channelId} was given up by ${interaction.user.id}`, import.meta.url);
}

/** Nobody guessed in time. Nothing is at stake, so this just reveals and closes. */
async function expireGame(interaction, ctx) {
    const channelId = interaction.channelId;
    const game = sessions.get(channelId);
    if (!game || game.finished) return;

    game.finished = true;
    game.outcome = OUTCOME.TIMED_OUT;
    sessions.end(channelId);

    try {
        await interaction.editReply(
            boardView(game, {
                resultTitle: "⌛ Out of time",
                resultBody: `Nobody guessed it. The answer was **${game.target.toUpperCase()}**.`,
            }),
        );
    } catch {
        // The board may be gone; the game is ended either way.
    }

    await ctx.log(`wordle in ${channelId} expired`, import.meta.url);
}
