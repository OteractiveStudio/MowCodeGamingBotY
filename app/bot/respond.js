/**
 * app/bot/respond.js — answer an interaction without caring whether it was deferred.
 *
 * ⚠️ WHY THIS EXISTS. Discord gives a command **3 seconds** to acknowledge an interaction. Miss
 * it and the token is dead: every later call fails with `DiscordAPIError[10062]: Unknown
 * interaction`, and the user sees nothing but a red "the application did not respond".
 *
 * That is exactly what happened to `/market` and `/ox` — both did database work (a multi-join
 * market read, `ensurePlayer` plus a state read) *before* their first reply, and on a cold
 * connection pool that took longer than three seconds. It is not a slow-database problem: any
 * command that touches Postgres before replying is one bad moment away from the same failure.
 *
 * So `dispatch.js` now DEFERS every chat-input command before calling it, and commands answer
 * through `respond()`. Deferring shows "thinking…" immediately and extends the window to 15
 * minutes.
 *
 * ⚠️ Deferring is NOT free of consequences, which is why it is not applied to components:
 *   · `showModal()` cannot be called on a deferred interaction — a modal IS the acknowledgement.
 *     Component handlers therefore stay un-deferred and answer promptly.
 *   · ephemerality is fixed at defer time. `editReply()` cannot make a reply private later, so a
 *     command that wants a private answer declares `defer: "ephemeral"`.
 */

import { MessageFlags } from "discord.js";

/**
 * Reply, or edit the deferred reply — whichever this interaction needs.
 * Accepts a string or a full payload object.
 */
export async function respond(interaction, payload) {
    const body = typeof payload === "string" ? { content: payload } : payload;

    if (interaction.deferred || interaction.replied) {
        // ⚠️ `flags` must be dropped when editing: ephemerality was decided at defer time and
        // editReply cannot change it. Leaving it in makes the API reject the edit, which would
        // turn a working command into a silent failure — the very thing this file prevents.
        const { flags, ...editable } = body;
        return interaction.editReply(editable);
    }
    return interaction.reply(body);
}

/**
 * Acknowledge a chat-input command up front. Returns true if it deferred.
 *
 * `defer` on a command may be:
 *   undefined / true → defer publicly (the default: almost everything reads the database)
 *   "ephemeral"      → defer privately
 *   false            → do not defer (only safe when the handler touches nothing slow)
 */
export async function deferFor(interaction, defer) {
    if (defer === false) return false;
    if (interaction.deferred || interaction.replied) return false;

    await interaction.deferReply(
        defer === "ephemeral" ? { flags: MessageFlags.Ephemeral } : {},
    );
    return true;
}
