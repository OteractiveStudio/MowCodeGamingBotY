/**
 * app/cogs/guess/index.js — the number guessing game.
 *
 * The legacy `guess_cog` was the biggest game at 302 lines, and its rules are kept whole in
 * `app/data/guess.js`. This file is only the Discord surface, and that surface is where the
 * platform forced real change:
 *
 * ⚠️ YOU CANNOT TYPE A BARE NUMBER ANY MORE. The legacy read every message in the channel
 * (`on_message` → `int(IM)`), which since 2022 needs the privileged Message Content intent —
 * without it `message.content` arrives EMPTY and the feature silently does nothing. So a
 * **Guess button opening a modal** replaces typing, and `/guess try` exists for anyone who
 * prefers a command.
 *
 * ⚠️ The ❌ reaction is replaced by a **Cancel button**. Same rule as his: only the starter
 * cancels, and a moderator can cancel without anyone paying.
 */

import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
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
                await interaction.reply(`Unknown subcommand \`${subcommand}\`.`);
            },
        },
    ],

    events: [],

    /** Buttons and the modal, routed here by their `guess:` customId prefix. */
    async handleComponent(interaction, ctx) {
        const [, action] = String(interaction.customId).split(":");

        if (action === "open" && interaction.isButton()) {
            return openGuessModal(interaction);
        }
        if (action === "submit" && interaction.isModalSubmit()) {
            const raw = interaction.fields.getTextInputValue("number").trim();
            const value = Number(raw);
            if (!Number.isInteger(value)) {
                await interaction.reply({
                    content: `\`${raw}\` is not a whole number.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            return submitGuess(interaction, ctx, value);
        }
        if (action === "cancel" && interaction.isButton()) {
            return cancelGame(interaction, ctx);
        }

        await interaction.reply({
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
              new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                      .setCustomId("guess:open")
                      .setLabel("Guess")
                      .setEmoji("🔢")
                      .setStyle(ButtonStyle.Primary),
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
        await interaction.reply({
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
        await interaction.reply({ content: `**${problem.message}.**`, flags: MessageFlags.Ephemeral });
        return;
    }

    const game = sessions.start({
        channelId,
        guildId: interaction.guildId,
        starterId: interaction.user.id,
        bet,
        target: target ?? null,
    });

    await interaction.reply(buildBoard(game));
    const message = await interaction.fetchReply();
    game.messageId = message.id;

    // The legacy used `await asyncio.sleep(300)` inline, which held the command coroutine
    // open for five minutes. A timer lets the handler finish and still expire the game.
    game.timer = setTimeout(() => {
        void finishGame(interaction, ctx, OUTCOME.TIMEOUT).catch(() => {});
    }, GUESS_RULES.LIFETIME_MS);

    await ctx.log(
        `guess game started in ${channelId} by ${interaction.user.id} — bet ${bet}, ` +
        `${game.withBot ? `bot target ${game.target}` : `player-set target ${game.target}`}`,
        import.meta.url,
    );
}

async function openGuessModal(interaction) {
    if (!sessions.has(interaction.channelId)) {
        await interaction.reply({
            content: "That game is over.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId("guess:submit")
        .setTitle("Guess the number")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("number")
                    .setLabel(`A number from ${GUESS_RULES.MIN_TARGET} to ${GUESS_RULES.MAX_TARGET}`)
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(1)
                    .setMaxLength(3)
                    .setRequired(true),
            ),
        );

    await interaction.showModal(modal);
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
        await interaction.reply({
            content: "There is no game running in this channel.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (result.problem) {
        const extra =
            result.problem.code === "ALREADY_GUESSED" ? ` (by <@${result.problem.by}>)` : "";
        await interaction.reply({
            content: `**${result.problem.message}**${extra}.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const { game, solved, exhausted, comparison } = result.recorded;

    if (solved || exhausted) {
        await interaction.reply({
            content: solved ? "Correct! 🎉" : "That was the last attempt.",
            flags: MessageFlags.Ephemeral,
        });
        await finishGame(
            interaction,
            ctx,
            solved ? OUTCOME.CORRECT : OUTCOME.EXHAUSTED,
            solved ? interaction.user.id : null,
        );
        return;
    }

    await interaction.reply({
        content: `\`${value}\` is **${comparison}** than the target. ${game.attempts}/${GUESS_RULES.MAX_ATTEMPTS} used.`,
        flags: MessageFlags.Ephemeral,
    });
    await updateBoard(interaction, game);
}

async function cancelGame(interaction, ctx) {
    const channelId = interaction.channelId;
    const game = sessions.get(channelId);

    if (!game) {
        await interaction.reply({ content: "That game is over.", flags: MessageFlags.Ephemeral });
        return;
    }

    const isStarter = interaction.user.id === game.starterId;
    // The legacy allowed the starter, an admin, or the guild's bot_manager_role. Discord's
    // own permission model covers the second two without a role id in our config.
    const isModerator = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;

    if (!isStarter && !isModerator) {
        await interaction.reply({
            content: "Only the player who started this game can cancel it.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.reply({
        content: isStarter ? "Cancelled — you forfeit the bet." : "Cancelled.",
        flags: MessageFlags.Ephemeral,
    });

    await finishGame(
        interaction,
        ctx,
        isStarter ? OUTCOME.CANCELLED_BY_STARTER : OUTCOME.CANCELLED_BY_MODERATOR,
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

    await interaction.reply({ embeds: [embed] });
}

// ── Finishing ────────────────────────────────────────────────────────────────

async function updateBoard(interaction, game, options) {
    try {
        await interaction.channel.messages.edit(game.messageId, buildBoard(game, options));
    } catch {
        // The board being gone must not stop the game from settling.
    }
}

/**
 * End a game and pay everyone, once. Settlement is computed by the pure `settle()` and
 * applied inside ONE transaction, so a game either pays everybody or nobody.
 */
async function finishGame(interaction, ctx, outcome, winnerId = null) {
    const channelId = interaction.channelId;

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
        lines.push("A moderator cancelled the game. Nobody paid anything.");
    }

    for (const movement of movements) {
        const sign = movement.amount >= 0 ? "+" : "";
        lines.push(`· <@${movement.discordId}> ${COIN} \`${sign}${movement.amount}\` — ${movement.note}`);
    }

    await updateBoard(interaction, game, {
        finished: true,
        resultTitle: "The game is ended",
        resultBody: lines.join("\n").slice(0, 1024),
    });

    await ctx.log(
        `guess game in ${channelId} ended (${outcome}), target ${game.target}, ` +
        `${game.attempts} attempt(s), ${movements.length} money movement(s)`,
        import.meta.url,
    );
}
