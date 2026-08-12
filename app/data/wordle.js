/**
 * app/data/wordle.js — wordle's rules, board and sessions.
 *
 * Ported from `woodle2.py` (the Discord-shaped prototype), `wordle.py` (the console one) and
 * the helpers left in `CsGamingBot.py:477-527`.
 *
 * ⚠️ **HIS WORDLE WAS NEVER A WORKING DISCORD COMMAND.** The monolith has
 * `wordle_target_rand`, `wordle_reset` and `wordle_broad`, plus a full help entry describing
 * how to play — but **no `@client.command()` for it**. `woodle2.py` is a console prototype
 * driven by `while True: input()`, and `wordle.py` is an earlier one. So this is less "port the
 * game" than "finish it", which is why the rules below are pinned down carefully.
 *
 * ⭐ HIS RULES, KEPT
 *   · **Target is 4-6 letters** (`wordle_target_rand(4, 6)`) — NOT classic Wordle's 5. The board
 *     is sized from `len(target)`, so the grid width changes per game. Deliberate; kept.
 *   · **6 attempts.**
 *   · 🟩 right letter, right place · 🟨 right letter, wrong place · 🟥 not in the word.
 *     ⚠️ His help text says the miss colour is **gray** while his code writes **🟥 red**. The
 *     code wins — red is what his players actually saw.
 *   · **A guess of the wrong length is rejected WITHOUT consuming an attempt.**
 *   · **Any letters are a legal guess** — his own prompt read *"Enter your guess word (could be
 *     meaningless)"*, so there is deliberately no dictionary check on guesses.
 *   · **A keyboard tracker**, A-M on one row and N-Z on the other, each letter carrying its best
 *     known state. This was his nicest idea in the whole game and it is kept.
 *   · **The answer is revealed on a loss** — *"The answer is {target} lol."*
 *   · **No bet, no payout.** `money_add` appears nowhere near his wordle. It is a free puzzle,
 *     and adding stakes would be inventing a rule rather than porting one.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ✅ FIXED — real defects
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. 🔑 **THE WORD CAME FROM TWO THIRD-PARTY APIs, AT IMPORT TIME.**
 *        response_a = requests.get("https://zenquotes.io/api/random")
 *        response_b = requests.get(f"https://api.datamuse.com/words?ml={a}")
 *    …and `wordle_reset()` was called at module level (`CsGamingBot.py:510`), so **starting the
 *    bot made two external HTTP calls** and the game was unplayable without the internet. Worse,
 *    `wordle_target_rand` **recursed unboundedly** — two more requests per level — whenever the
 *    filters matched nothing. His `words.txt` was meant to fix this and is **zero bytes**. The
 *    list now lives in `mst_wordle_word`, seeded from the repo.
 *
 * 2. 🔑 **THE BOARD WAS SIX ALIASES OF ONE ROW.**
 *        for i in range(6):
 *            wordle_data['ls'].append(wordle_data['temp_ls'])   # the SAME list, six times
 *    Every row was the same array object, so writing one row wrote all six. It was survivable
 *    only because `ls[count] = tmp_ls[:]` replaced each row with a copy as it was filled, and
 *    the unfilled rows all happened to hold identical blanks. Rows are independent here.
 *
 * 3. 🔑 **A SHORT GUESS CRASHED.** `wordle_out` called `lencheck(guess, target)` and **ignored
 *    its return value**; `lencheck` itself recursed into a whole new `wordle_out(on_msg())` on a
 *    length mismatch, and when that returned the OUTER call carried straight on with the bad
 *    guess — `guess[i]` for `i in range(len(target))` then raised IndexError. Length is checked
 *    and returned on here, before anything indexes the guess.
 *
 * 4. **`playing_wordle` WAS MODULE-LEVEL** — one wordle bot-wide, exactly like OX and blackjack.
 *    Keyed by channel now.
 *
 * 5. **NO TIMEOUT.** An abandoned game held the global flag until a restart.
 *
 * 6. **THE KEYBOARD WAS SKIPPED ON A WINNING GUESS.** His yellow/red pass sat inside
 *    `if not wordle_data['correct']:`, so the final guess never updated the tracker.
 *
 * 7. **DEAD STATE.** `letter_corr` and `posi_corr` were initialised to 0 and never read;
 *    `wordle_msg` and `wordle_channel` were assigned and never used; `wordle.py`'s
 *    `if wordle_data["correct"]` at line 71 was unreachable because line 58 had already returned.
 *
 * ⭐ His duplicate-letter handling was actually CORRECT and is kept as-is: mark greens first,
 * blanking both the guess and target positions, then match remaining letters one-for-one with a
 * `break`. That consumes each target letter exactly once, which is the part most homemade wordles
 * get wrong. Credit where it is due.
 *
 * Everything here is PURE except the session store.
 */

import { ChannelSessions } from "./session-store.js";

export const WORDLE_RULES = {
    MAX_ATTEMPTS: 6,
    /** ⚠️ HIS RANGE — `wordle_target_rand(4, 6)`. Not 5. */
    MIN_LENGTH: 4,
    MAX_LENGTH: 6,
    LIFETIME_MS: 10 * 60 * 1000,
};

/** His marks. ⚠️ The miss is RED because his code wrote 🟥, whatever his help text claimed. */
export const MARK = {
    HIT: "🟩",
    NEAR: "🟨",
    MISS: "🟥",
    BLANK: "⬛",
};

/** Best-known state wins: a letter once green never goes back to yellow. */
const MARK_RANK = { [MARK.BLANK]: 0, [MARK.MISS]: 1, [MARK.NEAR]: 2, [MARK.HIT]: 3 };

/** ⭐ His two keyboard rows — A-M and N-Z, `chr(65+i)` and `chr(78+i)`. */
export const KEYBOARD_ROWS = [
    Array.from({ length: 13 }, (_, i) => String.fromCharCode(97 + i)),
    Array.from({ length: 13 }, (_, i) => String.fromCharCode(110 + i)),
];

/**
 * Score one guess against the target.
 *
 * ⭐ HIS TWO-PASS ALGORITHM, which he got right. Greens first, blanking both sides so a matched
 * target letter cannot be matched again; then one-for-one for the rest. That is what makes
 * double letters behave: guessing "geese" against "eagle" yields exactly the two e's the target
 * has, not three.
 *
 * @param {string} guess   same length as target; any letters allowed
 * @param {string} target
 * @returns {string[]} one MARK per guess position
 */
export function scoreGuess(guess, target) {
    if (guess.length !== target.length) {
        throw new Error(`scoreGuess needs equal lengths, got ${guess.length} and ${target.length}`);
    }

    const marks = new Array(guess.length).fill(MARK.MISS);
    const guessChars = [...guess];
    const targetChars = [...target];

    // Pass 1 — exact positions. Blank both sides so neither can be reused.
    for (let i = 0; i < targetChars.length; i += 1) {
        if (guessChars[i] === targetChars[i]) {
            marks[i] = MARK.HIT;
            guessChars[i] = null;
            targetChars[i] = null;
        }
    }

    // Pass 2 — right letter, wrong place. One target letter consumed per match.
    for (let i = 0; i < targetChars.length; i += 1) {
        if (targetChars[i] === null) continue;
        for (let j = 0; j < guessChars.length; j += 1) {
            if (guessChars[j] === null) continue;
            if (guessChars[j] === targetChars[i]) {
                marks[j] = MARK.NEAR;
                guessChars[j] = null;
                targetChars[i] = null;
                break;
            }
        }
    }

    return marks;
}

/**
 * Fold a scored guess into the keyboard tracker. Best-known state wins.
 *
 * ✅ FIXED #6 — his version ran this only when the guess was wrong, so a winning guess never
 * updated the tracker and the final board showed a keyboard that disagreed with it.
 */
export function updateKeyboard(keyboard, guess, marks) {
    const next = { ...keyboard };
    for (let i = 0; i < guess.length; i += 1) {
        const letter = guess[i];
        const current = next[letter] ?? MARK.BLANK;
        if (MARK_RANK[marks[i]] > MARK_RANK[current]) next[letter] = marks[i];
    }
    return next;
}

export function emptyKeyboard() {
    const keyboard = {};
    for (const row of KEYBOARD_ROWS) {
        for (const letter of row) keyboard[letter] = MARK.BLANK;
    }
    return keyboard;
}

/** Why a guess cannot be accepted. Returns null when it can. */
export function validateGuess(guess, target) {
    if (typeof guess !== "string") return { code: "BAD_GUESS", message: "that is not a word" };

    const cleaned = guess.trim().toLowerCase();

    if (!/^[a-z]+$/.test(cleaned)) {
        return { code: "NOT_LETTERS", message: "letters only — a to z" };
    }

    // ⚠️ FIXED #3 — checked and RETURNED ON here. His `lencheck` recursed into a fresh game and
    // then let the caller continue with the bad guess, which raised IndexError on a short one.
    if (cleaned.length < target.length) {
        return {
            code: "TOO_SHORT",
            message: `too short — the answer is ${target.length} letters`,
            expected: target.length,
        };
    }
    if (cleaned.length > target.length) {
        return {
            code: "TOO_LONG",
            message: `too long — the answer is ${target.length} letters`,
            expected: target.length,
        };
    }

    // ⭐ Deliberately NO dictionary check. His prompt said "could be meaningless".
    return null;
}

export const OUTCOME = {
    SOLVED: "solved",
    EXHAUSTED: "exhausted",
    TIMED_OUT: "timed_out",
    GAVE_UP: "gave_up",
};

/**
 * One game per channel.
 *
 * ⭐ Anyone in the channel may guess, which matches how his channel-wide games worked and what
 * he asked for elsewhere — *"everyone can see when user call market"*. The shared board is the
 * point: a wordle in a busy channel becomes a group effort.
 */
export class WordleSessions extends ChannelSessions {
    start({ channelId, guildId, starterId, target, startedAt = Date.now() }) {
        const key = String(channelId);
        if (this.games.has(key)) throw new Error(`a wordle is already running in ${key}`);

        const word = String(target).trim().toLowerCase();
        if (!/^[a-z]+$/.test(word)) throw new Error(`bad wordle target: ${JSON.stringify(target)}`);
        if (word.length < WORDLE_RULES.MIN_LENGTH || word.length > WORDLE_RULES.MAX_LENGTH) {
            throw new Error(`wordle target ${word} is ${word.length} letters, expected 4-6`);
        }

        const game = {
            channelId: key,
            guildId: guildId ? String(guildId) : null,
            starterId: String(starterId),
            target: word,
            /**
             * ✅ FIXED #2 — each row is its OWN array. His appended one list six times, so every
             * row was the same object and writing one wrote all of them.
             */
            rows: [],
            keyboard: emptyKeyboard(),
            finished: false,
            outcome: null,
            startedAt,
            expiresAt: startedAt + WORDLE_RULES.LIFETIME_MS,
            messageId: null,
            timer: null,
        };

        return this.set(key, game);
    }

    /**
     * Record a valid, correctly-sized guess. The caller holds the lock and has already run
     * `validateGuess`.
     */
    record(channelId, playerId, guess) {
        const game = this.get(channelId);
        if (!game || game.finished) return null;

        const word = guess.trim().toLowerCase();
        const marks = scoreGuess(word, game.target);

        game.rows.push({ playerId: String(playerId), guess: word, marks });
        game.keyboard = updateKeyboard(game.keyboard, word, marks);

        const solved = word === game.target;
        const exhausted = !solved && game.rows.length >= WORDLE_RULES.MAX_ATTEMPTS;

        if (solved) {
            game.finished = true;
            game.outcome = OUTCOME.SOLVED;
        } else if (exhausted) {
            game.finished = true;
            game.outcome = OUTCOME.EXHAUSTED;
        }

        return {
            game,
            marks,
            solved,
            exhausted,
            attempt: game.rows.length,
            attemptsLeft: Math.max(0, WORDLE_RULES.MAX_ATTEMPTS - game.rows.length),
        };
    }
}
