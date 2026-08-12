/**
 * app/cogs/fishing/index.js — casting, and the auto mode that used to be dangerous.
 *
 * From the legacy `fishing_cog`: `fishing` (single) and `fishing auto` (every rod, up
 * to 30, in one animated message).
 *
 * ⚠️ NOT ported: the legacy's fishing animation, which edited the same embed once per
 * second for up to 20 casts. It was charming and it was also 20 message edits per
 * command — a rate-limit bill for decoration. `deferReply()` gives the same "wait for
 * it" beat with one edit at the end. If the animation comes back, it belongs behind a
 * config flag, not in the hot path.
 *
 * ❌ Not here: buying rods. That is the market, which is not built — so for now rods
 * come from the 10 every player is provisioned with.
 */

import { respond } from "../../bot/respond.js";
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

import { ensurePlayer } from "../../data/player.js";
import {
    cast,
    castAll,
    getFishPool,
    fishRate,
    summariseCatch,
    animationFrame,
    animationFrameCount,
    seaPicture,
    AUTO_CAST_LIMIT,
} from "../../data/fishing.js";

const COIN = "🪙";
const ROD = "🎣";

export default {
    name: "fishing",
    description: "Cast a rod, or burn every rod you have at once.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("fishing")
                .setDescription("Go fishing. Each cast uses one rod.")
                .addSubcommand((sub) =>
                    sub.setName("cast").setDescription("Cast once."),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("auto")
                        .setDescription(
                            `Use every rod you have, up to ${AUTO_CAST_LIMIT}, in one go.`,
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("rates")
                        .setDescription("What is in the sea, and how likely each one is."),
                ),

            async execute(interaction, ctx) {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === "cast") return castOnce(interaction, ctx);
                if (subcommand === "auto") return castEverything(interaction, ctx);
                if (subcommand === "rates") return rates(interaction, ctx);

                await respond(interaction, `Unknown subcommand \`${subcommand}\`.`);
            },
        },
    ],

    events: [],
};

async function castOnce(interaction, ctx) {
    await ensurePlayer(ctx.db, interaction.user);

    const result = await cast(ctx.db, {
        discordId: interaction.user.id,
        casts: 1,
        guildId: interaction.guildId,
    });

    if (result.outOfRods) {
        await respond(interaction, 
            `${interaction.user}, **you have no fishing rods left.** ` +
            `The market would sell you more, but it is not built yet.`,
        );
        return;
    }

    const fish = result.caught[0];
    const pool = await getFishPool(ctx.db);

    const embed = new EmbedBuilder()
        .setColor(fish.price > 0 ? 0x00ff00 : 0x808080)
        .setTitle(
            fish.fish_type === "creature"
                ? `You caught a ${fish.display_name}!`
                : `You caught… ${fish.display_name}.`,
        )
        .setDescription(
            fish.price > 0
                ? `Sold for ${COIN} \`${fish.price}\`. You now have ${COIN} \`${result.money}\`.`
                : `Worth nothing. You still have ${COIN} \`${result.money}\`.`,
        )
        .addFields(
            { name: "tier", value: `\`${fish.tier}\``, inline: true },
            { name: "price", value: `\`${fish.price}\``, inline: true },
            {
                name: "rods left",
                value: `${ROD} \`${result.rodsLeft}\``,
                inline: true,
            },
        )
        .setFooter({
            text: `P.S the rate of tier ${fish.tier} is ${fishRate(fish.tier, pool).toFixed(2)}%`,
        });

    if (result.levelsGained > 0) {
        embed.addFields({
            name: "level up",
            value:
                `now level \`${result.level}\`` +
                (result.crystalsGained > 0
                    ? ` — and a 💎 magical crystal! (\`${result.magical_crystal}\`)`
                    : ""),
        });
    }

    await respond(interaction, { embeds: [embed] });
}

async function castEverything(interaction, ctx) {
    await ensurePlayer(ctx.db, interaction.user);

    // No deferReply() here: dispatch.js defers every chat-input command before calling it, and
    // deferring twice throws. That is why the animation can safely take 10+ seconds.

    // The batch is computed and committed FIRST, in one transaction. The animation below
    // is a reveal of a result that is already safe on disk — the legacy drew its frames
    // while rewriting the players file four times per rod.
    const result = await castAll(ctx.db, {
        discordId: interaction.user.id,
        guildId: interaction.guildId,
    });

    if (result.outOfRods) {
        await interaction.editReply(
            `${interaction.user}, **you have no fishing rods left.** ` +
            `Buy some with \`/market\` → **Tool** → **Fishing rod**.`,
        );
        return;
    }

    await playFishingAnimation(interaction, ctx, result.casts);

    const summary = summariseCatch(result.caught);

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("This is everything you caught.")
        .setDescription(
            `${result.casts} cast${result.casts === 1 ? "" : "s"} · earned ${COIN} ` +
            `\`${result.totalEarned}\` · balance ${COIN} \`${result.money}\`\n` +
            `${ROD} \`${result.rodsLeft}\` rod${result.rodsLeft === 1 ? "" : "s"} left.`,
        )
        .addFields({
            name: "haul",
            value: summary
                .map(
                    (entry) =>
                        `\`${entry.count}×\` **${entry.display_name}** ` +
                        `(tier ${entry.tier}) — ${COIN} \`${entry.earned}\``,
                )
                .join("\n"),
        });

    if (result.levelsGained > 0) {
        embed.addFields({
            name: "progress",
            value:
                `+${result.levelsGained} level${result.levelsGained === 1 ? "" : "s"} → \`${result.level}\`` +
                (result.crystalsGained > 0
                    ? ` · +${result.crystalsGained} 💎 (\`${result.magical_crystal}\`)`
                    : ""),
        });
    }

    embed.setFooter({
        text: "One transaction, one write. The old bot did this with 120+ file rewrites.",
    });

    await interaction.editReply({ embeds: [embed] });
}

/**
 * The legacy's fishing animation: a new sea frame every second while the rods "burn".
 *
 * ⚠️ Frame count comes from `animationFrameCount()`, which keeps his own `rod_left < 21`
 * throttle — a full 30-rod run draws no frames, exactly as his did. Turn it off entirely
 * with `bot.fishing_animation: false`.
 *
 * Never lets a failed edit kill the command: the result matters, the slideshow does not.
 */
async function playFishingAnimation(interaction, ctx, casts) {
    if (ctx.config.bot?.fishing_animation === false) return;

    const frames = animationFrameCount(casts);
    if (frames === 0) return;

    const picture = seaPicture();

    for (let frame = 0; frame < frames; frame += 1) {
        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle("You are in the great sea and fishing peacefully with all the rods you have.")
            .setDescription(
                `This will take about ${casts - frame} second${casts - frame === 1 ? "" : "s"}.` +
                animationFrame(),
            )
            .setImage(picture)
            .setFooter({ text: `${ROD} ${frames - frame} to go` });

        try {
            await interaction.editReply({ embeds: [embed] });
        } catch {
            // A rate limit or a deleted message ends the animation, not the command.
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

async function rates(interaction, ctx) {
    const pool = await getFishPool(ctx.db);

    if (pool.length === 0) {
        await respond(interaction, "There is nothing in the sea — the reference data is not seeded.");
        return;
    }

    const lines = pool
        .map(
            (fish) =>
                `\`${fishRate(fish.tier, pool).toFixed(2)}%\` — **${fish.display_name}** ` +
                `· tier \`${fish.tier}\` · ${COIN} \`${fish.price}\``,
        )
        .join("\n");

    const embed = new EmbedBuilder()
        .setColor(0x1e90ff)
        .setTitle("What is in the sea")
        .setDescription(lines)
        .setFooter({
            text: "A fish's chance is (10 - tier) / total. Lower tiers are commoner — which is why you keep catching Nothing.",
        });

    await respond(interaction, { embeds: [embed] });
}
