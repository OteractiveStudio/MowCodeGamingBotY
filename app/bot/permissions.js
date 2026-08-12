/**
 * app/bot/permissions.js — who counts as an admin of this bot.
 *
 * ⭐ This is the legacy `is_admin` / `admin_list`, moved to where it belongs. His version read the
 * admin flag from **player rows** (`players_inv.json → info.is_admin`), which `reset_player` could
 * wipe — so a data reset could quietly strip or grant admin. `settings.json.admin_list` held the
 * real list, mixed in with live per-guild state.
 *
 * Here it is `config.bot.admin_ids` in `config.json`, which is the security boundary: a file only
 * someone with the machine can edit, never a row a command can touch (STANDARDS §3).
 *
 * ⚠️ Ote, 2026-08-13: *"make it only admin for now please"* — after a player holding merely Manage
 * Messages cancelled his guess game. Discord permissions are a server owner's business and say
 * nothing about who runs THIS bot, so bot-admin actions check this list instead.
 */

/** Is this user an admin of the bot itself? */
export function isBotAdmin(config, userId) {
    const admins = config?.bot?.admin_ids;
    if (!Array.isArray(admins) || admins.length === 0) return false;
    return admins.map(String).includes(String(userId));
}

/** For messages that need to say who to ask. */
export function botAdminIds(config) {
    const admins = config?.bot?.admin_ids;
    return Array.isArray(admins) ? admins.map(String) : [];
}
