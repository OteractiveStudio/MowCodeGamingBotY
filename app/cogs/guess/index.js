/**
 * app/cogs/guess/index.js — the number guessing game.
 *
 * The legacy `guess_cog` was the biggest game at 302 lines, and its rules are kept whole in
 * `app/data/guess.js`. This file is only the Discord surface, and that surface is where the
 * platform forced real change:
 *
 * ⭐ YOU TYPE A BARE NUMBER IN CHAT TO GUESS — his original UX. Ote: *"can you make it the old
 * style where user type in chat to guess? it better ux then out in a form every time?"* and then
 * *"dont forget to remove guess button"*, so the button-and-modal version is gone entirely.
 *
 * ⚠️ This needs the privileged **Message Content** intent (since 2022). It is enabled on this
 * application, and `discord.message_content_intent` gates it — without the intent
 * `message.content` arrives EMPTY and typing would silently do nothing, which is why
 * `/guess try` survives as the guaranteed path.
 *
 * ⚠️ The ❌ reaction is replaced by a **Cancel button**. Same rule as his: only the starter
 * cancels, and a moderator can cancel without anyone paying.
 */

import { respond } from "../../bot/respond.js";
import {
    Events,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    InteractionContextType,
} from "discord.js";

import { ensurePlayer } from "../../data/player.js";
import { getState, addMoney, toInt } from "../../data/economy.js";
import {
    GuessSessions,
    GUESS_RULES,
    OUTCOME,
    settle,
    validateStart,
    validateGuess,
    payoutMultiplier,
} from "../../data/guess.js";

const COIN = "🪙";

/**
 * One store for the process. Module-level, but KEYED BY CHANNEL — which is the distinction
 * that mattered in the legacy: `guess_data[channel_id]` was fine, while `OX_board` and
 * `player_hand` were single values and so allowed exactly one game across every server.
 */
const sessions = new GuessSessions();

export default {
    name: "guess",
    description: "Guess the number. Bet on it.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("guess")
                .setDescription("The number guessing game.")
                .setContexts(InteractionContextType.Guild)
                .addSubcommand((sub) =>
                    sub
                        .setName("start")
                        .setDescription("Start a game in this channel.")
                        .addIntegerOption((option) =>
                            option
                                .setName("bet")
                                .setDescription(
                                    `How much to bet (${GUESS_RULES.MIN_BET}-${GUESS_RULES.MAX_BET}). Defaults to ${GUESS_RULES.DEFAULT_BET}.`,
                                )
                                .setMinValue(GUESS_RULES.MIN_BET)
                                .setMaxValue(GUESS_RULES.MAX_BET),
                        )
                        .addIntegerOption((option) =>
                            option
                                .setName("target")
                                .setDescription(
                                    "Set the number yourself instead of the bot. You then cannot guess.",
                                )
                                .setMinValue(GUESS_RULES.MIN_TARGET)
                                .setMaxValue(GUESS_RULES.MAX_TARGET),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("try")
                        .setDescription("Make a guess in the running game.")
                        .addIntegerOption((option) =>
                            option
                                .setName("number")
                                .setDescription(`A number from ${GUESS_RULES.MIN_TARGET} to ${GUESS_RULES.MAX_TARGET}.`)
                                .setMinValue(GUESS_RULES.MIN_TARGET)
                                .setMaxValue(GUESS_RULES.MAX_TARGET)
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub.setName("rules").setDescription("How the payouts work."),
                ),

            async execute(interaction, ctx) {
                const subcommand = interaction.options.getSubcommand();
                if (subcommand === "start") return startGame(interaction, ctx);
                if (subcommand === "try") {
                    return submitGuess(interaction, ctx, interaction.options.getInteger("number"));
                }
                if (subcommand === "rules") return showRules(interaction);
                await respond(interaction, `Unknown subcommand \`${subcommand}\`.`);
            },
        },
    ],

    events: [
        {
            /**
             * ⭐ TYPING A BARE NUMBER TO GUESS — his original UX, restored.
             *
             * Ote: *"can you make it the old style where user type in chat to guess? it better ux
             * then out in a form every time?"* He is right: a modal per guess is friction his
             * version did not have.
             *
             * ⚠️ THIS IS THE HANDLER HIS OWN CODE GOT MOST WRONG, so it is written against that.
             * `fishing_cog.on_message` called `b.g_trans(message.content, 'en')` — a NETWORK
             * TRANSLATION REQUEST — on **every message in every server**, just to test whether it
             * started with "fish". Several cogs each had their own `on_message` doing similar work.
             *
             * The rule that came out of it: **command detection must never depend on a network
             * round-trip.** So the order below is deliberate and every early return is free:
             *   1. is it a bot? (in-memory)
             *   2. is there a game in THIS channel? (a Map lookup)
             *   3. is the whole message just digits? (a regex on a short string)
             * Only then does anything touch the database. A channel with no game costs one Map
             * lookup per message, which is what makes this safe to leave on.
             */
            name: Events.MessageCreate,
            async handle(message, ctx) {
                if (message.author?.bot) return;
                if (!sessions.has(message.channelId)) return;

                const text = message.content?.trim();
                // Bare digits only. "42" is a guess; "42 maybe" and "haha" are conversation, and
                // players must be able to talk in a channel that has a game running.
                if (!text || !/^\d{1,3}$/.test(text)) return;

                const value = Number(text);
                await handleTypedGuess(message, ctx, value);
            },
        },
    ],

    /** Buttons and the modal, routed here by their `guess:` customId prefix. */
    async handleComponent(interaction, ctx) {
        const [, action] = String(interaction.customId).split(":");

        if (action === "cancel" && interaction.isButton()) {
            return cancelGame(interaction, ctx);
        }

        await respond(interaction, {
            content: "That control isn't one I recognise.",
            flags: MessageFlags.Ephemeral,
        });
    },
};

// ── The board ────────────────────────────────────────────────────────────────

function buildBoard(game, { finished = false, resultTitle = null, resultBody = null } = {}) {
    const embed = new EmbedBuilder()
        .setColor(finished ? 0x808080 : 0x00ff00)
        .setTitle("🔢 The Number Guessing Game 🔃")
        .setDescription(
            [
                `Anyone here can play — guess a number between **${GUESS_RULES.MIN_TARGET}** and **${GUESS_RULES.MAX_TARGET}**.`,
                game.withBot
                    ? "The bot picked the number."
                    : `<@${game.starterId}> set the number, so they cannot guess.`,
                `Bet: ${COIN} **${game.bet}** · this game lasts **5 minutes**.`,
            ].join("\n"),
        )
        .setFooter({
            text: `Guessed ${game.attempts} time${game.attempts === 1 ? "" : "s"} out of ${GUESS_RULES.MAX_ATTEMPTS}`,
        });

    if (game.guesses.length > 0) {
        embed.addFields({
            name: "Guess list…",
            value: game.guesses
                .map((guess) => {
                    const direction =
                        guess.value === game.target
                            ? "**the correct number!**"
                            : guess.value > game.target
                              ? "**higher** than the target"
                              : "**lower** than the target";
                    return `<@${guess.playerId}> guessed \`${guess.value}\` — ${direction}`;
                })
                .join("\n"),
        });
    }

    if (resultTitle) {
        embed.addFields({ name: resultTitle, value: resultBody ?? "​" });
    }

    const rows = finished
        ? []
        : [
              // ⚠️ Ote: "dont forget to remove guess button". You type the number now, so a
              // button that opens a form to type the same number is a step for nothing. Only
              // Cancel remains — it replaces his ❌ reaction and has no typed equivalent.
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                      .setCustomId("guess:cancel")
                      .setLabel("Cancel")
                      .setEmoji("❌")
                      .setStyle(ButtonStyle.Danger),
              ),
          ];

    return { embeds: [embed], components: rows };
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function startGame(interaction, ctx) {
    const channelId = interaction.channelId;

    if (sessions.has(channelId)) {
        await respond(interaction, {
            content:
                "There is already a game running in this channel. Use the **Guess** button on it, or `/guess try`.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const bet = interaction.options.getInteger("bet") ?? GUESS_RULES.DEFAULT_BET;
    const target = interaction.options.getInteger("target");

    await ensurePlayer(ctx.db, interaction.user);
    const state = await getState(ctx.db, interaction.user.id);

    const problem = validateStart({ bet, target, balance: toInt(state.money, "money") });
    if (problem) {
        await respond(interaction, { content: `**${problem.message}.**`, flags: MessageFlags.Ephemeral });
        return;
    }

    const game = sessions.start({
        channelId,
        guildId: interaction.guildId,
        starterId: interaction.user.id,
        bet,
        target: target ?? null,
    });

    // ⚠️ Roll the session back if the reply fails, or the channel is left holding a game that
    // was never shown and cannot be played — see the same guard in the ox cog.
    try {
        await respond(interaction, buildBoard(game));
        game.messageId = (await interaction.fetchReply()).id;
    } catch (err) {
        sessions.end(channelId);
        throw err;
    }

    // The legacy used `await asyncio.sleep(300)` inline, which held the command coroutine
    // open for five minutes. A timer lets the handler finish and still expire the game.
    game.timer = setTimeout(() => {
        void finishGame(interaction.channel, ctx, OUTCOME.TIMEOUT).catch(() => {});
    }, GUESS_RULES.LIFETIME_MS);

    await ctx.log(
        `guess game started in ${channelId} by ${interaction.user.id} — bet ${bet}, ` +
        `${game.withBot ? `bot target ${game.target}` : `player-set target ${game.target}`}`,
        import.meta.url,
    );
}


async function submitGuess(interaction, ctx, value) {
    const channelId = interaction.channelId;

    // ⚠️ Everything that reads-then-writes the game runs under the channel's lock. Two
    // players clicking at the same instant could otherwise both read attempts = 3, both
    // write 4, and both be told they won. The legacy's guard for this was one module-level
    // boolean shared by every channel, with a ten-second give-up.
    const result = await sessions.withLock(channelId, async () => {
        const game = sessions.get(channelId);
        if (!game) return { gone: true };

        const problem = validateGuess(game, interaction.user.id, value);
        if (problem) return { problem };

        await ensurePlayer(ctx.db, interaction.user);
        const recorded = sessions.record(channelId, interaction.user.id, value);
        return { recorded };
    });

    if (result.gone) {
        await respond(interaction, {
            content: "There is no game running in this channel.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (result.problem) {
        const extra =
            result.problem.code === "ALREADY_GUESSED" ? ` (by <@${result.problem.by}>)` : "";
        await respond(interaction, {
            content: `**${result.problem.message}**${extra}.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const { game, solved, exhausted, comparison } = result.recorded;

    if (solved || exhausted) {
        await respond(interaction, {
            content: solved ? "Correct! 🎉" : "That was the last attempt.",
            flags: MessageFlags.Ephemeral,
        });
        await finishGame(
            interaction.channel,
            ctx,
            solved ? OUTCOME.CORRECT : OUTCOME.EXHAUSTED,
            solved ? interaction.user.id : null,
        );
        return;
    }

    await respond(interaction, {
        content: `\`${value}\` is **${comparison}** than the target. ${game.attempts}/${GUESS_RULES.MAX_ATTEMPTS} used.`,
        flags: MessageFlags.Ephemeral,
    });
    await updateBoard(interaction.channel, game);
}

async function cancelGame(interaction, ctx) {
    const channelId = interaction.channelId;
    const game = sessions.get(channelId);

    if (!game) {
        await respond(interaction, { content: "That game is over.", flags: MessageFlags.Ephemeral });
        return;
    }

    const isStarter = interaction.user.id === game.starterId;
    // The legacy allowed the starter, an admin, or the guild's bot_manager_role. Discord's
    // own permission model covers the second two without a role id in our config.
    const isModerator = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;

    if (!isStarter && !isModerator) {
        await respond(interaction, {
            content: "Only the player who started this game can cancel it.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await respond(interaction, {
        content: isStarter ? "Cancelled — you forfeit the bet." : "Cancelled.",
        flags: MessageFlags.Ephemeral,
    });

    // ⚠️ Ote saw "A moderator cancelled the game" on his OWN game and could not tell who had done
    // it — *"wait what. is this you? or is it any user can cancel it?"*. It was neither: someone
    // else in the channel with Manage Messages clicked Cancel. The rule is his (starter, admin or
    // bot manager), but a cancellation that does not say WHO is unaccountable, so it names them now.
    await finishGame(
        interaction.channel,
        ctx,
        isStarter ? OUTCOME.CANCELLED_BY_STARTER : OUTCOME.CANCELLED_BY_MODERATOR,
        null,
        interaction.user.id,
    );
}

async function showRules(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x1e90ff)
        .setTitle("Guessing game — the rules")
        .setDescription(
            [
                `Bet ${COIN} **${GUESS_RULES.MIN_BET}–${GUESS_RULES.MAX_BET}**. ` +
                `**${GUESS_RULES.MAX_ATTEMPTS}** attempts, shared by everyone in the channel. ` +
                `The game lasts **5 minutes**.`,
                "",
                "**If someone gets it:**",
                `· 1st attempt → **×${payoutMultiplier(1)}** the bet`,
                `· within 3 → **×${payoutMultiplier(3)}**`,
                `· within 5 → **×${payoutMultiplier(5)}**`,
                `· 6th → **×${payoutMultiplier(6)}**`,
                `· 7th → nothing, but thanks for playing`,
                "",
                "Everyone else who guessed pays `round(their guesses × bet ÷ 7)` — so seven " +
                "guesses costs the whole bet.",
                "",
                "**If nobody gets it:** whoever set the target wins the bet. Against the bot, " +
                "nobody wins and the guessers still pay.",
                "",
                "Coins won or lost also move your exp, the same as fishing.",
            ].join("\n"),
        );

    await respond(interaction, { embeds: [embed] });
}

// ── Finishing ────────────────────────────────────────────────────────────────

/**
 * A guess typed straight into the channel.
 *
 * ⭐ Reproduces two things his version did that the button flow lost:
 *   · the guesser's message is DELETED, so the channel stays readable (his `ctx.message.delete()`)
 *   · the board is deleted and REPOSTED, so it stays at the bottom of the conversation instead of
 *     scrolling away above the guesses (his `msg.delete()` then `ctx.send(embed=...)`)
 *
 * Both are best-effort: without Manage Messages the delete fails, and that must not cost anyone
 * their guess.
 */
async function handleTypedGuess(message, ctx, value) {
    const channelId = message.channelId;

    const result = await sessions.withLock(channelId, async () => {
        const game = sessions.get(channelId);
        if (!game) return { gone: true };

        const problem = validateGuess(game, message.author.id, value);
        if (problem) return { problem };

        await ensurePlayer(ctx.db, message.author);
        return { recorded: sessions.record(channelId, message.author.id, value) };
    });

    if (result.gone) return;

    if (result.problem) {
        // A refusal is a short-lived reply rather than an edit to the board: it belongs to the
        // person who typed, not to the game.
        const extra = result.problem.code === "ALREADY_GUESSED" ? ` (by <@${result.problem.by}>)` : "";
        const notice = await message
            .reply({ content: `**${result.problem.message}**${extra}.` })
            .catch(() => null);
        // Tidy up after 15 seconds, like his `delete_after=20`.
        if (notice) setTimeout(() => void notice.delete().catch(() => {}), 15_000);
        return;
    }

    // ⚠️ Ote, 2026-08-13: *"dont del my message when i guess number."* His original deleted it
    // (`ctx.message.delete()`) to keep the channel tidy; he would rather see his own guesses. So the
    // message stays, and the board still reposts underneath so it follows the conversation down.
    const { game, solved, exhausted } = result.recorded;

    if (solved || exhausted) {
        await finishGame(message.channel, ctx, solved ? OUTCOME.CORRECT : OUTCOME.EXHAUSTED,
            solved ? message.author.id : null);
        return;
    }

    await repostBoard(message.channel, game, ctx);
}

/**
 * Post a fresh board and remove the previous one, so exactly ONE board exists and it sits at the
 * bottom of the conversation — his behaviour (`msg.delete()` then `ctx.send(embed=...)`).
 *
 * ⚠️ Ote: *"i mean you shoukd remove your message, not user's/ right?"* — yes, and the first
 * version silently failed to. The delete was wrapped in a bare `.catch(() => {})`, so when it did
 * not work there was nothing to see: two boards stacked up and the failure left no trace. That is
 * the legacy's `except: pass` habit sneaking back in. It now logs why.
 */
async function repostBoard(channel, game, ctx) {
    const previousId = game.messageId;

    let posted;
    try {
        posted = await channel.send(buildBoard(game));
        game.messageId = posted.id;
    } catch (err) {
        // Keep pointing at the old board rather than losing the game's only visible surface.
        await ctx?.log?.(`guess: could not post a new board: ${err.message}`, "warning", import.meta.url);
        return;
    }

    if (!previousId) return;

    try {
        await channel.messages.delete(previousId);
    } catch (err) {
        // A bot can always delete its OWN messages, so this failing is worth knowing about.
        await ctx?.log?.(
            `guess: could not delete the previous board ${previousId}: ${err.message}`,
            "warning",
            import.meta.url,
        );
    }
}

async function updateBoard(channel, game, options) {
    try {
        await channel.messages.edit(game.messageId, buildBoard(game, options));
    } catch {
        // The board being gone must not stop the game from settling.
    }
}

/**
 * End a game and pay everyone, once. Settlement is computed by the pure `settle()` and
 * applied inside ONE transaction, so a game either pays everybody or nobody.
 */
async function finishGame(channel, ctx, outcome, winnerId = null, byId = null) {
    const channelId = channel.id;

    const game = await sessions.withLock(channelId, async () => {
        const current = sessions.get(channelId);
        if (!current) return null;
        // Take it out of the map under the lock, so a click racing the 5-minute timer
        // cannot settle the same game twice.
        sessions.end(channelId);
        if (current.timer) clearTimeout(current.timer);
        return current;
    });

    if (!game) return;

    const movements = settle(game, outcome, winnerId);

    if (movements.length > 0) {
        await ctx.db.sequelize.transaction(async (transaction) => {
            for (const movement of movements) {
                // Coins won and lost move exp too — the legacy's money_add always did, and
                // unlike a transfer this cannot be farmed in a loop.
                await addMoney(ctx.db, {
                    discordId: movement.discordId,
                    amount: movement.amount,
                    reason: movement.reason,
                    ref: `guess:${game.target}`,
                    guildId: game.guildId,
                    transaction,
                });
            }
        });
    }

    const lines = [];
    if (outcome === OUTCOME.CORRECT) {
        lines.push(
            `<@${winnerId}> guessed **${game.target}** on attempt **${game.attempts}** — ` +
            `×${payoutMultiplier(game.attempts)} the bet.`,
        );
    } else if (outcome === OUTCOME.EXHAUSTED) {
        lines.push(`All ${GUESS_RULES.MAX_ATTEMPTS} attempts used. The number was **${game.target}**.`);
    } else if (outcome === OUTCOME.TIMEOUT) {
        lines.push(`Time is up! The number was **${game.target}**.`);
    } else if (outcome === OUTCOME.CANCELLED_BY_STARTER) {
        lines.push(`<@${game.starterId}> cancelled the game and forfeits the bet.`);
    } else {
        lines.push(
            byId
                ? `<@${byId}> cancelled the game as a moderator. Nobody paid anything.`
                : "A moderator cancelled the game. Nobody paid anything.",
        );
    }

    for (const movement of movements) {
        const sign = movement.amount >= 0 ? "+" : "";
        lines.push(`· <@${movement.discordId}> ${COIN} \`${sign}${movement.amount}\` — ${movement.note}`);
    }

    await updateBoard(channel, game, {
        finished: true,
        resultTitle: "The game is ended",
        resultBody: lines.join("\n").slice(0, 1024),
    });

    await ctx.log(
        `guess game in ${channelId} ended (${outcome}${byId ? ` by ${byId}` : ""}), ` +
        `target ${game.target}, ${game.attempts} attempt(s), ${movements.length} money movement(s)`,
        import.meta.url,
    );
}
