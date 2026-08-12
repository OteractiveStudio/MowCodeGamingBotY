/**
 * app/data/guess.js — the number-guessing game's rules and sessions.
 *
 * Ported from the legacy `guess_cog` (302 lines, the biggest game). The numbers are his:
 * bet 10–1000 · 7 shared attempts · target 1–100 · a 5-minute life · payout ×5 / ×2 /
 * ×1.5 / ×0.5 / nothing by how fast it was solved · every other guesser pays
 * `round(their_guesses × bet / 7)`.
 *
 * ⚠️ THREE DELIBERATE CHANGES, on Ote's instruction — *"you can improve the logic of game
 * running, the old code was when im a student so, might not be the best one"* and *"fix my
 * old logic bug and go on"*. Each is marked ⚠️ FIXED / ⚠️ CHANGED below.
 *
 * Everything here is PURE except the session store, so the rules are unit-tested with no
 * database and no Discord connection.
 */

/** All of these are the legacy's own values. */
export const GUESS_RULES = {
    DEFAULT_BET: 10,
    MIN_BET: 10,
    MAX_BET: 1000,
    MAX_ATTEMPTS: 7,
    MIN_TARGET: 1,
    MAX_TARGET: 100,
    LIFETIME_MS: 5 * 60 * 1000,
};

/**
 * How the win multiplies by the attempt it was solved on:
 *   1st try → ×5 · within 3 → ×2 · within 5 → ×1.5 · 6th → ×0.5 · 7th → nothing but thanks
 */
export function payoutMultiplier(attempt) {
    if (!Number.isInteger(attempt) || attempt < 1) return 0;
    if (attempt === 1) return 5;
    if (attempt <= 3) return 2;
    if (attempt <= 5) return 1.5;
    if (attempt === 6) return 0.5;
    return 0;
}

/** The legacy truncated the fractional multipliers: `int(bet*1.5)`, `int(bet*0.5)`. */
export function winnings(bet, attempt) {
    return Math.trunc(bet * payoutMultiplier(attempt));
}

/**
 * What a losing guesser pays: `round(their_guess_count × bet / 7)`.
 * Seven guesses costs the whole bet, so each guess is worth a seventh of it.
 */
export function perGuessLoss(guessCount, bet) {
    return Math.round((guessCount * bet) / 7);
}

/** Outcomes a game can reach. */
export const OUTCOME = {
    CORRECT: "correct",
    EXHAUSTED: "exhausted",
    TIMEOUT: "timeout",
    CANCELLED_BY_STARTER: "cancelled_by_starter",
    CANCELLED_BY_MODERATOR: "cancelled_by_moderator",
};

/**
 * Work out every money movement a finished game causes. PURE — returns a list for the
 * caller to apply inside one transaction.
 *
 * @param {object} game
 * @param {number} game.bet
 * @param {boolean} game.withBot        true when the bot picked the target
 * @param {string} game.starterId
 * @param {number} game.attempts        how many guesses were made
 * @param {Array<{playerId:string, value:number}>} game.guesses
 * @param {string} outcome              one of OUTCOME
 * @param {string|null} winnerId        who guessed correctly, when outcome is CORRECT
 * @returns {Array<{discordId:string, amount:number, reason:string, note:string}>}
 */
export function settle(game, outcome, winnerId = null) {
    const { bet, withBot, starterId, attempts, guesses } = game;
    const movements = [];

    // A moderator stepping in must not cost anyone anything — same as the legacy.
    if (outcome === OUTCOME.CANCELLED_BY_MODERATOR) return movements;

    // The starter walking away from their own game forfeits the bet, and nobody else pays:
    // they were interrupted, not beaten. Also the legacy's behaviour.
    if (outcome === OUTCOME.CANCELLED_BY_STARTER) {
        movements.push({
            discordId: starterId,
            amount: -bet,
            reason: "game_loss",
            note: "cancelled their own guess game and forfeited the bet",
        });
        return movements;
    }

    let exemptId = null;

    if (outcome === OUTCOME.CORRECT) {
        const prize = winnings(bet, attempts);
        exemptId = winnerId;

        if (prize > 0) {
            movements.push({
                discordId: winnerId,
                amount: prize,
                reason: "game_win",
                note: `guessed it on attempt ${attempts} — ×${payoutMultiplier(attempts)}`,
            });
        }

        // A player who set the target loses the bet when someone cracks it.
        if (!withBot) {
            movements.push({
                discordId: starterId,
                amount: -bet,
                reason: "game_loss",
                note: "their target was guessed",
            });
        }
    } else if (outcome === OUTCOME.EXHAUSTED || outcome === OUTCOME.TIMEOUT) {
        // ⚠️ FIXED — THE BUG OTE ASKED FOR.
        // The legacy said the STARTER won when a player-set target survived all 7 attempts:
        //
        //     end_field["value"] += f"{players[0]} **won the game with the target you choose.**"
        //     end_field["value"] += self.guess_money_process(ctx, guesser, bet)
        //                                                   ^^^^^^^ the LAST GUESSER
        //
        // …but it paid `guesser`, the last person to guess, and the starter got nothing. The
        // message and the payout disagreed. The message was the intent, so the starter wins.
        if (!withBot) {
            movements.push({
                discordId: starterId,
                amount: bet,
                reason: "game_win",
                note:
                    outcome === OUTCOME.TIMEOUT
                        ? "nobody guessed their target in time"
                        : "nobody guessed their target in 7 attempts",
            });
            exemptId = starterId;
        }
        // Against the bot nobody wins; the guessers still pay for their guesses.
    }

    // ⚠️ CHANGED — a timeout now bills the guessers, exactly as running out of attempts
    // does. In the legacy a 5-minute expiry cost everyone nothing while exhausting the
    // attempts charged everyone, even though both are "nobody solved it". Same
    // non-outcome, same bill.
    const guessCounts = new Map();
    for (const guess of guesses) {
        guessCounts.set(guess.playerId, (guessCounts.get(guess.playerId) ?? 0) + 1);
    }

    for (const [playerId, count] of guessCounts) {
        if (playerId === exemptId) continue;
        const loss = perGuessLoss(count, bet);
        if (loss <= 0) continue;
        movements.push({
            discordId: playerId,
            amount: -loss,
            reason: "game_loss",
            note: `guessed ${count} time${count === 1 ? "" : "s"}`,
        });
    }

    return movements;
}

/** Why a game cannot be started. Returns null when it can. */
export function validateStart({ bet, target, balance }) {
    if (!Number.isInteger(bet)) return { code: "BAD_BET", message: "the bet has to be a whole number" };
    if (bet < GUESS_RULES.MIN_BET) {
        return { code: "BET_TOO_LOW", message: `the smallest bet is ${GUESS_RULES.MIN_BET}` };
    }
    if (bet > GUESS_RULES.MAX_BET) {
        return { code: "BET_TOO_HIGH", message: `the biggest bet is ${GUESS_RULES.MAX_BET}` };
    }
    if (bet > balance) {
        return {
            code: "CANNOT_AFFORD",
            message: `you have ${balance}, which will not cover a bet of ${bet}`,
        };
    }
    if (target !== null && target !== undefined) {
        if (!Number.isInteger(target) || target < GUESS_RULES.MIN_TARGET || target > GUESS_RULES.MAX_TARGET) {
            return {
                code: "BAD_TARGET",
                message: `a target has to be a whole number from ${GUESS_RULES.MIN_TARGET} to ${GUESS_RULES.MAX_TARGET}`,
            };
        }
    }
    return null;
}

/** Why a guess cannot be accepted. Returns null when it can. */
export function validateGuess(game, playerId, value) {
    if (!Number.isInteger(value) || value < GUESS_RULES.MIN_TARGET || value > GUESS_RULES.MAX_TARGET) {
        return {
            code: "OUT_OF_RANGE",
            message: `guess a whole number from ${GUESS_RULES.MIN_TARGET} to ${GUESS_RULES.MAX_TARGET}`,
        };
    }
    const already = game.guesses.find((guess) => guess.value === value);
    if (already) {
        return { code: "ALREADY_GUESSED", message: `${value} has already been guessed`, by: already.playerId };
    }
    // Whoever chose the target obviously cannot play against it.
    if (!game.withBot && playerId === game.starterId) {
        return { code: "IS_TARGET_SETTER", message: "you chose the target, so you cannot guess" };
    }
    return null;
}

/** `higher` / `lower` / `correct`, from the guesser's point of view. */
export function compareGuess(value, target) {
    if (value === target) return "correct";
    return value > target ? "higher" : "lower";
}

/**
 * One game per channel, held in memory.
 *
 * ⭐ The legacy already keyed this by channel (`guess_data[channel_id]`) — unlike `OX_board`
 * and `player_hand`, which were module-level and let one game exist across every server at
 * once. That instinct was right, and it is kept.
 *
 * ⚠️ Sessions do NOT survive a restart, which is also true of the legacy. It is safe here
 * because **nothing is deducted until the game ends**: a game lost to a restart costs
 * nobody anything. That is exactly why the bet is not escrowed up front — escrow plus
 * in-memory sessions would mean a restart could take someone's coins and leave no game to
 * win them back, which is worse than the problem it solves.
 */
export class GuessSessions {
    constructor() {
        this.games = new Map();
        this.locks = new Map();
    }

    /**
     * Run `fn` with exclusive access to one channel's game.
     *
     * ⚠️ This replaces the legacy's `guess_out_processing` — a single module-level boolean
     * guarded by `for i in range(10): if processing: await asyncio.sleep(1)`. That was one
     * mutex shared by EVERY channel, and it gave up after ten seconds. Two players clicking
     * at the same instant could otherwise both read `attempts = 3`, both write 4, and both
     * be told they won.
     */
    async withLock(channelId, fn) {
        const previous = this.locks.get(channelId) ?? Promise.resolve();

        let release;
        const mine = new Promise((resolve) => {
            release = resolve;
        });

        // ⚠️ Keep a reference to the CHAINED promise, which is what actually goes in the map.
        // Comparing against `mine` instead never matched, so the map grew forever — caught by
        // "the lock map does not grow forever" in test/unit/guess-rules.test.mjs.
        const chained = previous.then(() => mine);
        this.locks.set(channelId, chained);

        await previous;
        try {
            return await fn();
        } finally {
            release();
            // Only the last waiter clears the entry; if someone else has already queued
            // behind us, the map still holds their link of the chain.
            if (this.locks.get(channelId) === chained) this.locks.delete(channelId);
        }
    }

    has(channelId) {
        return this.games.has(String(channelId));
    }

    get(channelId) {
        return this.games.get(String(channelId)) ?? null;
    }

    start({ channelId, guildId, starterId, bet, target, startedAt = Date.now() }) {
        const key = String(channelId);
        if (this.games.has(key)) throw new Error(`a guess game is already running in ${key}`);

        const withBot = target === null || target === undefined;

        const game = {
            channelId: key,
            guildId: guildId ? String(guildId) : null,
            starterId: String(starterId),
            bet,
            target: withBot ? randomTarget() : target,
            withBot,
            attempts: 0,
            guesses: [],
            startedAt,
            expiresAt: startedAt + GUESS_RULES.LIFETIME_MS,
            messageId: null,
        };

        this.games.set(key, game);
        return game;
    }

    /** Record a guess and return the game plus what it means. Caller holds the lock. */
    record(channelId, playerId, value) {
        const game = this.get(channelId);
        if (!game) return null;

        game.guesses.push({ playerId: String(playerId), value });
        game.attempts += 1;

        const comparison = compareGuess(value, game.target);
        const exhausted = game.attempts >= GUESS_RULES.MAX_ATTEMPTS;

        return {
            game,
            comparison,
            solved: comparison === "correct",
            exhausted,
            attemptsLeft: Math.max(0, GUESS_RULES.MAX_ATTEMPTS - game.attempts),
        };
    }

    end(channelId) {
        return this.games.delete(String(channelId));
    }

    /** Games past their 5 minutes — the sweeper's input. */
    expired(now = Date.now()) {
        return [...this.games.values()].filter((game) => game.expiresAt <= now);
    }
}

function randomTarget() {
    const span = GUESS_RULES.MAX_TARGET - GUESS_RULES.MIN_TARGET + 1;
    return GUESS_RULES.MIN_TARGET + Math.floor(Math.random() * span);
}
