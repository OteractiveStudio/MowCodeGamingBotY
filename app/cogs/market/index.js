/**
 * app/cogs/market/index.js — browsing, buying, and carrying.
 *
 * From the legacy `market_cog` (`market`/`buy`) and `inventory_cog` (`inv`).
 *
 * ⭐ The legacy drove the whole buy flow with **emoji reactions**: react to pick a
 * category, react again to pick an item, and it tracked who was mid-purchase in a
 * module-level `market_using` dict — so the bot could only really host one player's
 * market session per process, and a crash mid-flow left them stuck in it.
 *
 * Slash commands with **autocomplete** replace that: the player types, we suggest from
 * the database, and there is no session state to strand. Same discoverability, no
 * dict to leak.
 */

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

import { ensurePlayer } from "../../data/player.js";
import { getState, toInt } from "../../data/economy.js";
import {
    getMarket,
    getInventory,
    buy,
    maxInventorySize,
    carryCapFor,
    purchaseLimitFor,
    PurchaseError,
} from "../../data/inventory.js";

const COIN = "🪙";

export default {
    name: "market",
    description: "Browse the market, buy things, and see what you are carrying.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("market")
                .setDescription("The market.")
                .addSubcommand((sub) =>
                    sub.setName("browse").setDescription("See everything for sale."),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("buy")
                        .setDescription("Buy something.")
                        .addStringOption((option) =>
                            option
                                .setName("item")
                                .setDescription("What to buy.")
                                .setRequired(true)
                                .setAutocomplete(true),
                        )
                        .addIntegerOption((option) =>
                            option
                                .setName("amount")
                                .setDescription("How many. Defaults to 1.")
                                .setMinValue(1),
                        ),
                ),

            async autocomplete(interaction, ctx) {
                const typed = interaction.options.getFocused().toLowerCase();
                const categories = await getMarket(ctx.db);

                const seen = new Map();
                for (const category of categories) {
                    for (const item of category.items) {
                        // fishingrod is listed twice; suggest it once, at its price.
                        if (!seen.has(item.item_key)) seen.set(item.item_key, item);
                    }
                }

                const matches = [...seen.values()]
                    .filter(
                        (item) =>
                            item.item_key.includes(typed) ||
                            item.display_name.toLowerCase().includes(typed),
                    )
                    .slice(0, 25)
                    .map((item) => ({
                        name: `${item.display_name} — ${item.price} coins`,
                        value: item.item_key,
                    }));

                await interaction.respond(matches);
            },

            async execute(interaction, ctx) {
                const subcommand = interaction.options.getSubcommand();
                if (subcommand === "browse") return browse(interaction, ctx);
                if (subcommand === "buy") return purchase(interaction, ctx);
                await interaction.reply(`Unknown subcommand \`${subcommand}\`.`);
            },
        },
        {
            data: new SlashCommandBuilder()
                .setName("inventory")
                .setDescription("What you are carrying."),

            async execute(interaction, ctx) {
                await ensurePlayer(ctx.db, interaction.user);

                const state = await getState(ctx.db, interaction.user.id);
                const items = await getInventory(ctx.db, interaction.user.id);
                const ceiling = maxInventorySize(state);

                const embed = new EmbedBuilder()
                    .setColor(0xffa500)
                    .setTitle(`${interaction.user.username}'s inventory`)
                    .setDescription(
                        `${COIN} \`${toInt(state.money, "money")}\` · 🎣 \`${state.fishing_rod}\` rods\n` +
                        `🎒 slots \`${items.length}/${state.inventory_size}\` ` +
                        `(you can raise this to \`${ceiling}\` at your level, with bags)`,
                    );

                if (items.length === 0) {
                    embed.addFields({
                        name: "items",
                        value: "_Nothing yet. `/market browse` to see what is for sale._",
                    });
                } else {
                    embed.addFields({
                        name: "items",
                        value: items
                            .map(
                                (item) =>
                                    `${item.emoji ?? "▫️"} **${item.display_name}** ×\`${item.quantity}\`` +
                                    ` — _${item.detail ?? ""}_`,
                            )
                            .join("\n"),
                    });
                }

                await interaction.reply({ embeds: [embed] });
            },
        },
    ],

    events: [],
};

async function browse(interaction, ctx) {
    const categories = await getMarket(ctx.db);

    if (categories.length === 0) {
        await interaction.reply("The market is empty — the reference data is not seeded.");
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("The market")
        .setDescription("Buy with `/market buy` — start typing and it will suggest items.");

    for (const category of categories) {
        embed.addFields({
            name: `${category.emoji ?? ""} ${category.display_name}`.trim(),
            value: category.items
                .map(
                    (item) =>
                        `${item.emoji ?? "▫️"} **${item.display_name}** — ${COIN} \`${item.price}\`\n` +
                        `_${item.detail ?? ""}_`,
                )
                .join("\n"),
        });
    }

    await interaction.reply({ embeds: [embed] });
}

async function purchase(interaction, ctx) {
    const itemKey = interaction.options.getString("item");
    const amount = interaction.options.getInteger("amount") ?? 1;

    await ensurePlayer(ctx.db, interaction.user);

    try {
        const result = await buy(ctx.db, {
            discordId: interaction.user.id,
            itemKey,
            quantity: amount,
            guildId: interaction.guildId,
        });

        const effectLine =
            result.effect.kind === "rods"
                ? `🎣 rods: \`${result.effect.from}\` → \`${result.effect.to}\``
                : result.effect.kind === "inventory_size"
                  ? `🎒 slots: \`${result.effect.from}\` → \`${result.effect.to}\``
                  : `held: \`${result.effect.from}\` → \`${result.effect.to}\``;

        await interaction.reply(
            `Bought \`${result.quantity}×\` **${result.displayName}** for ${COIN} ` +
            `\`${result.totalPrice}\`.\n${effectLine} · balance ${COIN} \`${result.money}\``,
        );
    } catch (err) {
        if (!(err instanceof PurchaseError)) throw err;

        // Each refusal gets its own sentence, phrased from the code rather than by
        // matching message text.
        const messages = {
            INSUFFICIENT_FUNDS: () =>
                `You need ${COIN} \`${err.detail.needed}\` for that, and you have ` +
                `\`${err.detail.available}\`.`,
            PURCHASE_LIMIT: () =>
                `You cannot buy more than \`${err.detail.limit}\` of those at a time.`,
            CARRY_CAP: () =>
                `You can only carry \`${err.detail.cap}\` of those, and you already have ` +
                `\`${err.detail.current}\`.` +
                (err.detail.room > 0 ? ` Room for \`${err.detail.room}\` more.` : ""),
            INVENTORY_FULL: () =>
                `Your item slots are full (\`${err.detail.used}/${err.detail.slots}\`), so you ` +
                `cannot buy something you do not already hold. Buy a 🎒 **Bag** for more slots.`,
            MAX_INVENTORY_SIZE: () =>
                `You can have up to \`${err.detail.ceiling}\` slots at your level and you have ` +
                `\`${err.detail.current}\`.` +
                (err.detail.room > 0
                    ? ` Room for \`${err.detail.room}\` more.`
                    : " Level up for more."),
            NOT_FOR_SALE: () => `Nothing called \`${err.detail.itemKey}\` is for sale.`,
            BAD_QUANTITY: () => "That is not a number of things you can buy.",
        };

        await interaction.reply(
            (messages[err.code] ?? (() => err.message))(),
        );
    }
}

// Exported for the tests: the numbers a player is allowed to see.
export const limits = { carryCapFor, purchaseLimitFor };
