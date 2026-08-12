/**
 * app/cogs/market/index.js — browsing, buying, and carrying.
 *
 * From the legacy `market_cog` (`market`/`buy`) and `inventory_cog` (`inv`).
 *
 * ⭐ THE UX IS HIS, DELIBERATELY. Ote, 2026-08-12, on an earlier flat-list version:
 * *"i think i like the old way of nav through the market better"* — and then, when I made it
 * a private browser: *"i mean the old one, everyone can see when user call market and see
 * their manu, also can click reaction, just my program rejected it. i like this kinda
 * exprerience."*
 *
 * So the market is **public**: the menu is posted in the channel where everyone can see it,
 * anyone is free to click it, and the bot **rejects** clicks that are not the shopper's —
 * exactly what his reaction handler did (`await reaction.remove(user)` plus a "you can't"
 * reply). The social part of the old experience is the point, so it is kept.
 *
 * 🔑 What is better than his version, without changing the feel: the whole navigation state
 * lives in the component customIds — `market:qty:<owner>:tool:gun:5` carries the shopper, the
 * section, the item and the quantity. His flow tracked mid-purchase players in a module-level
 * `market_using` dict, which is why the bot could really only host one session at a time and
 * why a crash mid-flow left someone stranded in it. **There is no server-side session state
 * here at all** — nothing to collide over, nothing to clean up on restart.
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
} from "discord.js";

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
            // ⚠️ Ote: *"make it just /market"*. Discord does NOT allow a command to have both a
            // bare form and subcommands — if there are subcommands, one must always be chosen.
            // So `/market` is now the menu with no subcommand at all, and the type-it-yourself
            // fast path moved to its own top-level `/buy` below.
            data: new SlashCommandBuilder()
                .setName("market")
                .setDescription("Open the market."),

            async execute(interaction, ctx) {
                return browse(interaction, ctx);
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
                        value: "_Nothing yet. `/market` to see what is for sale._",
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

    /**
     * Every step of the market, routed here by the `market:` customId prefix.
     *
     * ⚠️ The owner check is the direct descendant of his reaction rejection. The menu is
     * public and clickable by anyone, and someone else's click gets a private "this isn't
     * yours" instead of silently doing nothing — his handler removed the reaction and replied
     * *"you can't cancel this game. Only the game's starter can."*
     */
    async handleComponent(interaction, ctx) {
        const parts = String(interaction.customId).split(":");
        const action = parts[1];
        const ownerId = parts[2];

        if (ownerId && interaction.user.id !== ownerId) {
            await interaction.reply({
                content:
                    `This market belongs to <@${ownerId}>. Run \`/market\` and you get your own — ` +
                    `everyone can watch either way.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (action === "close") {
            // Closing means gone. Deleting is cleaner than leaving a dead embed in the
            // channel; if the bot cannot delete it, collapse it to one line instead.
            try {
                await interaction.message.delete();
            } catch {
                await interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x808080)
                            .setDescription(`🏪 Market closed by <@${ownerId}>.`),
                    ],
                    components: [],
                });
            }
            return;
        }

        if (action === "back") {
            await interaction.update(await categoryView(ctx, ownerId));
            return;
        }

        // A direct section button, not a dropdown — parts[3] is the section.
        if (action === "cat") {
            await interaction.update(await itemView(ctx, ownerId, parts[3]));
            return;
        }

        if (action === "itemback") {
            await interaction.update(await itemView(ctx, ownerId, parts[3]));
            return;
        }

        // A direct item button — parts[3] is the section, parts[4] the item.
        if (action === "pick") {
            await interaction.update(await quantityView(ctx, ownerId, parts[3], parts[4]));
            return;
        }

        if (action === "qty") {
            const [, , , categoryKey, itemKey, quantity] = parts;
            await interaction.update(
                await purchaseResult(ctx, interaction, ownerId, categoryKey, itemKey, Number(quantity)),
            );
            return;
        }

        if (action === "custom") {
            const [, , , categoryKey, itemKey] = parts;
            const modal = new ModalBuilder()
                .setCustomId(`market:buymodal:${ownerId}:${categoryKey}:${itemKey}`)
                .setTitle("How many?")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("amount")
                            .setLabel(`Up to ${purchaseLimitFor(itemKey)} per purchase`)
                            .setStyle(TextInputStyle.Short)
                            .setMinLength(1)
                            .setMaxLength(4)
                            .setRequired(true),
                    ),
                );
            await interaction.showModal(modal);
            return;
        }

        if (action === "buymodal" && interaction.isModalSubmit()) {
            const [, , , categoryKey, itemKey] = parts;
            const raw = interaction.fields.getTextInputValue("amount").trim();
            const quantity = Number(raw);

            if (!Number.isInteger(quantity) || quantity < 1) {
                await interaction.reply({
                    content: `\`${raw}\` is not a number of things you can buy.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // A modal submit cannot update() the message behind it, so edit that message and
            // acknowledge the modal separately.
            const result = await purchaseResult(
                ctx, interaction, ownerId, categoryKey, itemKey, quantity,
            );
            await interaction.reply({ ...result, flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.reply({
            content: "That control isn't one I recognise.",
            flags: MessageFlags.Ephemeral,
        });
    },
};

// ── The market menu — public, clickable, owner-gated ─────────────────────────

async function browse(interaction, ctx) {
    const categories = await getMarket(ctx.db);

    if (categories.length === 0) {
        await interaction.reply("The market is empty — the reference data is not seeded.");
        return;
    }

    // Public on purpose: the channel sees the menu and sees what gets bought.
    await interaction.reply(await categoryView(ctx, interaction.user.id));
}

/**
 * Step 1: the whole market, visible, with one direct button per section.
 *
 * ⚠️ Ote, on an earlier version that summarised each section as "2 items · from 1":
 * *"why market now collapse like this? i like the old one where user can see what in it. and
 * why it dropdown menu? not a direct button."*
 *
 * Both fixed here. The embed lists **every item with its price and description**, as his
 * original did, and the sections are **buttons** — one click, no menu to open. His emoji
 * reactions were direct too; a dropdown added a step he never had.
 */
async function categoryView(ctx, ownerId) {
    const categories = await getMarket(ctx.db);

    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle("🏪 The market")
        .setDescription(`<@${ownerId}> is shopping. Everything for sale:`)
        .setFooter({ text: "Anyone can watch. Only the shopper's clicks count." });

    // The full contents, exactly as the flat version showed them.
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

    // One button per section — Discord allows 5 per row, and there are 3 sections.
    const sectionButtons = categories.slice(0, 5).map((category) =>
        new ButtonBuilder()
            .setCustomId(`market:cat:${ownerId}:${category.category_key}`)
            .setLabel(category.display_name)
            .setEmoji(category.emoji ?? "🏷️")
            .setStyle(ButtonStyle.Primary),
    );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(sectionButtons),
            new ActionRowBuilder().addComponents(closeButton(ownerId)),
        ],
    };
}

/** Step 2: pick an item inside a section. */
async function itemView(ctx, ownerId, categoryKey) {
    const categories = await getMarket(ctx.db);
    const category = categories.find((c) => c.category_key === categoryKey);

    if (!category) {
        return {
            embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("That section is gone.")],
            components: [backRow(ownerId)],
        };
    }

    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle(`${category.emoji ?? ""} ${category.display_name}`.trim())
        .setDescription(
            category.items
                .map(
                    (item) =>
                        `${item.emoji ?? "▫️"} **${item.display_name}** — ${COIN} \`${item.price}\`\n` +
                        `_${item.detail ?? ""}_`,
                )
                .join("\n"),
        )
        .setFooter({ text: `Pick an item. Only <@${ownerId}>'s clicks count.` });

    // A button per item, not a dropdown. Five per row, so a section with more than five
    // wraps rather than collapsing into a menu.
    const rows = [];
    for (let start = 0; start < category.items.length; start += 5) {
        rows.push(
            new ActionRowBuilder().addComponents(
                category.items.slice(start, start + 5).map((item) =>
                    new ButtonBuilder()
                        .setCustomId(`market:pick:${ownerId}:${categoryKey}:${item.item_key}`)
                        .setLabel(`${item.display_name} · ${item.price}`)
                        .setEmoji(item.emoji ?? "▫️")
                        .setStyle(ButtonStyle.Secondary),
                ),
            ),
        );
        if (rows.length === 4) break; // leave a row for navigation
    }

    rows.push(
        new ActionRowBuilder().addComponents(backButton(ownerId), closeButton(ownerId)),
    );

    return { embeds: [embed], components: rows };
}

/** Step 3: how many? Only offers quantities that can actually succeed. */
async function quantityView(ctx, ownerId, categoryKey, itemKey) {
    const categories = await getMarket(ctx.db);
    const category = categories.find((c) => c.category_key === categoryKey);
    const item = category?.items.find((i) => i.item_key === itemKey);

    if (!item) {
        return {
            embeds: [new EmbedBuilder().setColor(0xff0000).setTitle("That item is gone.")],
            components: [backRow(ownerId)],
        };
    }

    const state = await getState(ctx.db, ownerId);
    const money = state ? toInt(state.money, "money") : 0;
    const limit = purchaseLimitFor(itemKey);
    const affordable = Math.max(0, Math.floor(money / Math.max(1, item.price)));

    const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle(`${item.emoji ?? ""} ${item.display_name}`.trim())
        .setDescription(item.detail ?? "")
        .addFields(
            { name: "price", value: `${COIN} \`${item.price}\``, inline: true },
            { name: `<@${ownerId}> has`, value: `${COIN} \`${money}\``, inline: true },
            {
                name: "limits",
                value: `\`${limit}\` per purchase · carry \`${carryCapFor(itemKey)}\``,
                inline: true,
            },
        );

    const quantities = [1, 5, 10, limit]
        .filter((n, index, all) => n <= limit && n <= affordable && all.indexOf(n) === index)
        .sort((a, b) => a - b);

    const buttons = quantities.map((n) =>
        new ButtonBuilder()
            .setCustomId(`market:qty:${ownerId}:${categoryKey}:${itemKey}:${n}`)
            .setLabel(`Buy ${n}`)
            .setStyle(n === 1 ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    buttons.push(
        new ButtonBuilder()
            .setCustomId(`market:custom:${ownerId}:${categoryKey}:${itemKey}`)
            .setLabel("Amount…")
            .setStyle(ButtonStyle.Primary),
    );

    if (affordable === 0) {
        embed.addFields({
            name: "​",
            value: `Not enough coins for even one — that needs ${COIN} \`${item.price}\`.`,
        });
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(buttons.slice(0, 5)),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`market:itemback:${ownerId}:${categoryKey}`)
                    .setLabel("Back")
                    .setEmoji("⬅️")
                    .setStyle(ButtonStyle.Secondary),
                backButton(ownerId),
                closeButton(ownerId),
            ),
        ],
    };
}

function backButton(ownerId) {
    return new ButtonBuilder()
        .setCustomId(`market:back:${ownerId}`)
        .setLabel("The market")
        .setEmoji("↩️")
        .setStyle(ButtonStyle.Secondary);
}

/** ⚠️ Ote: *"and where's an option to close the market?"* — there wasn't one. Now there is. */
function closeButton(ownerId) {
    return new ButtonBuilder()
        .setCustomId(`market:close:${ownerId}`)
        .setLabel("Close")
        .setEmoji("✖️")
        .setStyle(ButtonStyle.Danger);
}

function backRow(ownerId) {
    return new ActionRowBuilder().addComponents(backButton(ownerId), closeButton(ownerId));
}

/** Do the buy and render the outcome, leaving the shopper inside the market. */
async function purchaseResult(ctx, interaction, ownerId, categoryKey, itemKey, quantity) {
    await ensurePlayer(ctx.db, interaction.user);

    try {
        const result = await buy(ctx.db, {
            discordId: ownerId,
            itemKey,
            categoryKey,
            quantity,
            guildId: interaction.guildId,
        });

        const effect =
            result.effect.kind === "rods"
                ? `🎣 rods \`${result.effect.from}\` → \`${result.effect.to}\``
                : result.effect.kind === "inventory_size"
                  ? `🎒 slots \`${result.effect.from}\` → \`${result.effect.to}\``
                  : `held \`${result.effect.from}\` → \`${result.effect.to}\``;

        return {
            embeds: [
                new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle(`Bought ${result.quantity}× ${result.displayName}`)
                    .setDescription(
                        `<@${ownerId}> paid ${COIN} \`${result.totalPrice}\` · ${effect}\n` +
                        `Balance ${COIN} \`${result.money}\``,
                    ),
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`market:itemback:${ownerId}:${categoryKey}`)
                        .setLabel("Buy something else")
                        .setEmoji("🛒")
                        .setStyle(ButtonStyle.Success),
                    backButton(ownerId),
                    closeButton(ownerId),
                ),
            ],
        };
    } catch (err) {
        if (!(err instanceof PurchaseError)) throw err;

        return {
            embeds: [
                new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle("Cannot buy that")
                    .setDescription(refusalMessage(err)),
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`market:itemback:${ownerId}:${categoryKey}`)
                        .setLabel("Back")
                        .setEmoji("⬅️")
                        .setStyle(ButtonStyle.Secondary),
                    backButton(ownerId),
                    closeButton(ownerId),
                ),
            ],
        };
    }
}

/** One sentence per refusal code, phrased from the code rather than matched on text. */
function refusalMessage(err) {
    const messages = {
        INSUFFICIENT_FUNDS: () =>
            `You need ${COIN} \`${err.detail.needed}\` and you have \`${err.detail.available}\`.`,
        PURCHASE_LIMIT: () => `You cannot buy more than \`${err.detail.limit}\` of those at a time.`,
        CARRY_CAP: () =>
            `You can only carry \`${err.detail.cap}\`, and you already have \`${err.detail.current}\`.` +
            (err.detail.room > 0 ? ` Room for \`${err.detail.room}\` more.` : ""),
        INVENTORY_FULL: () =>
            `Your item slots are full (\`${err.detail.used}/${err.detail.slots}\`), so you cannot buy ` +
            `something you do not already hold. A 🎒 **Bag** gives you more slots.`,
        MAX_INVENTORY_SIZE: () =>
            `You can have up to \`${err.detail.ceiling}\` slots at your level and you have ` +
            `\`${err.detail.current}\`.` +
            (err.detail.room > 0 ? ` Room for \`${err.detail.room}\` more.` : " Level up for more."),
        NOT_FOR_SALE: () => `Nothing called \`${err.detail.itemKey}\` is for sale.`,
        BAD_QUANTITY: () => "That is not a number of things you can buy.",
    };
    return (messages[err.code] ?? (() => err.message))();
}
