/**
 * app/cogs/dice/index.js — `/dice`.
 *
 * Rules live in `app/data/dice.js`. This file is the Discord surface, the one transaction
 * that moves the coins, and his 5-frame reveal animation.
 *
 * ⭐ TYPED, NOT PICKED — Ote: *"plain chat better ux"*. The guess is a free string with his
 * alias table behind it (`e`/`even`/`คู่`, `h`/`hi`/`high`/`สูง`, a bare `1`-`6`, …), with
 * autocomplete offering hints rather than restricting the input.
 *
 * ⚠️ The money is settled BEFORE the animation runs, then the animation reveals what already
 * happened. The face is rolled once up front, so this changes nothing the player sees — but
 * it means a crash or a deleted message mid-animation cannot leave a settled game unpaid or
 * an unsettled game looking paid. The ledger is the truth; the animation is presentation.
 */

import { SlashCommandBuilder, EmbedBuilder, MessageFlags, InteractionContextType } from "discord.js";

import { respond } from "../../bot/respond.js";
import { ensurePlayer } from "../../data/player.js";
import { getState, addMoney, toInt } from "../../data/economy.js";
import {
    DICE_RULES,
    BET_LABEL,
    FACE_EMOJI,
    GUESS_ALIASES,
    parseGuess,
    acceptedGuesses,
    validateBet,
    roll,
    animationFaces,
    resolveDice,
    isFaceBet,
} from "../../data/dice.js";

const COIN = "🪙";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
    name: "dice",
    description: "Roll a die. Call even, odd, high, low — or the exact face for ×3.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("dice")
                .setDescription("Roll a die. even/odd/high/low pays 1:1, calling the face pays ×3.")
                .setContexts(InteractionContextType.Guild)
                .addStringOption((option) =>
                    option
                        .setName("call")
                        .setDescription("Type: even / odd / high / low — or a face 1-6 for ×3")
                        .setRequired(true)
                        .setAutocomplete(true),
                )
                .addIntegerOption((option) =>
                    option
                        .setName("bet")
                        .setDescription(
                            `${DICE_RULES.MIN_BET}-${DICE_RULES.MAX_BET} coins. Default: ${DICE_RULES.DEFAULT_BET}.`,
                        )
                        .setRequired(false)
                        .setMinValue(DICE_RULES.MIN_BET)
                        .setMaxValue(DICE_RULES.MAX_BET),
                ),

            async autocomplete(interaction) {
                const typed = interaction.options.getFocused().trim().toLowerCase();

                const suggestions = [
                    { name: "even — คู่ (1:1)", value: "even" },
                    { name: "odd — คี่ (1:1)", value: "odd" },
                    { name: "high — สูง, 4-6 (1:1)", value: "high" },
                    { name: "low — ต่ำ, 1-3 (1:1)", value: "low" },
                    ...[1, 2, 3, 4, 5, 6].map((face) => ({
                        name: `${face} — the exact face (×${DICE_RULES.FACE_PAYOUT})`,
                        value: String(face),
                    })),
                ].filter((choice) => {
                    if (typed === "") return true;
                    if (choice.value.startsWith(typed)) return true;
                    const aliases = GUESS_ALIASES[choice.value];
                    return aliases ? aliases.some((alias) => alias.startsWith(typed)) : false;
                });

                await interaction.respond(suggestions.slice(0, 25));
            },

            async execute(interaction, ctx) {
                return rollDice(interaction, ctx);
            },
        },
    ],

    events: [],
};

async function rollDice(interaction, ctx) {
    const typed = interaction.options.getString("call");
    const guess = parseGuess(typed);

    if (guess === null) {
        await respond(interaction, {
            content: `**"${typed}" is not something I can roll for.** Type one of:\n${acceptedGuesses()}`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const bet = interaction.options.getInteger("bet") ?? DICE_RULES.DEFAULT_BET;

    await ensurePlayer(ctx.db, interaction.user);
    const state = await getState(ctx.db, interaction.user.id);
    const money = toInt(state.money, "money");

    const problem = validateBet({ money, bet });
    if (problem) {
        await respond(interaction, {
            content: `**${problem.message}.**`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // Rolled ONCE. Everything below reads this face — see the note in the file header.
    const face = roll();
    const outcome = resolveDice({ guess, face, bet });

    const result = await addMoney(ctx.db, {
        discordId: interaction.user.id,
        amount: outcome.amount,
        reason: outcome.won ? "game_win" : "game_loss",
        ref: `dice:${guess}`,
        guildId: interaction.guildId,
    });

    // ── His animation ────────────────────────────────────────────────────────
    // 5 frames, 0.3s apart, the real face last — `randing_dice`'s shape exactly. Restored for
    // the same reason the fishing animation was: the waiting IS the game.
    const label = outcome.faceBet ? `**${guess}**` : `**${BET_LABEL[guess]}**`;
    const frames = animationFaces(face);

    for (let i = 0; i < frames.length; i += 1) {
        const last = i === frames.length - 1;
        await respond(interaction, {
            content:
                `${interaction.user} called ${label} for ${COIN} **${bet}**.\n` +
                (last
                    ? `**And it is… ${FACE_EMOJI[frames[i]]} ${frames[i]}**`
                    : `Rolling… ${FACE_EMOJI[frames[i]]}`),
        });
        if (!last) await sleep(DICE_RULES.ANIMATION_INTERVAL_MS);
    }

    const embed = new EmbedBuilder()
        .setColor(outcome.won ? 0x2ecc71 : 0xe74c3c)
        .setTitle(`${FACE_EMOJI[face]} Rolled ${face} — ${outcome.traits.highLow}, ${outcome.traits.evenOdd}`)
        .setDescription(
            [
                `${interaction.user} called ${label} for ${COIN} **${bet}**.`,
                outcome.won
                    ? `✅ **Right.** ×${outcome.multiplier} — you win ${COIN} **${Math.abs(outcome.amount)}**.`
                    : `❌ **Wrong.** You lose ${COIN} **${bet}**.`,
            ].join("\n"),
        )
        .addFields({
            name: "Balance",
            value:
                `${COIN} **${result.money}**` +
                (result.levelsGained > 0 ? ` · levelled up to **${result.level}**` : "") +
                (result.crystalsGained > 0 ? ` · 💎 **${result.magical_crystal}**` : ""),
        })
        .setFooter({
            text:
                `${isFaceBet(guess) ? "1 in 6" : "1 in 2"} · ` +
                `even/odd/high/low pays 1:1, a called face pays ×${DICE_RULES.FACE_PAYOUT}`,
        });

    await respond(interaction, { content: "", embeds: [embed] });

    await ctx.log(
        `dice: ${interaction.user.id} called ${guess} for ${bet}, rolled ${face} — ` +
        `${outcome.won ? `won ${outcome.amount}` : `lost ${bet}`}, balance ${result.money}`,
        import.meta.url,
    );
}
