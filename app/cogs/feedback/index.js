/**
 * app/cogs/feedback/index.js — `/feedback`.
 *
 * ⭐ Ote, 2026-08-13: *"add abother feature there \feedback msg:[strings] — record feedbacks to a
 * pg table, so user adn feedback our new system"*.
 *
 * ⚠️ **PRIVATE, via `defer: "ephemeral"`.** Someone reporting that a game cheated them, or that
 * another player is abusing something, should not have to say it in front of the channel — and a
 * public "thanks for the feedback" would quote their message straight back into it.
 *
 * That `defer` is also the *only* mechanism that works: `dispatch.js` defers every chat-input
 * command publicly before the handler runs, and `editReply()` cannot change ephemerality
 * afterwards, so passing `flags: Ephemeral` to `respond()` is silently dropped. It is TRAPS #14
 * in `AI_CarryOn.md` because it caught me out on `/admin` an hour before this file was written.
 *
 * ⚠️ NOT gated to admins, obviously — the whole point is that players use it. What it IS gated by
 * is a rate limit, because a free-text box in a bot sitting in ten servers is an invitation.
 */

import { SlashCommandBuilder, EmbedBuilder, InteractionContextType } from "discord.js";

import { respond } from "../../bot/respond.js";
import { ensurePlayer } from "../../data/player.js";
import {
    FEEDBACK_RULES,
    countRecent,
    submitFeedback,
    validateMessage,
    normaliseMessage,
} from "../../data/feedback.js";

export default {
    name: "feedback",
    description: "Tell the maintainers what you think of the bot.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("feedback")
                .setDescription("Send feedback about the bot. Only the maintainers see it.")
                .setContexts(InteractionContextType.Guild)
                .addStringOption((option) =>
                    option
                        .setName("msg")
                        .setDescription("What you want to say — a bug, a number that feels wrong, anything.")
                        .setRequired(true)
                        // Declared here as well as in SQL so Discord rejects the obvious cases in
                        // the client, before a round trip.
                        .setMinLength(FEEDBACK_RULES.MIN_LENGTH)
                        .setMaxLength(FEEDBACK_RULES.MAX_LENGTH),
                ),

            /** See the file header — this is the mechanism, not a flag on the reply. */
            defer: "ephemeral",

            async execute(interaction, ctx) {
                return submit(interaction, ctx);
            },
        },
    ],

    events: [],
};

async function submit(interaction, ctx) {
    const raw = interaction.options.getString("msg");

    const problem = validateMessage(raw);
    if (problem) {
        await respond(interaction, { content: `**${problem.message}.**` });
        return;
    }

    // ⚠️ Rate-limited BEFORE the insert, and by counting real rows rather than keeping an
    // in-memory tally — an in-memory one resets on restart, which is exactly when someone
    // spamming would try again.
    const recent = await countRecent(ctx.db, interaction.user.id);
    if (recent >= FEEDBACK_RULES.MAX_PER_WINDOW) {
        await respond(interaction, {
            content:
                `**That is ${recent} pieces of feedback in the last hour, which is the limit.** ` +
                "Nothing is lost — it is all recorded. Come back in a bit if there is more.",
        });
        await ctx.log(
            `feedback: ${interaction.user.id} hit the rate limit (${recent} in the window)`,
            "warning",
            import.meta.url,
        );
        return;
    }

    // Provisioned so the author exists as a player even if feedback is the first thing they ever
    // run — but note the table has no FK to that row, on purpose. See the migration.
    await ensurePlayer(ctx.db, interaction.user);

    const stored = await submitFeedback(ctx.db, {
        discordId: interaction.user.id,
        username: interaction.user.username,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        message: raw,
    });

    const message = normaliseMessage(raw);

    const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("📮 Feedback recorded")
        .setDescription("Thank you — it is in the database and the maintainers will see it.")
        .addFields(
            { name: "What you said", value: message.length > 900 ? `${message.slice(0, 900)}…` : message },
            { name: "Reference", value: `\`#${stored.rolling_id}\``, inline: true },
            {
                name: "Left this hour",
                value: `${Math.max(0, FEEDBACK_RULES.MAX_PER_WINDOW - recent - 1)}`,
                inline: true,
            },
        )
        .setFooter({ text: "Only you can see this message." });

    await respond(interaction, { embeds: [embed] });

    // ⚠️ Logged at `warning` so it stands out in a log full of fishing casts. Feedback is the one
    // thing in here that somebody actually needs to go and read.
    await ctx.log(
        `feedback #${stored.rolling_id} from ${interaction.user.id} (${interaction.user.username}) ` +
        `in guild ${interaction.guildId}: ${message.replace(/\n/g, " ⏎ ").slice(0, 300)}`,
        "warning",
        import.meta.url,
    );
}
