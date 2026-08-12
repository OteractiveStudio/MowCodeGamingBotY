/**
 * app/bot/dispatch.js — route an incoming slash command to its cog.
 *
 * The legacy faked case-insensitivity by declaring the same command five times
 * (`ox`, `Ox`, `oX`, `xo`, `XO`). Discord normalizes slash command names for us,
 * so there is exactly one name per command and exactly one place it is resolved:
 * here.
 */

import { Events, MessageFlags } from "discord.js";

import { log } from "../../lib/utility.js";

export function attachCommandDispatch(client, commands, ctx) {
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const entry = commands.get(interaction.commandName);

        if (!entry) {
            // Almost always means the command list published to Discord is ahead
            // of the code — say so, rather than leaving the user with a spinner.
            await log(
                `no handler for /${interaction.commandName} — is the published command list stale? ` +
                `run \`npm run bot:register\``,
                "warning",
                import.meta.url,
            );
            await safeReply(interaction, "That command isn't wired up on this build.");
            return;
        }

        const startedAt = Date.now();

        try {
            await entry.command.execute(interaction, ctx);
            await log.debug(
                `/${interaction.commandName} by ${interaction.user.id} in ${interaction.guildId ?? "DM"} ` +
                `— ${Date.now() - startedAt}ms`,
                import.meta.url,
            );
        } catch (err) {
            // Catch what we can handle, log everything else. The legacy's bare
            // `except: return` is what made errors invisible.
            await log(
                `/${interaction.commandName} (cog "${entry.cogName}") threw: ${err.stack || err.message}`,
                "error",
                import.meta.url,
            );
            await safeReply(
                interaction,
                "Something broke running that. It's been logged.",
            );
        }
    });
}

/**
 * Replying is itself fallible: the interaction may already be replied to or
 * deferred, and it expires. Never let the error path throw a second error.
 */
async function safeReply(interaction, content) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        await log(
            `could not deliver an error reply for /${interaction.commandName}: ${err.message}`,
            "warning",
            import.meta.url,
        );
    }
}
