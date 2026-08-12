/**
 * app/cogs/system/index.js — liveness and credits. Touches no tables.
 *
 * The smallest possible whole cog: it exists so the loader is exercised by
 * something with commands AND an event, and so there is always one command that
 * works when the database is down.
 */

import { respond } from "../../bot/respond.js";
import { Events, SlashCommandBuilder, ActivityType, EmbedBuilder } from "discord.js";

import { log } from "../../../lib/utility.js";
import { guildLang } from "../../bot/locale.js";
import { translator } from "../../../lib/i18n.js";
import { startStatusRotation, checkAvatar } from "../../bot/presence.js";
import { takeRestartNotice } from "../../bot/restart.js";

export default {
    name: "system",
    description: "Liveness, latency and credits.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("ping")
                .setDescription("Check that the bot is alive, and how slow it is."),

            async execute(interaction, ctx) {
                const roundTrip = Date.now() - interaction.createdTimestamp;
                const gateway = Math.round(ctx.client.ws.ping);
                const uptimeSeconds = Math.floor(process.uptime());

                await respond(interaction, 
                    `Pong. round-trip \`${roundTrip}ms\` · gateway \`${gateway}ms\` · up \`${formatUptime(uptimeSeconds)}\``,
                );
            },
        },
        {
            data: new SlashCommandBuilder()
                .setName("about")
                .setDescription("What this bot is, and who wrote it."),

            async execute(interaction, ctx) {
                // Straight from the legacy file headers. A team project, named —
                // and the digest's instruction was to keep the credits.
                await respond(interaction, 
                    [
                        `**${ctx.config.app.name}** — the MowCode Gaming Bot, remade.`,
                        "",
                        "Originally Python/discord.py, 2021–2024, a KU81 CS36 project:",
                        "main idea **Art** · main programmer **Ote** · help co-writer **Mickey** · " +
                        "co-programmers **Tonnow**, **Jojo** · translator **Jo**",
                        "",
                        "Now JavaScript on discord.js, with a real database behind it.",
                    ].join("\n"),
                );
            },
        },
    ],

    events: [
        {
            name: Events.ClientReady,
            once: true,
            async handle(readyClient, ctx) {
                await log(
                    `logged in as ${readyClient.user.tag} (${readyClient.user.id}) in ` +
                    `${readyClient.guilds.cache.size} guild(s)`,
                    import.meta.url,
                );

                // ⭐ HIS ROTATING STATUS IS BACK, at a sane interval. See app/bot/presence.js
                // for why 7 seconds became 60.
                await startStatusRotation(readyClient, ctx.config);

                // ⭐ And his avatar self-check — once, never retried, off unless configured.
                const avatar = await checkAvatar(readyClient, ctx.config);
                if (avatar !== "disabled") {
                    await log(`avatar check: ${avatar}`, import.meta.url);
                }

                // ⭐ "I'm back! :D" — his set_starting_msg, delivered once.
                await announceRestart(readyClient, ctx);

                void ActivityType;
            },
        },
    ],
};

/**
 * Say "I'm back!" in the channel the restart was asked for, if there is a notice.
 *
 * ⚠️ Every failure path is logged rather than swallowed, and none of them can stop the boot: the
 * bot being up matters more than the greeting arriving.
 */
async function announceRestart(client, ctx) {
    const notice = takeRestartNotice();
    if (!notice?.channelId) return;

    const s = translator(notice.lang);

    try {
        const channel = await client.channels.fetch(notice.channelId);
        await channel.send(
            notice.requestedBy
                ? `${s("restart.back")} <@${notice.requestedBy}>`
                : s("restart.back"),
        );
        await log(`restart notice delivered to channel ${notice.channelId}`, import.meta.url);
    } catch (err) {
        await log(
            `could not deliver the restart notice to ${notice.channelId}: ${err.message}`,
            "warning",
            import.meta.url,
        );
    }
}

function formatUptime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}
