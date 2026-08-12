/**
 * app/data/dice.js — the dice game's rules.
 *
 * Ported from the legacy `dice` + `randing_dice` + `diceit`, `CsGamingBot.py:1295-1384` and
 * `:356-364`. His numbers, kept: **min 2 coins to play · bet 2–1000 and never more than you
 * have · default bet 10** · guess **even/odd/high/low** pays 1:1 · guess the **exact face**
 * and it pays **×3**.
 *
 * ⭐ HIGH IS `> 3`, so 4-5-6 are high and 1-2-3 are low — six faces split evenly, **no push
 * on any face**. Same for even/odd. Both of those bets are therefore exactly fair coin
 * flips with **zero house edge**, which is worth knowing before anyone tunes them.
 *
 * ⭐ THE ×3 IS PROFIT ON TOP OF THE STAKE, not a 3× return. His code:
 *
 *     money_add(ctx.author.id, int(bet) * 3)     # exact face
 *     money_add(ctx.author.id, bet)              # even/odd/high/low
 *     money_add(ctx.author.id, f"-{bet}")        # miss
 *
 * `money_add` ADDS, and the stake is never deducted up front, so a correct face leaves the
 * player **+3×bet** — four times their stake in hand. That is deliberate-looking rather
 * than a slip, because it makes the numbers work out:
 *
 *   | bet            | chance | pays  | EV per bet   |
 *   |----------------|--------|-------|--------------|
 *   | even/odd       | 1/2    | +1×   | **0**        |
 *   | high/low       | 1/2    | +1×   | **0**        |
 *   | exact face     | 1/6    | +3×   | **−bet/3**   |
 *
 * ⭐ So dice already contains the same **−1/3 house edge** as the coinflip high-roller brake,
 * except here it is charged on the long shot instead of on the rich — and a fair payout for
 * 1-in-6 would have been ×5. The safe bets are free and the greedy bet is taxed. That is a
 * coherent piece of design from a student project and it is kept as-is. (A true 3× *return*
 * would be **+2×** profit and EV −bet/2, i.e. strictly worse for the player, so "fixing" it
 * that way would take money away for the sake of tidier arithmetic.)
 *
 * ⭐ **YOU TYPE THE CALL, you do not pick it from a list.** Ote, 2026-08-13: *"plain chat
 * better ux"*. His parser accepted `e/even/คู่/คู`, `o/odd/คี่/คี`, `h/hi/high/สูง/ส`,
 * `l/lo/low/ต่ำ/ตำ่/ต` and any digit 1-6, and every one of those is ported below.
 *
 * ⭐ `ต่ำ` AND `ตำ่` are BOTH in his list, and that is not a typo in his code — it is a fix.
 * Thai stacks a tone mark and a vowel on the same consonant, and the two can be typed in
 * either order, producing different byte sequences that look identical on screen. He had
 * plainly watched a player's correct-looking guess get rejected and added the other ordering.
 * **Keeping both is the whole point**, so `parseGuess()` carries them verbatim rather than
 * trying to normalise Thai text — which is the kind of clever that breaks quietly.
 *
 * Everything here is PURE — no database, no Discord, no sleeping.
 */

/** His values. */
export const DICE_RULES = {
    MIN_MONEY: 2,
    MIN_BET: 2,
    MAX_BET: 1000,
    DEFAULT_BET: 10,
    FACES: 6,
    /** Profit multiplier for calling the exact face. His `int(bet) * 3`. */
    FACE_PAYOUT: 3,
    /** Profit multiplier for even/odd/high/low. His `money_add(bet)`. */
    EVEN_MONEY_PAYOUT: 1,
    /** How many frames his animation showed, and how long between them. */
    ANIMATION_FRAMES: 5,
    ANIMATION_INTERVAL_MS: 300,
};

/** The two either-or bets, plus the six faces, in the order they are offered. */
export const BET_KINDS = {
    EVEN: "even",
    ODD: "odd",
    HIGH: "high",
    LOW: "low",
};

/** His Thai wording, kept where the players see it. */
export const BET_LABEL = {
    even: "Even · เลขคู่",
    odd: "Odd · เลขคี่",
    high: "High · แต้มสูง (4-6)",
    low: "Low · แต้มต่ำ (1-3)",
};

export const FACE_EMOJI = ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

/**
 * His accepted spellings, verbatim from `CsGamingBot.py:1323-1338`. See the header on why
 * `ต่ำ` and `ตำ่` are both present and must stay that way.
 */
export const GUESS_ALIASES = {
    even: ["e", "even", "คู่", "คู"],
    odd: ["o", "odd", "คี่", "คี"],
    high: ["h", "hi", "high", "สูง", "ส"],
    low: ["l", "lo", "low", "ต่ำ", "ตำ่", "ต"],
};

/**
 * Read whatever the player typed: one of the four either-or bets, or a face 1-6.
 * Returns `"even"|"odd"|"high"|"low"`, a **number** 1-6, or null.
 *
 * ⚠️ Trimmed as well as lowercased, same reason as coinflip: his `guess.lower()` did not
 * trim, so a trailing space read as an invalid guess with no visible cause.
 *
 * ⚠️ FIXED — his `guess.isnumeric()` accepted Thai and Arabic-Indic digits and other
 * Unicode numerics that `int()` then happily parsed, so `๓` was a legal guess in a game
 * whose dice showed `3`. The regex here is ASCII 1-6 only, which is what the dice actually
 * has faces for.
 */
export function parseGuess(input) {
    if (typeof input !== "string") return null;
    const cleaned = input.trim().toLowerCase();
    if (cleaned === "") return null;

    if (/^[1-6]$/.test(cleaned)) return Number(cleaned);

    for (const [kind, aliases] of Object.entries(GUESS_ALIASES)) {
        if (aliases.includes(cleaned)) return kind;
    }
    return null;
}

/** What to tell someone whose guess did not parse — his accepted forms, not a shrug. */
export function acceptedGuesses() {
    return [
        `**even** — ${GUESS_ALIASES.even.join(" / ")}`,
        `**odd** — ${GUESS_ALIASES.odd.join(" / ")}`,
        `**high** (4-6) — ${GUESS_ALIASES.high.join(" / ")}`,
        `**low** (1-3) — ${GUESS_ALIASES.low.join(" / ")}`,
        `**a face** — 1 2 3 4 5 6, pays ×${DICE_RULES.FACE_PAYOUT}`,
    ].join("\n");
}

/**
 * What a face is — his `diceit()`, which returned `(str(face), is_high, is_even)`.
 * `> 3` is high, `% 2 == 0` is even. Three of each, so no face is a push.
 */
export function faceTraits(face) {
    return {
        face,
        highLow: face > 3 ? BET_KINDS.HIGH : BET_KINDS.LOW,
        evenOdd: face % 2 === 0 ? BET_KINDS.EVEN : BET_KINDS.ODD,
    };
}

/** Roll one. `rng` is injected so the test can roll 60,000 times and check the distribution. */
export function roll(rng = Math.random) {
    return 1 + Math.floor(rng() * DICE_RULES.FACES);
}

/** Frames for his 5-step reveal animation — random faces, then the real one last. */
export function animationFaces(finalFace, rng = Math.random) {
    const frames = [];
    for (let i = 0; i < DICE_RULES.ANIMATION_FRAMES - 1; i += 1) frames.push(roll(rng));
    frames.push(finalFace);
    return frames;
}

/** Is this guess a face number rather than even/odd/high/low? */
export function isFaceBet(guess) {
    return Number.isInteger(guess) || /^[1-6]$/.test(String(guess));
}

/** Why a roll cannot happen. Returns null when it can. */
export function validateBet({ money, bet }) {
    // ⚠️ ORDER FIXED, same slip as coinflip: his code announced the default bet before
    // checking that the player could afford to play at all.
    if (money < DICE_RULES.MIN_MONEY) {
        return {
            code: "TOO_POOR",
            message: `you need at least ${DICE_RULES.MIN_MONEY} coins to roll`,
        };
    }
    if (!Number.isInteger(bet)) {
        return { code: "BAD_BET", message: "the bet has to be a whole number" };
    }
    if (bet < DICE_RULES.MIN_BET) {
        return { code: "BET_TOO_LOW", message: `the smallest bet is ${DICE_RULES.MIN_BET}` };
    }
    if (bet > DICE_RULES.MAX_BET) {
        return { code: "BET_TOO_HIGH", message: `the biggest bet is ${DICE_RULES.MAX_BET}` };
    }
    if (bet > money) {
        return {
            code: "CANNOT_AFFORD",
            message: `you have ${money}, which will not cover a bet of ${bet}`,
        };
    }
    return null;
}

/**
 * Settle a roll. PURE.
 *
 * ⚠️ FIXED — a real bug in his version. `dice` computed the face ONCE at the top
 * (`answer_high_even = diceit()`), then `randing_dice` called `diceit()` AGAIN for every
 * animation frame. That was harmless for the animation, but the win check and the animated
 * reveal read from different sources, so the only thing keeping them honest was that he
 * passed `answer` through and re-displayed it on the final frame. Here the face is rolled
 * once, settled once, and the animation is handed the frames to show — the number that pays
 * is the number the player watched land.
 *
 * @param {object} input
 * @param {"even"|"odd"|"high"|"low"|number} input.guess
 * @param {number} input.face   1-6, already rolled
 * @param {number} input.bet
 */
export function resolveDice({ guess, face, bet }) {
    const traits = faceTraits(face);
    const faceBet = isFaceBet(guess);
    const guessedFace = faceBet ? Number(guess) : null;

    const won = faceBet
        ? guessedFace === face
        : guess === traits.highLow || guess === traits.evenOdd;

    const multiplier = faceBet ? DICE_RULES.FACE_PAYOUT : DICE_RULES.EVEN_MONEY_PAYOUT;
    const amount = won ? bet * multiplier : -bet;

    return {
        guess,
        face,
        traits,
        won,
        bet,
        faceBet,
        multiplier,
        amount,
        /** The real odds of what they just bet on, so the cog can show them. */
        chance: faceBet ? 1 / DICE_RULES.FACES : 1 / 2,
        movements: [
            {
                discordId: null, // filled in by the cog; parity with guess/ox settle()
                amount,
                reason: won ? "game_win" : "game_loss",
                note: won
                    ? `called ${guess} and rolled ${face} — ×${multiplier}`
                    : `called ${guess} but rolled ${face} (${traits.highLow}, ${traits.evenOdd})`,
            },
        ],
    };
}
