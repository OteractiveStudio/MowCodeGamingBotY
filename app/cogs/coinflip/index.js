/**
 * app/cogs/coinflip/index.js — `/coinflip`.
 *
 * Rules live in `app/data/coinflip.js`. This file is the Discord surface and the one
 * transaction that moves the coins.
 *
 * ⭐ The high-roller brake is his, kept on his confirmation that it was *"my an anti-inflation
 * thing"* — and this file is where the two conditions he attached to it are met:
 *   · *"but visible, yeah."*                  → the odds are stated BEFORE the result
 *   · *"but make it log when this system fired"* → one WARNING line per firing, plus a
 *                                                 `:highroller` marker in the ledger `ref`
 *                                                 so affected flips stay findable later.
 */

import { SlashCommandBuilder, EmbedBuilder, MessageFlags, InteractionContextType } from "discord.js";

import { respond } from "../../bot/respond.js";
import { ensurePlayer } from "../../data/player.js";
import { getState, addMoney, toInt } from "../../data/economy.js";
import {
    COINFLIP_RULES,
    SIDE_LABEL,
    SIDE_EMOJI,
    SIDE_ALIASES,
    parseSide,
    acceptedSides,
    maxBet,
    defaultBet,
    validateFlip,
    resolveFlip,
    describeBrake,
    winChance,
} from "../../data/coinflip.js";

const COIN = "🪙";

export default {
    name: "coinflip",
    description: "Call a coin. Half your money is the most you can put on it.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("coinflip")
                .setDescription("Call heads or tails. Bet up to half your coins.")
                .setContexts(InteractionContextType.Guild)
                // ⭐ TYPED, NOT PICKED — Ote: *"plain chat better ux"*. A free string with his
                // alias table behind it, plus autocomplete as a hint rather than a gate, so
                // `h`, `head`, `หัว`, `ก้อย` and `หาง` all still work the way his players
                // remember. Choices would have been fewer lines and worse.
                .addStringOption((option) =>
                    option
                        .setName("call")
                        .setDescription("Type: h / head / หัว — or — t / tail / ก้อย / หาง")
                        .setRequired(true)
                        .setAutocomplete(true),
                )
                .addIntegerOption((option) =>
                    option
                        .setName("bet")
                        .setDescription(`At least ${COINFLIP_RULES.MIN_BET}, at most half your coins. Default: half.`)
                        .setRequired(false)
                        .setMinValue(COINFLIP_RULES.MIN_BET),
                ),

            /**
             * Hints while they type. ⭐ This is the first thing in the project to actually use
             * the autocomplete route in `dispatch.js` — it had been wired and unexercised since
             * `/buy` was deleted.
             */
            async autocomplete(interaction) {
                const typed = interaction.options.getFocused().trim().toLowerCase();
                const suggestions = [
                    { name: "🙂 head — หัว", value: "head" },
                    { name: "🪙 tail — ก้อย", value: "tail" },
                ].filter(
                    (choice) =>
                        typed === "" ||
                        choice.value.startsWith(typed) ||
                        SIDE_ALIASES[choice.value].some((alias) => alias.startsWith(typed)),
                );
                await interaction.respond(suggestions);
            },

            async execute(interaction, ctx) {
                return flip(interaction, ctx);
            },
        },
    ],

    events: [],
};

/** The brake's threshold is tunable per install, and a null turns it off entirely. */
function thresholdFrom(config) {
    const configured = config?.bot?.high_roller_threshold;
    return configured === undefined ? COINFLIP_RULES.HIGH_ROLLER_THRESHOLD : configured;
}

async function flip(interaction, ctx) {
    const typed = interaction.options.getString("call");
    const guess = parseSide(typed);

    // Typing means it can be mistyped, so the rejection has to teach rather than scold —
    // his own message just said "invalid format" and pointed at a help command.
    if (!guess) {
        await respond(interaction, {
            content:
                `**"${typed}" is not a side I know.** Type one of:\n${acceptedSides()}`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const threshold = thresholdFrom(ctx.config);

    await ensurePlayer(ctx.db, interaction.user);
    const state = await getState(ctx.db, interaction.user.id);
    const money = toInt(state.money, "money");

    // ⚠️ The balance is read BEFORE the bet and the brake is judged on it, exactly as his
    // did. That is what makes the brake self-disengaging — see the data module's header.
    const bet = interaction.options.getInteger("bet") ?? defaultBet(money);

    const problem = validateFlip({ money, bet });
    if (problem) {
        await respond(interaction, {
            content: `**${problem.message}.**`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const brake = describeBrake(guess, money, threshold);
    const outcome = resolveFlip({ guess, money, bet, threshold });

    // ⭐ LOGGED WHEN IT FIRES — Ote asked for this explicitly. At `warning` so it stands out
    // in the log without being an error: the brake working is correct behaviour, but it is
    // the kind of correct behaviour someone will want to go looking for later.
    if (brake) {
        await ctx.log(
            `coinflip: ${brake.log} — ${interaction.user.id} betting ${bet} of ${money}`,
            "warning",
            import.meta.url,
        );
    }

    const result = await addMoney(ctx.db, {
        discordId: interaction.user.id,
        amount: outcome.amount,
        reason: outcome.won ? "game_win" : "game_loss",
        // ⭐ The `:highroller` suffix is the audit trail. `SELECT … WHERE ref LIKE '%highroller'`
        // answers "is the brake actually doing anything?" months from now.
        ref: `coinflip:${guess}${brake ? ":highroller" : ""}`,
        guildId: interaction.guildId,
    });

    const embed = new EmbedBuilder()
        .setColor(outcome.won ? 0x2ecc71 : 0xe74c3c)
        .setTitle(`${SIDE_EMOJI[outcome.landed]} It landed ${SIDE_LABEL[outcome.landed]}`)
        .setDescription(
            [
                `${interaction.user} called **${SIDE_LABEL[guess]}** for ${COIN} **${bet}**.`,
                outcome.won
                    ? `✅ **Right.** You win ${COIN} **${bet}**.`
                    : `❌ **Wrong.** You lose ${COIN} **${bet}**.`,
            ].join("\n"),
        )
        .addFields({
            name: "Balance",
            value:
                `${COIN} **${result.money}**` +
                (result.levelsGained > 0 ? ` · levelled up to **${result.level}**` : "") +
                (result.crystalsGained > 0 ? ` · 💎 **${result.magical_crystal}**` : ""),
        });

    // ⭐ VISIBLE — stated as a rule, in its own field, not buried in a footer. A brake the
    // player cannot see is indistinguishable from bad luck.
    if (brake) {
        embed.addFields({
            name: "⚖️ High-roller odds were in effect",
            value:
                `${brake.player}\n` +
                "_Anti-inflation: it eases off on its own once you drop back under._",
        });
    }

    const nextMax = maxBet(result.money);
    embed.setFooter({
        text:
            `win chance ${Math.round(winChance(guess, money, threshold) * 100)}% · ` +
            (nextMax >= COINFLIP_RULES.MIN_BET
                ? `next flip you can bet up to ${nextMax}`
                : `you need ${COINFLIP_RULES.MIN_MONEY} coins to flip again`),
    });

    await respond(interaction, { embeds: [embed] });

    await ctx.log(
        `coinflip: ${interaction.user.id} called ${guess} for ${bet}, landed ${outcome.landed} — ` +
        `${outcome.won ? "won" : "lost"}, balance ${result.money}${brake ? " [BRAKE]" : ""}`,
        import.meta.url,
    );
}
