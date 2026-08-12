/**
 * app/cogs/ox/index.js — noughts and crosses on a real button grid.
 *
 * The rules are in `app/data/ox.js`, ported from the v1 monolith (`cogs/ox_cog.py` in the
 * refactor is a stub that replies *"Work in Progress."*).
 *
 * ⭐ THIS IS THE COMMAND THAT MOST NEEDED THE NEW PLATFORM. His version worked like this:
 * the bot printed the board as a text grid of cell labels in a code block, and you typed
 * `11`–`33` into the channel to claim a square, which his `on_message` listener parsed. Every
 * part of that is now either impossible or unnecessary:
 *
 *   · reading typed numbers needs the privileged Message Content intent since 2022
 *   · a **3×3 grid of buttons** IS the board — you click the square you want
 *   · his "type accept to accept the duel" becomes an **Accept / Decline** pair
 *   · his four-strikes-and-the-game-dies invalid-input counter has nothing left to count,
 *     because a button cannot be mistyped
 *
 * The board is still drawn as text in the embed as well, because his did and it reads well in
 * a transcript.
 */

import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    InteractionContextType,
} from "discord.js";

import { ensurePlayer } from "../../data/player.js";
import { getState, addMoney, toInt } from "../../data/economy.js";
import {
    OxSessions,
    OX_RULES,
    MARKS,
    cellLabel,
    winnerOf,
    isFull,
    botMove,
    validateOxStart,
    settle,
    markForTurn,
} from "../../data/ox.js";

const COIN = "🪙";
const sessions = new OxSessions();

export default {
    name: "ox",
    description: "Noughts and crosses, against a friend or the bot.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("ox")
                .setDescription("Play noughts and crosses.")
                .setContexts(InteractionContextType.Guild)
                .addSubcommand((sub) =>
                    sub
                        .setName("play")
                        .setDescription("Start a game in this channel.")
                        .addUserOption((option) =>
                            option
                                .setName("opponent")
                                .setDescription("Who to challenge. Leave empty to play the bot."),
                        )
                        .addIntegerOption((option) =>
                            option
                                .setName("bet")
                                .setDescription(
                                    `Coins to bet. Up to ${OX_RULES.MAX_BET_VS_BOT} vs the bot, ${OX_RULES.MAX_BET_VS_PLAYER} vs a player.`,
                                )
                                .setMinValue(0)
                                .setMaxValue(OX_RULES.MAX_BET_VS_PLAYER),
                        ),
                )
                .addSubcommand((sub) =>
                    sub.setName("rules").setDescription("How OX betting pays out."),
                ),

            async execute(interaction, ctx) {
                const subcommand = interaction.options.getSubcommand();
                if (subcommand === "play") return startGame(interaction, ctx);
                if (subcommand === "rules") return showRules(interaction);
                await interaction.reply(`Unknown subcommand \`${subcommand}\`.`);
            },
        },
    ],

    events: [],

    async handleComponent(interaction, ctx) {
        const [, action, argument] = String(interaction.customId).split(":");

        if (action === "accept" || action === "decline") {
            return answerChallenge(interaction, ctx, action === "accept");
        }
        if (action === "put") {
            return placeMark(interaction, ctx, Number(argument));
        }
        if (action === "quit") {
            return quitGame(interaction, ctx);
        }

        await interaction.reply({
            content: "That control isn't one I recognise.",
            flags: MessageFlags.Ephemeral,
        });
    },
};

// ── Rendering ────────────────────────────────────────────────────────────────

/** His `OX_print_board`: a text grid, kept because it reads well in the scrollback. */
function textBoard(board) {
    const cell = (index) => board[index] ?? cellLabel(index);
    return (
        "```\n" +
        [0, 3, 6].map((row) => [0, 1, 2].map((offset) => ` ${cell(row + offset)}`).join(" ")).join("\n") +
        "\n```"
    );
}

function boardRows(game, { finished = false, winningLine = null } = {}) {
    const rows = [];

    for (let row = 0; row < 3; row += 1) {
        const buttons = [];
        for (let column = 0; column < 3; column += 1) {
            const index = row * 3 + column;
            const mark = game.board[index];
            const isWinning = winningLine?.includes(index);

            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`ox:put:${index}`)
                    // An empty square shows its old label, so his 11–33 grid is still legible.
                    .setLabel(mark ?? cellLabel(index))
                    .setStyle(
                        isWinning
                            ? ButtonStyle.Success
                            : mark === MARKS.FIRST
                              ? ButtonStyle.Primary
                              : mark === MARKS.SECOND
                                ? ButtonStyle.Danger
                                : ButtonStyle.Secondary,
                    )
                    .setDisabled(finished || mark !== null),
            );
        }
        rows.push(new ActionRowBuilder().addComponents(buttons));
    }

    if (!finished) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("ox:quit")
                    .setLabel("Give up")
                    .setEmoji("🏳️")
                    .setStyle(ButtonStyle.Secondary),
            ),
        );
    }

    return rows;
}

function nameOf(game, playerId) {
    if (playerId === "bot") return "the bot";
    return `<@${playerId}>`;
}

function boardView(game, { finished = false, winningLine = null, resultLines = [] } = {}) {
    const turnPlayer = sessions.currentPlayer(game);
    const mark = markForTurn(game.moves);

    const embed = new EmbedBuilder()
        .setColor(finished ? 0x808080 : 0x00ff00)
        .setTitle("⭕❌ OX")
        .setDescription(
            [
                `${nameOf(game, game.challengerId)} **O**  vs  ${nameOf(game, game.opponentId ?? "bot")} **X**`,
                game.bet > 0 ? `Bet: ${COIN} **${game.bet}**` : "A friendly game — no coins on it.",
                textBoard(game.board),
                finished ? "" : `It is ${nameOf(game, turnPlayer)}'s turn — **${mark}**.`,
            ]
                .filter(Boolean)
                .join("\n"),
        );

    if (resultLines.length > 0) {
        embed.addFields({ name: "Result", value: resultLines.join("\n").slice(0, 1024) });
    }

    return { embeds: [embed], components: boardRows(game, { finished, winningLine }) };
}

function challengeView(game) {
    const embed = new EmbedBuilder()
        .setColor(0x1e90ff)
        .setTitle("⭕❌ OX — a duel is offered")
        .setDescription(
            [
                `<@${game.challengerId}> challenges <@${game.opponentId}>.`,
                game.bet > 0
                    ? `Stake: ${COIN} **${game.bet}** each way — the winner takes it from the loser.`
                    : "No coins on it, just pride.",
                `<@${game.opponentId}>, do you accept?`,
            ].join("\n"),
        )
        .setFooter({ text: "The offer lapses in 2 minutes." });

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("ox:accept")
                    .setLabel("Accept")
                    .setEmoji("⚔️")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("ox:decline")
                    .setLabel("Decline")
                    .setEmoji("🙅")
                    .setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function startGame(interaction, ctx) {
    const channelId = interaction.channelId;

    if (sessions.has(channelId)) {
        const running = sessions.get(channelId);
        await interaction.reply({
            content:
                `There is already an OX game in this channel (${nameOf(running, running.challengerId)}). ` +
                `Wait for it to finish.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const opponent = interaction.options.getUser("opponent");
    const bet = interaction.options.getInteger("bet") ?? 0;
    const withBot = !opponent || opponent.id === interaction.client.user.id;

    if (opponent && opponent.bot && opponent.id !== interaction.client.user.id) {
        await interaction.reply({
            content: "Other bots do not play OX.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (opponent && opponent.id === interaction.user.id) {
        await interaction.reply({
            content: "You cannot duel yourself.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await ensurePlayer(ctx.db, interaction.user);
    const challengerState = await getState(ctx.db, interaction.user.id);

    let opponentState = null;
    if (!withBot) {
        await ensurePlayer(ctx.db, opponent);
        opponentState = await getState(ctx.db, opponent.id);
    }

    const problem = validateOxStart({
        bet,
        withBot,
        challengerBalance: toInt(challengerState.money, "money"),
        opponentBalance: opponentState ? toInt(opponentState.money, "money") : null,
    });

    if (problem) {
        await interaction.reply({ content: `**${problem.message}.**`, flags: MessageFlags.Ephemeral });
        return;
    }

    const game = sessions.start({
        channelId,
        guildId: interaction.guildId,
        challengerId: interaction.user.id,
        opponentId: withBot ? null : opponent.id,
        bet,
        withBot,
    });

    await interaction.reply(withBot ? boardView(game) : challengeView(game));
    game.messageId = (await interaction.fetchReply()).id;

    game.timer = setTimeout(() => {
        void expireGame(interaction, ctx).catch(() => {});
    }, game.expiresAt - Date.now());

    await ctx.log(
        `ox game started in ${channelId} by ${interaction.user.id} — ` +
        `${withBot ? "vs bot" : `vs ${opponent.id} (awaiting accept)`}, bet ${bet}`,
        import.meta.url,
    );
}

async function showRules(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x1e90ff)
        .setTitle("OX — how the betting works")
        .setDescription(
            [
                "**Against a player:** the winner takes the whole bet from the loser. " +
                `Up to ${COIN} **${OX_RULES.MAX_BET_VS_PLAYER}**, and you both have to be able to afford it.`,
                "",
                "**Against the bot:** winning pays **half** the bet; losing costs **all** of it. " +
                `Capped at ${COIN} **${OX_RULES.MAX_BET_VS_BOT}**.`,
                "",
                "A draw costs nobody anything.",
                "",
                "_The bot plays at random on purpose. With half-up and all-down odds, a bot that " +
                "played properly would make betting against it a pure loss._",
            ].join("\n"),
        );

    await interaction.reply({ embeds: [embed] });
}

// ── Components ───────────────────────────────────────────────────────────────

async function answerChallenge(interaction, ctx, accepted) {
    const channelId = interaction.channelId;
    const game = sessions.get(channelId);

    if (!game || game.accepted) {
        await interaction.reply({
            content: "There is no challenge waiting here.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (interaction.user.id !== game.opponentId) {
        await interaction.reply({
            content: `That duel is for <@${game.opponentId}>.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (!accepted) {
        sessions.end(channelId);
        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x808080)
                    .setTitle("⭕❌ OX — declined")
                    .setDescription(`<@${game.opponentId}> turned down the duel. No coins moved.`),
            ],
            components: [],
        });
        return;
    }

    game.accepted = true;
    game.expiresAt = Date.now() + OX_RULES.GAME_TIMEOUT_MS;
    if (game.timer) clearTimeout(game.timer);
    game.timer = setTimeout(() => {
        void expireGame(interaction, ctx).catch(() => {});
    }, OX_RULES.GAME_TIMEOUT_MS);

    await interaction.update(boardView(game));
}

async function placeMark(interaction, ctx, index) {
    const channelId = interaction.channelId;

    // Under the lock: two players tapping squares in the same instant would otherwise both
    // read the same move count and both write it.
    const outcome = await sessions.withLock(channelId, async () => {
        const game = sessions.get(channelId);
        if (!game) return { gone: true };
        if (!game.accepted) return { notYet: true };

        const turnPlayer = sessions.currentPlayer(game);
        if (interaction.user.id !== turnPlayer) {
            return { notYourTurn: true, turnPlayer, game };
        }
        if (!Number.isInteger(index) || index < 0 || index > 8 || game.board[index] !== null) {
            return { taken: true };
        }

        const afterPlayer = sessions.place(game, index);
        if (afterPlayer.finished) {
            return { game, finished: true, win: afterPlayer.win, playerMoved: true };
        }

        // The bot answers inside the same lock, so the board can never be seen mid-turn.
        if (game.withBot) {
            const botIndex = botMove(game.board);
            if (botIndex >= 0) {
                const afterBot = sessions.place(game, botIndex);
                return {
                    game,
                    finished: afterBot.finished,
                    win: afterBot.win,
                    botIndex,
                    playerMoved: true,
                };
            }
        }

        return { game, finished: false, playerMoved: true };
    });

    if (outcome.gone) {
        await interaction.reply({ content: "That game is over.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (outcome.notYet) {
        await interaction.reply({
            content: "The duel has not been accepted yet.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (outcome.notYourTurn) {
        await interaction.reply({
            content: `It is ${nameOf(outcome.game, outcome.turnPlayer)}'s turn.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (outcome.taken) {
        await interaction.reply({
            content: "That square is taken.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const { game, finished, win, botIndex } = outcome;

    if (!finished) {
        await interaction.update(boardView(game));
        return;
    }

    // Someone won, or the board filled.
    let result;
    if (win) {
        const winnerIsChallenger = win.mark === MARKS.FIRST;
        result = game.withBot
            ? winnerIsChallenger
                ? "challenger"
                : "bot"
            : winnerIsChallenger
              ? "challenger"
              : "opponent";
    } else {
        result = "draw";
    }

    const lines = [];
    if (botIndex !== undefined && win && result === "bot") {
        lines.push(`The bot played **${cellLabel(botIndex)}** and won.`);
    } else if (botIndex !== undefined) {
        lines.push(`The bot played **${cellLabel(botIndex)}**.`);
    }

    if (result === "draw") {
        lines.push("**Draw.** The board is full and nobody has to lose their coins.");
    } else if (result === "bot") {
        lines.push("**The bot wins.**");
    } else {
        const winnerId = result === "challenger" ? game.challengerId : game.opponentId;
        lines.push(`**<@${winnerId}> wins** with their ${win.mark}s.`);
    }

    const movements = settle({
        bet: game.bet,
        withBot: game.withBot,
        challengerId: game.challengerId,
        opponentId: game.opponentId,
        outcome: result,
    });

    if (movements.length > 0) {
        await ctx.db.sequelize.transaction(async (transaction) => {
            for (const movement of movements) {
                await addMoney(ctx.db, {
                    discordId: movement.discordId,
                    amount: movement.amount,
                    reason: movement.reason,
                    ref: `ox:${game.withBot ? "bot" : "duel"}`,
                    guildId: game.guildId,
                    transaction,
                });
            }
        });

        for (const movement of movements) {
            const sign = movement.amount >= 0 ? "+" : "";
            lines.push(`· <@${movement.discordId}> ${COIN} \`${sign}${movement.amount}\` — ${movement.note}`);
        }
    }

    sessions.end(channelId);

    await interaction.update(
        boardView(game, { finished: true, winningLine: win?.line ?? null, resultLines: lines }),
    );

    await ctx.log(
        `ox game in ${channelId} ended (${result}) after ${game.moves} move(s), ` +
        `${movements.length} money movement(s)`,
        import.meta.url,
    );
}

/**
 * Giving up. The legacy had no such thing — a game simply sat there forever, and because its
 * state was global, an abandoned board blocked OX for every server at once.
 */
async function quitGame(interaction, ctx) {
    const channelId = interaction.channelId;
    const game = sessions.get(channelId);

    if (!game) {
        await interaction.reply({ content: "That game is over.", flags: MessageFlags.Ephemeral });
        return;
    }

    const players = [game.challengerId, game.opponentId].filter(Boolean);
    if (!players.includes(interaction.user.id)) {
        await interaction.reply({
            content: "Only the players can end this game.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const quitterId = interaction.user.id;
    const lines = [`<@${quitterId}> gave up.`];

    // Giving up loses exactly what losing loses — otherwise quitting is a free escape from a
    // lost position, which would make every bet meaningless.
    const result = game.withBot
        ? "bot"
        : quitterId === game.challengerId
          ? "opponent"
          : "challenger";

    const movements = settle({
        bet: game.bet,
        withBot: game.withBot,
        challengerId: game.challengerId,
        opponentId: game.opponentId,
        outcome: result,
    });

    if (movements.length > 0) {
        await ctx.db.sequelize.transaction(async (transaction) => {
            for (const movement of movements) {
                await addMoney(ctx.db, {
                    discordId: movement.discordId,
                    amount: movement.amount,
                    reason: movement.reason,
                    ref: "ox:forfeit",
                    guildId: game.guildId,
                    transaction,
                });
            }
        });
        for (const movement of movements) {
            const sign = movement.amount >= 0 ? "+" : "";
            lines.push(`· <@${movement.discordId}> ${COIN} \`${sign}${movement.amount}\` — ${movement.note}`);
        }
    }

    sessions.end(channelId);
    await interaction.update(boardView(game, { finished: true, resultLines: lines }));
}

/** Nobody moved in time. Nothing is paid — an idle board is not a loss. */
async function expireGame(interaction, ctx) {
    const channelId = interaction.channelId;
    const game = sessions.get(channelId);
    if (!game) return;

    sessions.end(channelId);

    const lines = game.accepted
        ? ["Nobody moved in time, so the game was abandoned. No coins moved."]
        : [`<@${game.opponentId}> did not answer, so the duel lapsed. No coins moved.`];

    try {
        await interaction.editReply(boardView(game, { finished: true, resultLines: lines }));
    } catch {
        // The board may be gone; the game is ended either way.
    }

    await ctx.log(`ox game in ${channelId} expired (accepted=${game.accepted})`, import.meta.url);
}
