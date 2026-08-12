/**
 * app/cogs/blackjack/index.js — `/blackjack` and `/bj`.
 *
 * Rules and every fix live in `app/data/blackjack.js`. This file is the Discord surface, the
 * buttons that replace his typed `h`/`s`/`dd`/`sd`/`in` decisions, and the one transaction that
 * moves the coins.
 *
 * ⭐ THE HANDS ARE PUBLIC, not ephemeral. An earlier note in the carry-on assumed blackjack
 * needed private hands "so players cannot see each other's cards" — that was wrong, and worth
 * correcting rather than quietly dropping: his blackjack is **one player against the dealer**,
 * so there are no other players' cards to hide. The only hidden card is the dealer's hole card,
 * which the embed keeps face down until the hand is played out. Public also matches what he
 * asked for everywhere else — *"everyone can see when user call market"*.
 *
 * ⭐ `/bj` exists because he wrote `bj`, `Bj` and `BJ` as three separate commands that all
 * forwarded to the same one. Slash command names must be lowercase, so the aliases collapse to
 * one short form beside the long one.
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

import { respond } from "../../bot/respond.js";
import { ensurePlayer } from "../../data/player.js";
import { getState, addMoney, toInt } from "../../data/economy.js";
import {
    BLACKJACK_RULES,
    BlackjackSessions,
    DECISION,
    OUTCOME,
    availableDecisions,
    compareHands,
    dealerHasNatural,
    draw,
    handTotal,
    holeCard,
    isBust,
    isNatural,
    maxBet,
    playDealer,
    settle,
    upCard,
    validateStart,
} from "../../data/blackjack.js";

const COIN = "🪙";
const HIDDEN = "🂠";

const sessions = new BlackjackSessions();

export default {
    name: "blackjack",
    description: "Blackjack against the dealer.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("blackjack")
                .setDescription("Play a hand of blackjack against the dealer.")
                .setContexts(InteractionContextType.Guild)
                .addIntegerOption((option) =>
                    option
                        .setName("bet")
                        .setDescription(
                            `At least ${BLACKJACK_RULES.MIN_BET}, at most half your coins. Default: ${BLACKJACK_RULES.MIN_BET}.`,
                        )
                        .setRequired(false)
                        .setMinValue(BLACKJACK_RULES.MIN_BET),
                ),

            async execute(interaction, ctx) {
                return startHand(interaction, ctx);
            },
        },
        {
            // His `bj` / `Bj` / `BJ` trio, collapsed — slash names are lowercase only.
            data: new SlashCommandBuilder()
                .setName("bj")
                .setDescription("Blackjack — the short name.")
                .setContexts(InteractionContextType.Guild)
                .addIntegerOption((option) =>
                    option
                        .setName("bet")
                        .setDescription(`At least ${BLACKJACK_RULES.MIN_BET}, at most half your coins.`)
                        .setRequired(false)
                        .setMinValue(BLACKJACK_RULES.MIN_BET),
                ),

            async execute(interaction, ctx) {
                return startHand(interaction, ctx);
            },
        },
    ],

    events: [],

    async handleComponent(interaction, ctx) {
        const [, action] = String(interaction.customId).split(":");

        if (Object.values(DECISION).includes(action)) {
            return decide(interaction, ctx, action);
        }

        // ⚠️ There is deliberately NO quit/cancel button. **Surrender** is the player's way out
        // and costs half the bet, which is his rule; a second "quit" beside it would be two
        // buttons for one action with different prices. An abandoned hand clears itself after
        // `LIFETIME_MS`, so no admin escape hatch is needed either — and an unrendered button
        // routed here would just be dead code, which this project has already been bitten by.
        await respond(interaction, {
            content: "That control isn't one I recognise.",
            flags: MessageFlags.Ephemeral,
        });
    },
};

// ── Rendering ────────────────────────────────────────────────────────────────

function renderHand(cards, { hideHole = false } = {}) {
    if (hideHole) {
        // ⚠️ Index 0 is the HOLE card in his deal order — see the data module. The visible card
        // is index 1, which is what he printed too.
        return `${HIDDEN} ${cards.slice(1).map((card) => card.label).join(" ")}`;
    }
    return cards.map((card) => card.label).join(" ");
}

function describeTotal(cards) {
    const { total, soft } = handTotal(cards);
    return soft ? `${total} (soft)` : `${total}`;
}

function buttonsFor(game) {
    const decisions = availableDecisions(game);
    if (decisions.length === 0) return [];

    const meta = {
        [DECISION.HIT]: { label: "Hit", emoji: "🗡️", style: ButtonStyle.Primary },
        [DECISION.STAND]: { label: "Stand", emoji: "🗿", style: ButtonStyle.Secondary },
        [DECISION.DOUBLE]: { label: "Double Down", emoji: "📌", style: ButtonStyle.Success },
        [DECISION.SURRENDER]: { label: "Surrender", emoji: "🏳️", style: ButtonStyle.Danger },
        [DECISION.INSURE]: { label: "Insurance", emoji: "🤝", style: ButtonStyle.Primary },
        [DECISION.DECLINE_INSURANCE]: { label: "No thanks", emoji: "▶️", style: ButtonStyle.Secondary },
    };

    const row = new ActionRowBuilder().addComponents(
        decisions.map((decision) =>
            new ButtonBuilder()
                .setCustomId(`blackjack:${decision}`)
                .setLabel(meta[decision].label)
                .setEmoji(meta[decision].emoji)
                .setStyle(meta[decision].style),
        ),
    );

    return [row];
}

function tableView(game, { resultLines = null, balance = null } = {}) {
    const finished = game.finished;
    const dealerCards = renderHand(game.dealerCards, { hideHole: !finished });
    const dealerTotal = finished ? describeTotal(game.dealerCards) : `? + ${upCard(game.dealerCards).value}`;

    const embed = new EmbedBuilder()
        .setColor(finished ? (game.settlement?.amount > 0 ? 0x2ecc71 : game.settlement?.amount < 0 ? 0xe74c3c : 0x95a5a6) : 0x1e90ff)
        .setTitle("🃏 Blackjack")
        .setDescription(
            `<@${game.playerId}> is playing for ${COIN} **${game.bet}**` +
            (game.doubled ? ` — **doubled to ${game.bet * 2}**` : "") +
            (game.insurance > 0 ? ` · insurance ${COIN} **${game.insurance}**` : ""),
        )
        .addFields(
            { name: "Dealer", value: `${dealerCards}\n**${dealerTotal}**`, inline: true },
            {
                name: "You",
                value: `${renderHand(game.playerCards)}\n**${describeTotal(game.playerCards)}**`,
                inline: true,
            },
        );

    if (game.insurancePending) {
        embed.addFields({
            name: "🤝 The dealer is showing an Ace",
            value:
                `Insurance costs ${COIN} **${Math.trunc(game.bet * BLACKJACK_RULES.INSURANCE_FRACTION)}** ` +
                `(half your bet) and pays **${BLACKJACK_RULES.INSURANCE_PAYOUT}:1** if the dealer has ` +
                "blackjack. If they do not, you lose only that side bet and the hand carries on.",
        });
    }

    if (resultLines) {
        embed.addFields({ name: "Result", value: resultLines.join("\n") });
    }

    if (balance !== null) {
        embed.addFields({ name: "Balance", value: `${COIN} **${balance}**` });
    }

    embed.setFooter({
        text: finished
            ? "Run /blackjack to play another hand."
            : `Dealer stands on ${BLACKJACK_RULES.DEALER_STANDS_ON} · ` +
              `${BLACKJACK_RULES.LIFETIME_MS / 60000} minutes to decide`,
    });

    return { embeds: [embed], components: buttonsFor(game) };
}

// ── Starting ─────────────────────────────────────────────────────────────────

async function startHand(interaction, ctx) {
    const channelId = interaction.channelId;
    const bet = interaction.options.getInteger("bet") ?? BLACKJACK_RULES.MIN_BET;

    await ensurePlayer(ctx.db, interaction.user);
    const state = await getState(ctx.db, interaction.user.id);
    const balance = toInt(state.money, "money");

    const problem = validateStart({ bet, balance });
    if (problem) {
        await respond(interaction, {
            content: `**${problem.message}.**`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // ⚠️ Created under the lock and ROLLED BACK if the reply fails. An /ox hand once created a
    // session before replying, and a reply that died on the 3-second limit left the channel
    // blocked by a game nobody could see. Same shape, same guard.
    const existing = await sessions.withLock(channelId, async () => {
        if (sessions.has(channelId)) return sessions.get(channelId);
        sessions.start({
            channelId,
            guildId: interaction.guildId,
            playerId: interaction.user.id,
            bet,
        });
        return null;
    });

    if (existing) {
        await respond(interaction, {
            content:
                `**There is already a hand running in this channel**, played by <@${existing.playerId}>. ` +
                "Wait for it to finish.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const game = sessions.get(channelId);

    // ⭐ A natural wins immediately, exactly as his did — his checked the opening two cards
    // before ever offering a decision.
    if (isNatural(game.playerCards)) {
        playDealer(game.deck, game.dealerCards);
        await finish(interaction, ctx, game, OUTCOME.PLAYER_NATURAL, { isUpdate: false });
        return;
    }

    try {
        await respond(interaction, tableView(game));
    } catch (err) {
        sessions.end(channelId);
        await ctx.log(
            `blackjack: could not show the table in ${channelId}, hand rolled back — ${err.message}`,
            "warning",
            import.meta.url,
        );
        return;
    }

    game.timer = setTimeout(() => {
        void expireHand(interaction, ctx).catch(() => {});
    }, game.expiresAt - Date.now());

    await ctx.log(
        `blackjack: ${interaction.user.id} opened a hand in ${channelId} for ${bet}` +
        (game.insurancePending ? " (dealer shows an Ace, insurance offered)" : ""),
        import.meta.url,
    );
}

// ── Deciding ─────────────────────────────────────────────────────────────────

async function decide(interaction, ctx, decision) {
    const channelId = interaction.channelId;

    const step = await sessions.withLock(channelId, async () => {
        const game = sessions.get(channelId);
        if (!game) return { gone: true };
        if (game.finished) return { gone: true };
        if (interaction.user.id !== game.playerId) return { notYours: true, game };
        if (!availableDecisions(game).includes(decision)) return { notAllowed: true, game };

        // ── Insurance, offered before the hand proper ────────────────────────
        if (game.insurancePending) {
            game.insurancePending = false;

            if (decision === DECISION.INSURE) {
                game.insurance = Math.trunc(game.bet * BLACKJACK_RULES.INSURANCE_FRACTION);

                // ⭐ REAL insurance resolves at once: if the dealer has blackjack the hand is
                // over, and the side bet paying 2:1 offsets the main bet. His version paid
                // +2× the whole bet and ended the game, or charged −1.5× and played on.
                if (dealerHasNatural(game.dealerCards)) {
                    return { settleAs: OUTCOME.DEALER_WINS, game, dealerNatural: true };
                }
                return { redraw: true, game };
            }

            // Declined. If the dealer had blackjack the hand is still over.
            if (dealerHasNatural(game.dealerCards)) {
                return { settleAs: OUTCOME.DEALER_WINS, game, dealerNatural: true };
            }
            return { redraw: true, game };
        }

        // ── The hand proper ─────────────────────────────────────────────────
        if (decision === DECISION.SURRENDER) {
            return { settleAs: OUTCOME.SURRENDERED, game };
        }

        if (decision === DECISION.HIT) {
            game.playerCards.push(draw(game.deck));

            // ✅ FIXED — his hitting loop never tested this, so a player could hit past 21 and
            // keep being asked whether they wanted another card.
            if (isBust(game.playerCards)) {
                playDealer(game.deck, game.dealerCards);
                return { settleAs: OUTCOME.PLAYER_BUST, game };
            }
            return { redraw: true, game };
        }

        if (decision === DECISION.DOUBLE) {
            game.doubled = true;
            game.playerCards.push(draw(game.deck));
            playDealer(game.deck, game.dealerCards);
            return {
                settleAs: isBust(game.playerCards)
                    ? OUTCOME.PLAYER_BUST
                    : compareHands(game.playerCards, game.dealerCards),
                game,
            };
        }

        if (decision === DECISION.STAND) {
            playDealer(game.deck, game.dealerCards);
            return { settleAs: compareHands(game.playerCards, game.dealerCards), game };
        }

        return { notAllowed: true, game };
    });

    if (step.gone) {
        await respond(interaction, {
            content: "That hand is already over.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (step.notYours) {
        await respond(interaction, {
            content: `**This hand is <@${step.game.playerId}>'s.** Start your own with \`/blackjack\`.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    if (step.notAllowed) {
        await respond(interaction, {
            content: "You cannot do that right now.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (step.redraw) {
        await interaction.update(tableView(step.game));
        return;
    }

    await finish(interaction, ctx, step.game, step.settleAs, {
        isUpdate: true,
        dealerNatural: step.dealerNatural ?? false,
    });
}

// ── Finishing ────────────────────────────────────────────────────────────────

async function finish(interaction, ctx, game, outcome, { isUpdate, dealerNatural = false }) {
    game.finished = true;
    game.outcome = outcome;

    // ⭐ Settled ONCE — the money and the message both come from this object. His called
    // check_point twice, once for each.
    const settlement = settle({
        outcome,
        bet: game.bet,
        doubled: game.doubled,
        insurance: game.insurance,
        dealerNatural: dealerNatural || dealerHasNatural(game.dealerCards),
    });
    game.settlement = settlement;

    sessions.end(game.channelId);

    // ⚠️ ONE TRANSACTION for the hand and the side bet together. Settling the hand but not the
    // insurance — or the reverse — would leave a player charged for a loss that insurance was
    // supposed to cover.
    let balance = null;
    if (settlement.movements.length > 0) {
        await ctx.db.sequelize.transaction(async (transaction) => {
            for (const movement of settlement.movements) {
                const result = await addMoney(ctx.db, {
                    discordId: game.playerId,
                    amount: movement.amount,
                    reason: movement.reason,
                    ref:
                        movement.tag === "insurance"
                            ? "blackjack:insurance"
                            : `blackjack:${outcome}${game.doubled ? ":doubled" : ""}`,
                    guildId: game.guildId,
                    transaction,
                });
                balance = result.money;
            }
        });
    } else {
        const state = await getState(ctx.db, game.playerId);
        balance = toInt(state.money, "money");
    }

    const lines = [`**${settlement.note}.**`];

    if (settlement.insuranceAmount !== 0) {
        lines.push(
            settlement.insuranceAmount > 0
                ? `🤝 Insurance paid ${COIN} **${settlement.insuranceAmount}** — the dealer had blackjack.`
                : `🤝 Insurance lost ${COIN} **${Math.abs(settlement.insuranceAmount)}** — no blackjack.`,
        );
    }

    if (settlement.amount > 0) lines.push(`✅ You win ${COIN} **${settlement.amount}**.`);
    else if (settlement.amount < 0) lines.push(`❌ You lose ${COIN} **${Math.abs(settlement.amount)}**.`);
    else lines.push("➖ Nothing moves.");

    const view = tableView(game, { resultLines: lines, balance });

    try {
        if (isUpdate) await interaction.update(view);
        else await respond(interaction, view);
    } catch (err) {
        // The money is already moved and logged; a lost message must not undo that.
        await ctx.log(
            `blackjack: settled ${outcome} in ${game.channelId} but could not show it — ${err.message}`,
            "warning",
            import.meta.url,
        );
    }

    await ctx.log(
        `blackjack: ${game.playerId} finished ${outcome} in ${game.channelId} — ` +
        `player ${handTotal(game.playerCards).total} vs dealer ${handTotal(game.dealerCards).total}, ` +
        `hole ${holeCard(game.dealerCards)?.rank}, ${settlement.amount >= 0 ? "+" : ""}${settlement.amount}, ` +
        `balance ${balance}`,
        import.meta.url,
    );
}

/**
 * ⚠️ A timeout STANDS the hand rather than forfeiting it. Going quiet should not be worse than
 * surrendering, which costs half — so the dealer plays out and the cards decide. His had no
 * timeout at all, and because the state was global one idle hand blocked blackjack everywhere.
 */
async function expireHand(interaction, ctx) {
    const channelId = interaction.channelId;

    const game = await sessions.withLock(channelId, async () => {
        const current = sessions.get(channelId);
        if (!current || current.finished) return null;
        playDealer(current.deck, current.dealerCards);
        return current;
    });

    if (!game) return;

    const outcome = isBust(game.playerCards)
        ? OUTCOME.PLAYER_BUST
        : compareHands(game.playerCards, game.dealerCards);

    await ctx.log(
        `blackjack: hand in ${channelId} timed out and was stood automatically`,
        "warning",
        import.meta.url,
    );

    await finish(interaction, ctx, game, outcome, { isUpdate: false });
}

export { sessions, maxBet };
