/**
 * app/cogs/tts/index.js — `/tts join · say · stop · leave`.
 *
 * His `tts_cog`, rebuilt. He asked for it back, which supersedes the earlier *"Gaming only,
 * first"* scope call — recorded so the reversal is deliberate rather than drift.
 *
 * ⭐ HIS SHAPE KEPT: you bind the bot to a voice channel, and from then on **everything typed in
 * the bound text channel is read aloud**. That is the feature, not a side effect — it is a
 * read-my-chat-to-the-room bot, which is what made it fun in a call.
 *
 * ⚠️ **AND THAT IS ALSO THE RISK.** A bot that speaks arbitrary text into a voice channel can be
 * made to say anything to a room, and his had no limits at all. So: only the bound channel, only
 * while a human is actually in the voice channel, a length cap, a capped queue, and mentions and
 * links stripped before anything is spoken. `app/data/tts.js` holds those rules and the five
 * defects fixed from his version.
 *
 * ⚠️ **WHAT I COULD NOT VERIFY:** that audio is audible. Everything up to the last inch is
 * checked — the endpoint returns real mp3, ffmpeg transcodes it to ogg/opus, the connection
 * reaches Ready, the queue advances on the player's Idle event — but confirming sound actually
 * comes out needs a human in a voice channel. Ote will hear it or he will not; if he does not, the
 * first thing to check is `generateDependencyReport()` in the log line this cog writes on load.
 */

import {
    SlashCommandBuilder,
    EmbedBuilder,
    InteractionContextType,
    ChannelType,
    Events,
} from "discord.js";
import { generateDependencyReport } from "@discordjs/voice";

import { respond } from "../../bot/respond.js";
import { guildLang } from "../../bot/locale.js";
import { log } from "../../../lib/utility.js";
import {
    getSession,
    joinVoice,
    leaveVoice,
    say,
    stopSpeaking,
} from "../../bot/voice.js";
import { TTS_RULES, sanitiseForSpeech, speechLang, validateSpeech } from "../../data/tts.js";

export default {
    name: "tts",
    description: "Read a text channel out loud in a voice channel.",

    commands: [
        {
            data: new SlashCommandBuilder()
                .setName("tts")
                .setDescription("Have the bot read this channel out loud.")
                .setContexts(InteractionContextType.Guild)
                .addSubcommand((sub) =>
                    sub
                        .setName("join")
                        .setDescription("Join your voice channel and start reading this text channel.")
                        .addChannelOption((option) =>
                            option
                                .setName("channel")
                                .setDescription("Which voice channel. Default: the one you are in.")
                                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                                .setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("say")
                        .setDescription("Say one thing, without binding a channel.")
                        .addStringOption((option) =>
                            option
                                .setName("text")
                                .setDescription("What to say.")
                                .setRequired(true)
                                .setMaxLength(TTS_RULES.MAX_MESSAGE_LENGTH),
                        ),
                )
                .addSubcommand((sub) => sub.setName("stop").setDescription("Stop talking and clear the queue."))
                .addSubcommand((sub) => sub.setName("leave").setDescription("Leave the voice channel.")),

            async execute(interaction, ctx) {
                const sub = interaction.options.getSubcommand();
                if (sub === "join") return joinCommand(interaction, ctx);
                if (sub === "say") return sayCommand(interaction, ctx);
                if (sub === "stop") return stopCommand(interaction, ctx);
                return leaveCommand(interaction, ctx);
            },
        },
    ],

    /**
     * ⭐ Log the voice dependency report ONCE on setup.
     *
     * ⚠️ This is the single most useful diagnostic for "the bot joined but I hear nothing", and it
     * is worth a log line at boot rather than a command nobody thinks to run. Missing encryption or
     * a missing ffmpeg both present as silence.
     */
    async setup(ctx) {
        const report = generateDependencyReport();
        const encryption = /(@noble\/ciphers|sodium|aes-256-gcm): (?!not found)/.test(report);
        const ffmpeg = /FFmpeg\n- version: (?!not found)/.test(report);

        await log(
            `tts: voice stack — encryption ${encryption ? "OK" : "MISSING"}, ffmpeg ${ffmpeg ? "OK" : "MISSING"}`,
            encryption && ffmpeg ? "info" : "error",
            import.meta.url,
        );
        if (!encryption || !ffmpeg) {
            await log(`tts: full dependency report follows\n${report}`, "error", import.meta.url);
        }
        void ctx;
    },

    events: [
        {
            /**
             * ⭐ HIS `on_message` TTS — read the bound channel aloud.
             *
             * ⚠️ Ordered so a message in a channel with no TTS session costs ONE Map lookup. His
             * equivalent ran a network translation on every message in every server (TRAPS #11).
             */
            name: Events.MessageCreate,
            async handle(message, ctx) {
                if (message.author?.bot) return;
                if (!message.guildId) return;

                const session = getSession(message.guildId);
                if (!session) return;
                if (session.textChannelId !== message.channelId) return;

                const content = message.content?.trim();
                if (!content) return;

                // ⚠️ Only speak while a human is actually in the channel. Otherwise the bot sits
                // reading a chat to an empty room, burning endpoint requests — and his had no
                // such check, so it would do exactly that until someone told it to leave.
                const voiceChannel = message.guild?.channels?.cache?.get(session.voiceChannelId);
                const humans = voiceChannel?.members?.filter((member) => !member.user.bot).size ?? 0;
                if (humans === 0) return;

                const problem = validateSpeech(content);
                if (problem) return; // Silently skipped — an unreadable message is not an error.

                const result = await say(
                    message.guildId,
                    content,
                    speechLang(await guildLang(ctx, message.guildId)),
                );

                // ⚠️ A full queue reacts rather than replies. A message per dropped line would
                // spam the channel the bot is supposed to be reading.
                if (!result.spoken && result.reason === "QUEUE_FULL") {
                    await message.react("🔇").catch(() => {});
                }
            },
        },
    ],
};

// ── /tts join ────────────────────────────────────────────────────────────────

async function joinCommand(interaction, ctx) {
    const asked = interaction.options.getChannel("channel");
    const mine = interaction.member?.voice?.channel ?? null;
    const target = asked ?? mine;

    if (!target) {
        await respond(interaction, {
            content: "**Join a voice channel first**, or name one with the `channel` option.",
        });
        return;
    }

    // ⚠️ Checked before connecting rather than after failing. joinVoiceChannel would otherwise
    // sit in Signalling until the 15-second timeout and report a vague connection error.
    const permissions = target.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has("Connect") || !permissions?.has("Speak")) {
        await respond(interaction, {
            content: `**I need Connect and Speak in ${target}.** Right now I have neither, or only one.`,
        });
        return;
    }

    try {
        const { session, rejoined } = await joinVoice({
            guild: interaction.guild,
            voiceChannelId: target.id,
            textChannelId: interaction.channelId,
        });

        const lang = speechLang(await guildLang(ctx, interaction.guildId));

        const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("🗣️ Reading this channel out loud")
            .setDescription(
                rejoined
                    ? `Already in ${target} — now reading <#${interaction.channelId}> instead.`
                    : `In ${target}, reading everything typed in <#${interaction.channelId}>.`,
            )
            .addFields(
                { name: "Voice", value: `${target}`, inline: true },
                { name: "Language", value: `\`${lang}\``, inline: true },
                {
                    name: "Limits",
                    value:
                        `${TTS_RULES.MAX_MESSAGE_LENGTH} characters a message · ` +
                        `${TTS_RULES.MAX_QUEUE} queued · links and mentions are skipped`,
                },
            )
            .setFooter({ text: "/tts leave when you are done. It goes quiet if the channel empties." });

        await respond(interaction, { embeds: [embed] });
        void session;
    } catch (err) {
        await respond(interaction, { content: `**Could not join.** ${err.message}` });
        await ctx.log(`tts: join failed in ${interaction.guildId}: ${err.message}`, "warning", import.meta.url);
    }
}

// ── /tts say ─────────────────────────────────────────────────────────────────

async function sayCommand(interaction, ctx) {
    const text = interaction.options.getString("text");

    const session = getSession(interaction.guildId);
    if (!session) {
        await respond(interaction, { content: "**I am not in a voice channel.** Use `/tts join` first." });
        return;
    }

    const problem = validateSpeech(text);
    if (problem) {
        await respond(interaction, { content: `**${problem.message}.**` });
        return;
    }

    const result = await say(
        interaction.guildId,
        text,
        speechLang(await guildLang(ctx, interaction.guildId)),
    );

    if (!result.spoken) {
        await respond(interaction, {
            content:
                result.reason === "QUEUE_FULL"
                    ? `**Too much queued already** (${result.queued}). Try again in a moment, or \`/tts stop\`.`
                    : "**There is nothing speakable in that.**",
        });
        return;
    }

    await respond(interaction, {
        content: `Saying it — ${result.chunks} piece${result.chunks === 1 ? "" : "s"}: _${sanitiseForSpeech(text).slice(0, 200)}_`,
    });
    void ctx;
}

// ── /tts stop and /tts leave ─────────────────────────────────────────────────

async function stopCommand(interaction, ctx) {
    if (!getSession(interaction.guildId)) {
        await respond(interaction, { content: "**I am not in a voice channel.**" });
        return;
    }

    const dropped = stopSpeaking(interaction.guildId);
    await respond(interaction, {
        content: dropped > 0 ? `Stopped, and dropped ${dropped} queued.` : "Stopped. Nothing was queued.",
    });
    void ctx;
}

async function leaveCommand(interaction, ctx) {
    const left = await leaveVoice(interaction.guildId, `asked by ${interaction.user.id}`);
    await respond(interaction, {
        content: left ? "Left the voice channel." : "**I was not in a voice channel.**",
    });
    void ctx;
}
