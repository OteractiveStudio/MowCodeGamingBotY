/**
 * app/data/economy.js — money, exp, levels and crystals.
 *
 * 🔑 THIS FILE IS THE WHOLE REASON FOR THE REWRITE.
 *
 * The legacy did it like this, and every mutator in `MCGB_BasicClass` worked the
 * same way:
 *
 *     def money_add(self, player_id, money):
 *         player_data = self.read_json(...)          # read the WHOLE file
 *         player_data[id]["inventory"]["money"] += money
 *         self.write_json(...)                       # write the WHOLE file back
 *         return self.exp_add(player_id, money)      # which reads and writes it AGAIN
 *
 * No lock, no transaction. One `+fishing auto` did that 120+ times in a loop while
 * other players' commands interleaved, so overlapping writes silently lost.
 *
 * Here: the state row is locked with `SELECT … FOR UPDATE`, the progression cascade
 * is computed, and the UPDATE plus its `log_economy` row land in ONE transaction.
 * Concurrent callers queue on the lock instead of overwriting each other, and
 * because the log row is written in the same transaction, the log can never
 * disagree with the balance.
 *
 * The rules themselves are the legacy's, unchanged unless marked ⚠️ DIVERGENCE.
 */

import { QueryTypes } from "sequelize";

/** Below this, the legacy `is_bad_econ` treats a player as in trouble. */
export const BAD_ECON_THRESHOLD = -20;

const STATE_COLUMNS =
    "discord_id, money, exp, level, magical_crystal, fishing_rod, inventory_size, fishing_count";

/**
 * BIGINT comes back from pg as a STRING (it can exceed IEEE 754). Parse it
 * deliberately and refuse anything that would silently lose precision, rather than
 * letting `"9007199254740993" + 1` quietly become wrong.
 */
export function toInt(value, what = "value") {
    const number = typeof value === "string" ? Number(value) : value;
    if (!Number.isSafeInteger(number)) {
        throw new Error(
            `${what} is not a safe integer: ${JSON.stringify(value)} — refusing to do arithmetic on it`,
        );
    }
    return number;
}

/**
 * The exp cap, straight from the legacy:
 *     exp_cap = level * 10 + magical_crystal * 2
 */
export function expCap(level, magicalCrystal) {
    return level * 10 + magicalCrystal * 2;
}

/**
 * ⭐ The progression cascade — PURE, so it is unit-tested with no database.
 *
 * Reproduces the legacy's recursion exactly:
 *   - exp is clamped at 0 (`if exp < 0: exp = 0`)
 *   - at or above the cap: level +1, exp -= cap, and check again — one credit can
 *     carry through several levels
 *   - at level 100: +1 magical crystal, level -= 100
 *
 * ⚠️ A quirk kept rather than "fixed": when level is 0 and there are no crystals the
 * cap is 0, so `exp >= cap` is true even for a zero gain and the player levels to 1.
 * The legacy did that; changing it would change the game. It terminates because the
 * level increments on every pass.
 */
export function cascadeProgress({ exp, level, magical_crystal, expDelta }) {
    let nextExp = exp + expDelta;
    if (nextExp < 0) nextExp = 0;

    let nextLevel = level;
    let nextCrystal = magical_crystal;
    let levelsGained = 0;
    let crystalsGained = 0;

    for (let guard = 0; ; guard += 1) {
        // Not reachable with sane inputs; here so a future rule change cannot turn
        // this into a hung command instead of a loud error.
        if (guard > 100_000) {
            throw new Error(
                `progression cascade did not converge (exp=${nextExp} level=${nextLevel} crystal=${nextCrystal})`,
            );
        }

        const cap = expCap(nextLevel, nextCrystal);
        if (nextExp < cap) break;

        nextExp -= cap;
        nextLevel += 1;
        levelsGained += 1;

        if (nextLevel >= 100) {
            nextCrystal += 1;
            crystalsGained += 1;
            nextLevel -= 100;
        }
    }

    return {
        exp: nextExp,
        level: nextLevel,
        magical_crystal: nextCrystal,
        levelsGained,
        crystalsGained,
    };
}

export function isBadEcon(money) {
    return toInt(money, "money") < BAD_ECON_THRESHOLD;
}

/** Read a player's state. Returns null when the player has never been provisioned. */
export async function getState(db, discordId, options = {}) {
    const rows = await db.sequelize.query(
        `SELECT ${STATE_COLUMNS} FROM ${db.schema}.mst_player_state WHERE discord_id = :id`,
        {
            replacements: { id: String(discordId) },
            type: QueryTypes.SELECT,
            transaction: options.transaction,
        },
    );
    return rows[0] ?? null;
}

/**
 * Lock one state row for the rest of the transaction. Every writer goes through
 * here, so writers are serialised per player while different players stay parallel.
 */
async function lockState(db, discordId, transaction) {
    const rows = await db.sequelize.query(
        `SELECT ${STATE_COLUMNS} FROM ${db.schema}.mst_player_state
          WHERE discord_id = :id FOR UPDATE`,
        { replacements: { id: String(discordId) }, type: QueryTypes.SELECT, transaction },
    );
    return rows[0] ?? null;
}

async function writeState(db, discordId, next, transaction) {
    await db.sequelize.query(
        `UPDATE ${db.schema}.mst_player_state
            SET money = :money, exp = :exp, level = :level,
                magical_crystal = :crystal, updated_at = now()
          WHERE discord_id = :id`,
        {
            replacements: {
                id: String(discordId),
                money: next.money,
                exp: next.exp,
                level: next.level,
                crystal: next.magical_crystal,
            },
            transaction,
        },
    );
}

async function writeLog(db, entry, transaction) {
    await db.sequelize.query(
        `INSERT INTO ${db.schema}.log_economy
            (discord_id, reason, money_delta, money_after, exp_delta, exp_after,
             level_after, crystal_after, levels_gained, crystals_gained, ref, guild_id, actor_id)
         VALUES
            (:discord_id, :reason, :money_delta, :money_after, :exp_delta, :exp_after,
             :level_after, :crystal_after, :levels_gained, :crystals_gained, :ref, :guild_id, :actor_id)`,
        { replacements: entry, transaction },
    );
}

/**
 * Apply a money change, with the exp/level/crystal cascade and its audit row, in one
 * transaction against a locked state row.
 *
 * `expDelta` defaults to `amount` because in the legacy `money_add` called
 * `exp_add(money)` — coins earned and exp earned are the same number. Pass 0
 * explicitly for money movements that should not grant progress.
 *
 * @param {object} db
 * @param {object} change
 * @param {string} change.discordId
 * @param {number} change.amount        may be negative; money is allowed to go negative
 * @param {string} change.reason        must be one of db.choices.economy_reason
 * @param {number} [change.expDelta]    defaults to `amount`
 * @param {string} [change.ref]         fish key, item key, or the other player
 * @param {string} [change.guildId]
 * @param {string} [change.actorId]
 * @param {object} [change.transaction] join an outer transaction instead of opening one
 */
export async function addMoney(db, change) {
    const {
        discordId,
        amount,
        reason,
        expDelta = amount,
        ref = null,
        guildId = null,
        actorId = null,
        transaction: outer,
    } = change;

    if (!Number.isInteger(amount)) {
        throw new Error(`addMoney amount must be an integer, got ${JSON.stringify(amount)}`);
    }
    if (!db.choices.economy_reason.includes(reason)) {
        throw new Error(
            `addMoney reason "${reason}" is not one of: ${db.choices.economy_reason.join(", ")}`,
        );
    }

    const run = async (transaction) => {
        const state = await lockState(db, discordId, transaction);
        if (!state) {
            throw new Error(
                `no state row for player ${discordId} — provision them with ensurePlayer() first`,
            );
        }

        const progressed = cascadeProgress({
            exp: state.exp,
            level: state.level,
            magical_crystal: state.magical_crystal,
            expDelta,
        });

        const moneyAfter = toInt(state.money, "money") + amount;

        const next = {
            money: moneyAfter,
            exp: progressed.exp,
            level: progressed.level,
            magical_crystal: progressed.magical_crystal,
        };

        await writeState(db, discordId, next, transaction);

        await writeLog(
            db,
            {
                discord_id: String(discordId),
                reason,
                money_delta: amount,
                money_after: moneyAfter,
                exp_delta: expDelta,
                exp_after: progressed.exp,
                level_after: progressed.level,
                crystal_after: progressed.magical_crystal,
                levels_gained: progressed.levelsGained,
                crystals_gained: progressed.crystalsGained,
                ref,
                guild_id: guildId ? String(guildId) : null,
                actor_id: actorId ? String(actorId) : null,
            },
            transaction,
        );

        return {
            money: moneyAfter,
            exp: progressed.exp,
            level: progressed.level,
            magical_crystal: progressed.magical_crystal,
            levelsGained: progressed.levelsGained,
            crystalsGained: progressed.crystalsGained,
            isBadEcon: moneyAfter < BAD_ECON_THRESHOLD,
        };
    };

    return outer ? run(outer) : db.sequelize.transaction(run);
}

/**
 * Move money between two players, atomically.
 *
 * ⚠️ DIVERGENCE 1 — the sender must be able to afford it. The legacy's `money_add`
 * would happily push a giver negative, because it had no notion of a transfer at all.
 * A negative balance should come from a penalty, not from generosity. Reversible: it
 * is this one check.
 *
 * ⚠️ DIVERGENCE 2 — a transfer grants NO exp to either side. In the legacy every
 * `money_add` granted exp equal to the money, so two players passing the same coins
 * back and forth would have been an infinite exp machine. Reversible: it is the
 * `expDelta: 0` below.
 *
 * ⚠️ Locks are taken in sorted id order. Two simultaneous transfers in opposite
 * directions between the same pair would otherwise each hold the lock the other
 * needs — a deadlock. Sorting makes every transaction grab them in the same order.
 */
export async function transfer(db, { fromId, toId, amount, guildId = null }) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error(`transfer amount must be a positive integer, got ${JSON.stringify(amount)}`);
    }
    if (String(fromId) === String(toId)) {
        throw new Error("a player cannot transfer to themselves");
    }

    return db.sequelize.transaction(async (transaction) => {
        const ordered = [String(fromId), String(toId)].sort();
        const locked = new Map();
        for (const id of ordered) {
            const state = await lockState(db, id, transaction);
            if (!state) {
                throw new Error(`no state row for player ${id} — provision them first`);
            }
            locked.set(id, state);
        }

        const senderMoney = toInt(locked.get(String(fromId)).money, "sender money");
        if (senderMoney < amount) {
            throw new Error(
                `insufficient funds: ${senderMoney} available, ${amount} requested`,
            );
        }

        const sender = await addMoney(db, {
            discordId: fromId,
            amount: -amount,
            expDelta: 0,
            reason: "transfer_out",
            ref: String(toId),
            guildId,
            actorId: String(fromId),
            transaction,
        });

        const recipient = await addMoney(db, {
            discordId: toId,
            amount,
            expDelta: 0,
            reason: "transfer_in",
            ref: String(fromId),
            guildId,
            actorId: String(fromId),
            transaction,
        });

        return { sender, recipient, amount };
    });
}

/**
 * Rebuild a balance from its log — the thing the legacy could never do.
 *
 * Returns the ledger newest-first plus a verdict on whether the chain is internally
 * consistent: ordered by rolling_id, every row's `money_after` must equal the
 * previous row's `money_after` plus this row's `money_delta`.
 */
export async function explainBalance(db, discordId, limit = 20) {
    const rows = await db.sequelize.query(
        `SELECT rolling_id, occurred_on, reason, money_delta, money_after,
                exp_delta, level_after, crystal_after, levels_gained, crystals_gained, ref, actor_id
           FROM ${db.schema}.log_economy
          WHERE discord_id = :id
          ORDER BY rolling_id ASC`,
        { replacements: { id: String(discordId) }, type: QueryTypes.SELECT },
    );

    let expected = null;
    const breaks = [];
    for (const row of rows) {
        const after = toInt(row.money_after, "money_after");
        const delta = toInt(row.money_delta, "money_delta");
        if (expected !== null && after !== expected + delta) {
            breaks.push({ rolling_id: row.rolling_id, expected: expected + delta, found: after });
        }
        expected = after;
    }

    const state = await getState(db, discordId);
    const liveMoney = state ? toInt(state.money, "money") : null;

    return {
        entries: rows.slice(-limit).reverse(),
        total: rows.length,
        chainIsConsistent: breaks.length === 0,
        breaks,
        // The ledger's last word and the live row must agree. If they do not, a write
        // happened outside this module.
        matchesLiveBalance: expected === null ? liveMoney === null : expected === liveMoney,
        ledgerBalance: expected,
        liveBalance: liveMoney,
    };
}
