/**
 * app/data/coinflip.js — the coin flip's rules, including his high-roller brake.
 *
 * Ported from the legacy `coinflip` command, `CsGamingBot.py:1237-1292`. His numbers, kept:
 * **min 6 coins to play · bet ≥ 3 · bet ≤ HALF your money** (and the default bet IS half) ·
 * a win pays **+bet**, a loss **−bet**, no rake.
 *
 * ⭐ Those three limits are not arbitrary and they agree with each other: a bet must be at
 * least 3 and at most half your money, so half your money must be at least 3 — which means
 * you need 6. **The `min 6` rule is derived, not invented.** Worth saying because it is easy
 * to read his student-era code as a pile of magic numbers when this part was coherent.
 *
 * ⭐ **YOU TYPE THE CALL, you do not pick it from a list.** Ote, 2026-08-13: *"plain chat
 * better ux"* — the same instinct as *"why it dropdown menu? not a direct button"* on the
 * market and *"make it the old style where user type in chat"* on the guess game. So his
 * alias table is ported as-is and `parseSide()` below accepts every form his players already
 * had in their fingers: `h`/`head`/`หัว` and `t`/`tail`/`ก้อย`/`หาง`. Autocomplete offers the
 * forms as hints while you type, so typing is helped rather than policed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⭐ THE HIGH-ROLLER BRAKE — his, kept, and now VISIBLE
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `CsGamingBot.py:1271-1279`, verbatim:
 *
 *     ht_chance = ["Head"]*1 + ["Tail"]*1
 *     if player_money > 100000:
 *         if player_guess == "Head":
 *             ht_chance.append("Tail")
 *         else:
 *             ht_chance.append("Head")
 *     ...
 *     correct_choice = random.choice(ht_chance)
 *
 * Above the threshold it appends **the opposite of what the player just guessed**, so the
 * list is 3 long with 2 entries on the side they did not pick: win odds **1/2 → 1/3**, EV
 * **0 → −bet/3**. The coin is not biased toward a *side* — it is biased against the
 * *player*, rebuilt from their own guess every flip. Two rich players flipping in the same
 * second get differently-weighted coins.
 *
 * ⭐ **Ote confirmed the intent, 2026-08-13: *"yeah it was my an anti-inflation thing, so"*.**
 * So it stays. Two things make it defensible where the original was not:
 *
 *   1. ⭐ **It is VISIBLE.** The cog says the odds are 1-in-3 *before* the result, and says
 *      why. Ote: *"but visible, yeah."* A brake players can see is a rule; the same brake
 *      hidden is just losing more and not knowing why, which is how an economy loses trust.
 *   2. ⭐ **It is LOGGED whenever it fires.** Ote: *"but make it log when this system fired"*.
 *      `describeBrake()` gives the cog one line for the message log, and the ledger `ref`
 *      carries `:highroller` so every affected flip is findable in `log_economy` afterwards
 *      — which is what makes it possible to ever check whether the brake is doing anything.
 *
 * ⚠️ It reads the balance **before** the bet, exactly as his did. That is not incidental: it
 * is what makes the brake self-disengaging. One or two max-bet losses drop you back under
 * the threshold and the coin is fair again, so it behaves as a **soft ceiling that pulls you
 * back down**, not a penalty for having been rich. Moving the read after the bet would turn
 * it into a permanent tax and change the mechanic.
 *
 * 📌 For the record, it **never once fired in the legacy**: the richest balance in the final
 * save was 1,401, and 54,217 in the older CsGamingBot text save, against a threshold of
 * 100,001. It is being ported as a working brake for an economy that has not needed it yet.
 *
 * ⚠️ Off-by-one preserved: his test is `> 100000`, so the brake starts at **100,001**.
 *
 * Everything here is PURE — no database, no Discord — so the odds are unit-tested by
 * counting outcomes rather than by trusting the comment above.
 */

/** His values. `HIGH_ROLLER_THRESHOLD` is overridable per install via `bot.high_roller_threshold`. */
export const COINFLIP_RULES = {
    MIN_MONEY: 6,
    MIN_BET: 3,
    HIGH_ROLLER_THRESHOLD: 100000,
    /** How many entries the brake adds to the chance list. His code appended exactly one. */
    BRAKE_EXTRA_ENTRIES: 1,
};

export const SIDES = ["head", "tail"];

/** His Thai wording survives here, because it is what the players actually read. */
export const SIDE_LABEL = {
    head: "Head · หัว",
    tail: "Tail · ก้อย",
};

export const SIDE_EMOJI = {
    head: "🙂",
    tail: "🪙",
};

/**
 * His accepted spellings, verbatim from `CsGamingBot.py:1245-1248`:
 *
 *     if guess.lower() in ["h","head","หัว"]:            player_guess = "Head"
 *     elif guess.lower() in ["t","tail","ก้อย","หาง"]:    player_guess = "Tail"
 *
 * ⭐ Note `หาง` alongside `ก้อย` — both are "tail", one literally (an animal's tail) and one
 * the coin-toss word. He had clearly watched someone type the wrong one.
 */
export const SIDE_ALIASES = {
    head: ["h", "head", "heads", "หัว"],
    tail: ["t", "tail", "tails", "ก้อย", "หาง"],
};

/**
 * Read whatever the player typed. Returns "head", "tail", or null.
 *
 * ⚠️ Trimmed as well as lowercased. His `guess.lower()` did not trim, so a trailing space
 * from a phone keyboard fell through to "invalid format" — a rejection the player could not
 * see the cause of.
 */
export function parseSide(input) {
    if (typeof input !== "string") return null;
    const cleaned = input.trim().toLowerCase();
    if (cleaned === "") return null;
    for (const [side, aliases] of Object.entries(SIDE_ALIASES)) {
        if (aliases.includes(cleaned)) return side;
    }
    return null;
}

/** What to tell someone whose call did not parse — his accepted forms, not a shrug. */
export function acceptedSides() {
    return `${SIDE_ALIASES.head.join(" / ")} — or — ${SIDE_ALIASES.tail.join(" / ")}`;
}

/** The other side. The brake needs it, and so does explaining a loss. */
export function opposite(side) {
    return side === "head" ? "tail" : "head";
}

/**
 * Half your money, floored — his `player_money//2`.
 *
 * ⚠️ Python's `//` floors toward negative infinity and `Math.floor` does too, so a negative
 * balance gives a negative cap here exactly as it did there. Nothing downstream can act on
 * that, because MIN_MONEY rejects the player long before it matters — but the parity is
 * deliberate rather than accidental.
 */
export function maxBet(money) {
    return Math.floor(money / 2);
}

/** ⚠️ His default bet is the MAXIMUM bet. For a rich player they are the same number. */
export function defaultBet(money) {
    return maxBet(money);
}

/**
 * Is the brake engaged for this balance?
 *
 * A non-finite or null threshold **disables** it, which is how an install turns the brake
 * off without the rule disappearing from the code.
 */
export function isHighRoller(money, threshold = COINFLIP_RULES.HIGH_ROLLER_THRESHOLD) {
    if (threshold === null || threshold === undefined) return false;
    if (!Number.isFinite(threshold)) return false;
    return money > threshold;
}

/**
 * The chance list, built exactly the way his was — two fair entries, plus the opposite of
 * the player's guess when the brake is engaged.
 *
 * Returned rather than kept private so the odds are **auditable**: the test counts this
 * list instead of trusting a comment, and the cog derives the displayed odds from it rather
 * than hardcoding "1 in 3" somewhere it can drift out of step.
 */
export function chanceList(guess, money, threshold = COINFLIP_RULES.HIGH_ROLLER_THRESHOLD) {
    const list = [...SIDES];
    if (isHighRoller(money, threshold)) {
        for (let i = 0; i < COINFLIP_RULES.BRAKE_EXTRA_ENTRIES; i += 1) {
            list.push(opposite(guess));
        }
    }
    return list;
}

/** The player's real chance of winning, derived from the list rather than asserted. */
export function winChance(guess, money, threshold = COINFLIP_RULES.HIGH_ROLLER_THRESHOLD) {
    const list = chanceList(guess, money, threshold);
    return list.filter((side) => side === guess).length / list.length;
}

/**
 * One line for the message log and the player, when the brake is engaged — otherwise null.
 * Ote asked for both: *"but visible, yeah. but make it log when this system fired"*.
 */
export function describeBrake(guess, money, threshold = COINFLIP_RULES.HIGH_ROLLER_THRESHOLD) {
    if (!isHighRoller(money, threshold)) return null;

    const chance = winChance(guess, money, threshold);
    return {
        threshold,
        money,
        chance,
        /** "1 in 3" reads better than 0.333 to a player mid-game. */
        odds: `1 in ${Math.round(1 / chance)}`,
        percent: Math.round(chance * 100),
        player: `You are above ${threshold.toLocaleString("en-US")} coins, so the coin is weighted against you: **${`1 in ${Math.round(1 / chance)}`}** instead of 1 in 2.`,
        log:
            `HIGH-ROLLER BRAKE FIRED — balance ${money} > ${threshold}, guess ${guess}, ` +
            `win chance ${Math.round(chance * 100)}% (fair would be 50%)`,
    };
}

/** Why a flip cannot happen. Returns null when it can. */
export function validateFlip({ money, bet }) {
    // ⚠️ ORDER FIXED. His code printed the default-bet message BEFORE checking the 6-coin
    // minimum, so a broke player was told "the default bet is -3 BezCoins" and only then
    // that they could not play. Cheapest possible fix: test affordability first.
    if (money < COINFLIP_RULES.MIN_MONEY) {
        return {
            code: "TOO_POOR",
            message:
                `you need at least ${COINFLIP_RULES.MIN_MONEY} coins to flip — ` +
                `a bet has to be ${COINFLIP_RULES.MIN_BET} or more and at most half of what you have`,
        };
    }
    if (!Number.isInteger(bet)) {
        return { code: "BAD_BET", message: "the bet has to be a whole number" };
    }
    if (bet < COINFLIP_RULES.MIN_BET) {
        return { code: "BET_TOO_LOW", message: `the smallest bet is ${COINFLIP_RULES.MIN_BET}` };
    }
    if (bet > maxBet(money)) {
        return {
            code: "BET_TOO_HIGH",
            message:
                `you cannot bet more than half your money — you have ${money}, ` +
                `so the most you can put up is ${maxBet(money)}`,
        };
    }
    return null;
}

/**
 * Flip it. PURE apart from `rng`, which is injected so the test can count 30,000 flips and
 * assert the brake really does move the odds — the only way to test a probability honestly.
 *
 * @param {object} input
 * @param {"head"|"tail"} input.guess
 * @param {number} input.money       balance BEFORE the bet — see the header
 * @param {number} input.bet
 * @param {number} [input.threshold]
 * @param {() => number} [input.rng]
 */
export function resolveFlip({ guess, money, bet, threshold = COINFLIP_RULES.HIGH_ROLLER_THRESHOLD, rng = Math.random }) {
    const list = chanceList(guess, money, threshold);
    const landed = list[Math.floor(rng() * list.length)];
    const won = landed === guess;
    const brake = describeBrake(guess, money, threshold);

    return {
        guess,
        landed,
        won,
        bet,
        /** Signed, so the caller never has to remember which way round it goes. */
        amount: won ? bet : -bet,
        brake,
        chance: winChance(guess, money, threshold),
        movements: [
            {
                discordId: null, // filled in by the cog; kept for parity with guess/ox settle()
                amount: won ? bet : -bet,
                reason: won ? "game_win" : "game_loss",
                note: won ? `called ${guess} and it landed ${landed}` : `called ${guess} but it landed ${landed}`,
            },
        ],
    };
}
