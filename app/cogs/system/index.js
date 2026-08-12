/**
 * app/cogs/system/index.js — liveness and credits. Touches no tables.
 *
 * The smallest possible whole cog: it exists so the loader is exercised by
 * something with commands AND an event, and so there is always one command that
 * works when the database is down.
 */

import { respond } from "../../bot/respond.js";
import { Events, SlashCommandBuilder, ActivityType } from "discord.js";

import { log } from "../../../lib/utility.js";

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

                // The legacy cycled a status list. One honest status for now —
                // cycling comes back when there is something worth cycling.
                readyClient.user.setPresence({
                    activities: [{ name: "/ping", type: ActivityType.Listening }],
                    status: "online",
                });

                void ctx;
            },
        },
    ],
};

function formatUptime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}
