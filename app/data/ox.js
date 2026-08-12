/**
 * app/data/ox.js — noughts and crosses, with betting.
 *
 * ⚠️ Ported from `Gaming Bot/CsGamingBot.py`, NOT from `cogs/ox_cog.py` — the v2 cog is a stub
 * that replies *"Work in Progress."* and the real game only ever existed in the v1 monolith.
 *
 * His rules, kept: a 3×3 board of cells labelled 11…33 · O moves first · rows, columns and
 * both diagonals win · a full board is a draw · vs a player the bet is capped at **1000** and
 * both must afford it · vs the bot the bet is capped at **40** · *"winning will get you half
 * of the bet, while losing will make you lose it all."*
 *
 * ⚠️ TWO BUGS FIXED, both found while reading it (Ote: *"fix my old logic bug and go on"*):
 *
 *   1. **Losing to the bot never cost anything.** The announcement promised "losing will make
 *      you lose it all", and no code ever charged it — the bet-settling branch only ran on a
 *      win. See `settle()`.
 *   2. **The bot winning a bet game would CRASH.** `money_add(OX_player[OX_player_turn].id, …)`
 *      ran whoever won, and when that was the bot, `OX_player[turn]` is the literal string
 *      `"bot"` — so `.id` raised AttributeError. It tried to pay coins to the bot.
 *
 * ⚠️ And one inconsistency left as-is but reported: the bankruptcy guard tested
 * `money_check(id) < -10` while its own message said *"You have less than -20 BezCoins"*. This
 * uses the established −20 (`BAD_ECON_THRESHOLD`), so one number means one thing everywhere.
 */

import { ChannelSessions } from "./session-store.js";
import { BAD_ECON_THRESHOLD } from "./economy.js";

export const OX_RULES = {
    MAX_BET_VS_PLAYER: 1000,
    MAX_BET_VS_BOT: 40,
    /** A win against the bot pays half the bet, floored — his `int(OX_bet)//2`. */
    BOT_WIN_DIVISOR: 2,
    /** How long a challenge waits for an answer before it lapses. */
    CHALLENGE_TIMEOUT_MS: 2 * 60 * 1000,
    /** How long an idle board survives. The legacy had no timeout at all and could wedge. */
    GAME_TIMEOUT_MS: 5 * 60 * 1000,
};

export const MARKS = { FIRST: "O", SECOND: "X" };

/** The eight ways to win, as indices into a row-major 9-cell board. */
export const WINNING_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6],            // diagonals
];

export function emptyBoard() {
    return Array(9).fill(null);
}

/** His cell labels: row and column, both 1-indexed — "11" through "33". */
export function cellLabel(index) {
    return `${Math.floor(index / 3) + 1}${(index % 3) + 1}`;
}

export function labelToIndex(label) {
    const text = String(label);
    if (!/^[1-3][1-3]$/.test(text)) return -1;
    return (Number(text[0]) - 1) * 3 + (Number(text[1]) - 1);
}

/** The winning mark and the line that did it, or null. */
export function winnerOf(board) {
    for (const line of WINNING_LINES) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return { mark: board[a], line };
        }
    }
    return null;
}

export function isFull(board) {
    return board.every((cell) => cell !== null);
}

export function emptyCells(board) {
    return board.reduce((cells, value, index) => {
        if (value === null) cells.push(index);
        return cells;
    }, []);
}

/**
 * The bot's move.
 *
 * ⭐ Deliberately RANDOM, exactly as his `OX_bot()` was — it picked cells at random and
 * retried until one was free. This is not laziness carried forward: the payout is asymmetric
 * on purpose (*win half the bet, lose all of it*), so the player has to win **more than twice
 * as often as they lose** to come out ahead. A bot that played properly would draw or win
 * nearly every game and make betting against it a pure loss. The weak bot IS the balance.
 */
export function botMove(board, random = Math.random) {
    const free = emptyCells(board);
    if (free.length === 0) return -1;
    return free[Math.floor(random() * free.length)];
}

/** Why a game cannot start. Returns null when it can. */
export function validateOxStart({ bet, withBot, challengerBalance, opponentBalance = null }) {
    if (!Number.isInteger(bet) || bet < 0) {
        return { code: "BAD_BET", message: "the bet has to be a whole number, or zero for a friendly game" };
    }

    const cap = withBot ? OX_RULES.MAX_BET_VS_BOT : OX_RULES.MAX_BET_VS_PLAYER;
    if (bet > cap) {
        return {
            code: "BET_TOO_HIGH",
            message: withBot
                ? `you cannot bet more than ${cap} against the bot`
                : `the biggest bet is ${cap}`,
        };
    }

    if (bet === 0) return null; // A friendly game needs no coins at all.

    if (challengerBalance < bet) {
        return { code: "CANNOT_AFFORD", message: `you have ${challengerBalance}, not enough to bet ${bet}` };
    }
    if (challengerBalance <= BAD_ECON_THRESHOLD) {
        return {
            code: "BANKRUPT",
            message: `you are below ${BAD_ECON_THRESHOLD} coins — settle up before betting`,
        };
    }

    if (!withBot) {
        if (opponentBalance === null) {
            return { code: "NO_OPPONENT_STATE", message: "the opponent has never played before" };
        }
        if (opponentBalance <= BAD_ECON_THRESHOLD) {
            return {
                code: "OPPONENT_BANKRUPT",
                message: `your opponent is below ${BAD_ECON_THRESHOLD} coins`,
            };
        }
        if (opponentBalance < bet) {
            return {
                code: "OPPONENT_CANNOT_AFFORD",
                message: `your opponent only has ${opponentBalance}, so the most you can bet is ${opponentBalance}`,
            };
        }
    }

    return null;
}

/**
 * What a finished game pays. PURE — the caller applies it in one transaction.
 *
 * vs a PLAYER: the winner takes the bet from the loser. (His code transferred the FULL bet
 * both ways, even though the message it printed said "half of {bet}" — the amount was right
 * and the wording was wrong.)
 *
 * vs the BOT: winning pays **half the bet, floored**; losing costs **the whole bet**. That
 * second half is the rule he announced and never implemented.
 *
 * A draw costs nobody anything — *"Nobody has to lose their BezCoins for this game."*
 */
export function settle({ bet, withBot, challengerId, opponentId, outcome }) {
    const movements = [];
    if (!bet || bet <= 0) return movements;

    if (outcome === "draw") return movements;

    if (withBot) {
        if (outcome === "challenger") {
            movements.push({
                discordId: challengerId,
                amount: Math.floor(bet / OX_RULES.BOT_WIN_DIVISOR),
                reason: "game_win",
                note: `beat the bot at OX — half of ${bet}`,
            });
        } else if (outcome === "bot") {
            // ⚠️ FIXED: the legacy promised this and never charged it.
            movements.push({
                discordId: challengerId,
                amount: -bet,
                reason: "game_loss",
                note: "lost to the bot at OX — the whole bet",
            });
        }
        return movements;
    }

    const winnerId = outcome === "challenger" ? challengerId : opponentId;
    const loserId = outcome === "challenger" ? opponentId : challengerId;

    movements.push({
        discordId: winnerId,
        amount: bet,
        reason: "game_win",
        note: "won at OX",
    });
    movements.push({
        discordId: loserId,
        amount: -bet,
        reason: "game_loss",
        note: "lost at OX",
    });

    return movements;
}

/** Whose mark is it, given how many moves have been played? O always starts. */
export function markForTurn(moveCount) {
    return moveCount % 2 === 0 ? MARKS.FIRST : MARKS.SECOND;
}

/**
 * One OX game per channel.
 *
 * ⚠️ This is the class that fixes the legacy's worst structural problem in this game: its
 * board and players were module-level globals, so **one game existed across every server the
 * bot was in.** Two channels playing at once overwrote each other's board.
 */
export class OxSessions extends ChannelSessions {
    /** A pending challenge, or a live board when `withBot`. */
    start({ channelId, guildId, challengerId, opponentId, bet, withBot, startedAt = Date.now() }) {
        const key = String(channelId);
        if (this.has(key)) throw new Error(`an OX game is already running in ${key}`);

        return this.set(key, {
            channelId: key,
            guildId: guildId ? String(guildId) : null,
            challengerId: String(challengerId),
            opponentId: opponentId ? String(opponentId) : null,
            withBot,
            bet,
            board: emptyBoard(),
            moves: 0,
            accepted: withBot, // playing the bot needs nobody's permission
            startedAt,
            expiresAt: startedAt + (withBot ? OX_RULES.GAME_TIMEOUT_MS : OX_RULES.CHALLENGE_TIMEOUT_MS),
            messageId: null,
        });
    }

    /** Whose turn it is: the challenger is O and moves first. */
    currentPlayer(game) {
        return markForTurn(game.moves) === MARKS.FIRST
            ? game.challengerId
            : game.withBot
              ? "bot"
              : game.opponentId;
    }

    /** Place a mark. Caller holds the lock and has already validated the cell. */
    place(game, index) {
        game.board[index] = markForTurn(game.moves);
        game.moves += 1;

        const win = winnerOf(game.board);
        return {
            win,
            full: isFull(game.board),
            finished: Boolean(win) || isFull(game.board),
        };
    }
}
