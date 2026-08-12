/**
 * app/data/session-store.js — one game per channel, with a per-channel lock.
 *
 * ⭐ THE DISTINCTION THIS CLASS EXISTS TO ENFORCE. In the legacy, `guess_cog` keyed its state
 * by channel (`guess_data[channel_id]`) and was fine, while the monolith's OX kept
 * `OX_board`, `OX_player`, `OX_player_turn` and `playing_ox` as **module-level globals** — so
 * the bot could host exactly ONE OX game across every server it was in, and two channels
 * playing at once corrupted each other's board.
 *
 * Every game built on this is keyed by channel from the start, so that cannot happen.
 *
 * ⚠️ The lock is not optional. Two players clicking a button in the same instant would
 * otherwise both read the same turn state and both write it. The legacy's guard for this was
 * `guess_out_processing` — ONE module-level boolean shared by every channel, with a
 * `for i in range(10): if processing: await asyncio.sleep(1)` wait that gave up after ten
 * seconds and carried on regardless.
 *
 * ⚠️ Sessions live in memory and do NOT survive a restart. That is safe only because no game
 * built on this deducts anything until it ends: a game lost to a restart costs nobody
 * anything. Escrowing a bet up front would break that property, which is why none of them do.
 */
export class ChannelSessions {
    constructor() {
        this.games = new Map();
        this.locks = new Map();
    }

    /**
     * Run `fn` with exclusive access to one channel's game. Calls queue in arrival order.
     */
    async withLock(channelId, fn) {
        const key = String(channelId);
        const previous = this.locks.get(key) ?? Promise.resolve();

        let release;
        const mine = new Promise((resolve) => {
            release = resolve;
        });

        // ⚠️ Hold a reference to the CHAINED promise — that is what goes in the map. An
        // earlier version compared the map entry against `mine` instead, so it never matched,
        // the entry was never dropped and the map grew forever. Caught by a test, not by
        // reading it.
        const chained = previous.then(() => mine);
        this.locks.set(key, chained);

        await previous;
        try {
            return await fn();
        } finally {
            release();
            // Only the last waiter clears the entry; if someone queued behind us the map
            // still holds their link of the chain.
            if (this.locks.get(key) === chained) this.locks.delete(key);
        }
    }

    has(channelId) {
        return this.games.has(String(channelId));
    }

    get(channelId) {
        return this.games.get(String(channelId)) ?? null;
    }

    set(channelId, game) {
        this.games.set(String(channelId), game);
        return game;
    }

    end(channelId) {
        const key = String(channelId);
        const game = this.games.get(key);
        if (game?.timer) clearTimeout(game.timer);
        return this.games.delete(key);
    }

    /** Games past their expiry — the sweeper's input. */
    expired(now = Date.now()) {
        return [...this.games.values()].filter((game) => game.expiresAt && game.expiresAt <= now);
    }

    get size() {
        return this.games.size;
    }
}
