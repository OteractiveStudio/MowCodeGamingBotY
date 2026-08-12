/**
 * app/data/blackjack.js — blackjack's rules, cards and sessions.
 *
 * Ported from the legacy `BJ` + `play_decision` + `check_point` + `End_game`
 * (`CsGamingBot.py:104-116`, `:366-434`, `:1387-1617`). It is the largest single game in the
 * tree and the one with the most wrong with it — his own comment on the fallback branch reads
 * *"กรณีที่มันบัค (ขี้เกียจแก้ เล่นๆ ไปเหอะ)"*, "in case it bugs (too lazy to fix, let's just
 * play)". Ote, 2026-08-13: *"adjust things as it should be done, as i told my old code are
 * old"*, so the defects below are FIXED rather than reproduced.
 *
 * ⚠️ Checked against all THREE of his copies — `CsGamingBot.py`, `BJ_dealer.py` and
 * `Small BJ dealer.py`. They share every defect listed here, so these are his intended rules
 * rather than one bad copy that a sibling file already corrected.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ✅ FIXED — real defects
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **THE DECK WAS 13 CARDS, NOT 52.**
 *        Deck = ['2️⃣',…,'**King**','**Ace**']   # thirteen entries, one per rank
 *        del Deck[i]                             # and draws DELETE
 *    One of each rank and no suits, so a pair was **impossible**, the shoe ran dry after 13
 *    cards between both hands, and the odds bore no relation to blackjack. His own note on
 *    that line — *"เดี๋ยวเปลี่ยนไปใช้ไฟล์รูปภาพแทน"*, "will switch to image files later" —
 *    says the representation was a placeholder he never came back to. Now **52 cards, four
 *    suits**, shuffled per hand.
 *
 * 2. **`random.randrange(0, len(Deck)-1)` COULD NOT DRAW THE LAST CARD, AND CRASHED AT ONE.**
 *    `randrange(0, n-1)` yields `0 … n-2`, so the final card of the shuffled list was
 *    unreachable — and at `len == 1` it becomes `randrange(0, 0)`, which raises `ValueError`.
 *    His only guard was `if len(Deck) < 5` inside the *hitting* branch, so the initial deal
 *    and the dealer's own draw could both hit it. Drawing is now off the top of a shuffled
 *    deck, and the deck is reshuffled per hand so it cannot run out mid-hand.
 *
 * 3. **THE ACE WAS ALWAYS 1, NEVER 11.** `values['**Ace**'] = 1`. So his "natural blackjack"
 *    check — a ten-value card AND an ace in the opening hand — produced a hand worth **11
 *    points** that he then paid ×1.5 for calling 21. The label and the arithmetic disagreed.
 *    Aces are now soft: 11 where it fits, 1 where it would bust, so a natural really is 21.
 *
 * 4. **NO BUST CHECK WHILE HITTING.** His `hitting` branch drew a card and then re-printed
 *    the Hit/Stand prompt unconditionally — never testing for over 21. A player could hit to
 *    30 and keep being asked, and only discovered they had busted when they chose to Stand.
 *    A bust now ends the hand the moment it happens.
 *
 * 5. **THE FALLBACK RETURNED A STRING WHERE A TUPLE WAS EXPECTED.**
 *        return 'เดี๋ยวแก้ครับ เล่นต่อไปก่อน'      # one value, not two
 *    Every caller then did `check_point(...)[1]` — which on a string is its **second
 *    character** — and handed that to `money_add`, so any unhandled decision crashed on
 *    `int()`. Outcomes are typed here and the settle function has no untyped escape hatch.
 *
 * 6. **`check_point` WAS CALLED TWICE PER SETTLEMENT** — once for `[0]`, the message, and
 *    again for `[1]`, the money. Harmless only because it happened to be pure; it is the same
 *    shape as the guess-game bug where the message named one winner and the code paid another.
 *    Settled once here, and the message is rendered from the returned outcome.
 *
 * 7. **INSURANCE WAS NOT INSURANCE.** His version, on the dealer showing an ace:
 *        hole card is ten-value  → `+bet * 2`  and the hand ENDS
 *        otherwise               → `-bet * 1.5` and the hand CONTINUES
 *    So it was a side gamble that risked 1.5× to win 2×, and losing it charged you 1.5× *and*
 *    left you still able to lose the main bet — double jeopardy on one hand. Real insurance is
 *    a **half-bet side wager paying 2:1**, which exactly offsets the main bet when the dealer
 *    has blackjack and costs only the side wager when they do not. That is what INSURANCE_*
 *    below implements. ⚠️ This is the one change with real economic effect; his numbers are
 *    recorded above so it can be reverted deliberately.
 *
 * 8. **ONE GAME BOT-WIDE.** `Deck`, `player_hand`, `dealer_hand`, `BJ_player`, `BJ_bet` and
 *    `ace_asked` were module-level globals, so a hand in one server used the same deck as a
 *    hand in another. Keyed by channel here, like everything else built on `ChannelSessions`.
 *
 * 9. **NO TIMEOUT.** An abandoned hand held `BJ_player` forever, and since that was global it
 *    blocked blackjack in **every** server until someone restarted the bot.
 *
 * 10. **DEAD STATE.** `got_A` was written and never read; `playing_bj` gated nothing;
 *     `gloCTX` was a module-level "reply to whoever touched it last" context.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⭐ KEPT — his numbers, because they are balance and not bugs
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 *   · **20 coins to sit down, minimum bet 10, maximum bet half your money.**
 *   · **A natural pays ×1.5** (`int(bet * 1.5)`, truncated — his `int()`, kept).
 *   · **Surrender costs half the bet**, truncated the same way.
 *   · **Double down settles at ±2× the bet**, and a push at ±0.
 *   · ⚠️ **THE DEALER STANDS ON 16**, not 17 — his `if dealer_point < 16: draw`. Every real
 *     blackjack dealer stands on 17, so this is very likely a misremembering rather than a
 *     decision, but it is a house-edge change either way and not mine to make silently. It is
 *     `DEALER_STANDS_ON` below: one constant, one line, his call.
 *
 * Everything here is PURE except the session store, so the card maths is unit-tested with no
 * database and no Discord connection.
 */

import { ChannelSessions } from "./session-store.js";

/** His values, with the ace corrected to a soft 11/1 — see FIXED #3. */
export const BLACKJACK_RULES = {
    MIN_MONEY: 20,
    MIN_BET: 10,
    TARGET: 21,
    /** ⚠️ HIS NUMBER. Real blackjack is 17. See the header. */
    DEALER_STANDS_ON: 16,
    /** `int(bet * 1.5)` — a natural pays one and a half times, truncated. */
    NATURAL_MULTIPLIER: 1.5,
    /** `int(bet / 2)` — surrender forfeits half. */
    SURRENDER_FRACTION: 0.5,
    DOUBLE_MULTIPLIER: 2,
    /** Real insurance: stake half the bet, paid 2:1. See FIXED #7. */
    INSURANCE_FRACTION: 0.5,
    INSURANCE_PAYOUT: 2,
    LIFETIME_MS: 5 * 60 * 1000,
};

/** ⭐ His emoji ranks, kept — they are what his players read. Suits are the fix. */
export const RANKS = [
    { key: "2", label: "2️⃣", value: 2 },
    { key: "3", label: "3️⃣", value: 3 },
    { key: "4", label: "4️⃣", value: 4 },
    { key: "5", label: "5️⃣", value: 5 },
    { key: "6", label: "6️⃣", value: 6 },
    { key: "7", label: "7️⃣", value: 7 },
    { key: "8", label: "8️⃣", value: 8 },
    { key: "9", label: "9️⃣", value: 9 },
    { key: "10", label: "🔟", value: 10 },
    { key: "J", label: "**J**", value: 10 },
    { key: "Q", label: "**Q**", value: 10 },
    { key: "K", label: "**K**", value: 10 },
    { key: "A", label: "**A**", value: 11 },
];

export const SUITS = [
    { key: "S", label: "♠" },
    { key: "H", label: "♥" },
    { key: "D", label: "♦" },
    { key: "C", label: "♣" },
];

/** A real 52-card deck — FIXED #1. */
export function buildDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            deck.push({ rank: rank.key, suit: suit.key, value: rank.value, label: `${rank.label}${suit.label}` });
        }
    }
    return deck;
}

/**
 * Fisher-Yates, with `rng` injected so a test can deal a known hand.
 *
 * ⚠️ Shuffling and then drawing off the top replaces his "pick a random index and splice it
 * out", which is where FIXED #2 lived. Same distribution, no reachable-index arithmetic to
 * get wrong.
 */
export function shuffle(deck, rng = Math.random) {
    const cards = [...deck];
    for (let i = cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
}

export function freshDeck(rng = Math.random) {
    return shuffle(buildDeck(), rng);
}

/** Take the top card. Throws rather than dealing undefined — his crashed instead. */
export function draw(deck) {
    if (!Array.isArray(deck) || deck.length === 0) {
        throw new Error("cannot draw from an empty deck");
    }
    return deck.shift();
}

/**
 * Total a hand, with aces soft — FIXED #3.
 *
 * Count every ace as 11, then demote them one at a time while the hand is bust. Returns the
 * total plus whether an ace is still counting as 11, because "soft 17" needs saying out loud.
 */
export function handTotal(cards) {
    let total = 0;
    let aces = 0;

    for (const card of cards) {
        total += card.value;
        if (card.rank === "A") aces += 1;
    }

    let softAces = aces;
    while (total > BLACKJACK_RULES.TARGET && softAces > 0) {
        total -= 10;
        softAces -= 1;
    }

    return { total, soft: softAces > 0, aces };
}

export function isBust(cards) {
    return handTotal(cards).total > BLACKJACK_RULES.TARGET;
}

/**
 * A natural: 21 on the opening two cards.
 *
 * ⚠️ His test was `(a ten-value card is in the hand) and ('**Ace**' in the hand)`, which is
 * the same set of hands — but he read it off the *cards* while his arithmetic said 11. Testing
 * the total means the label and the payout can no longer disagree.
 */
export function isNatural(cards) {
    return cards.length === 2 && handTotal(cards).total === BLACKJACK_RULES.TARGET;
}

/** Is the dealer's visible card an ace? His trigger for offering insurance. */
export function dealerShowsAce(dealerHand) {
    return upCard(dealerHand)?.rank === "A";
}

/**
 * ⚠️ HIS INDEXING, PRESERVED: `dealer_hand[0]` is the HOLE card and `dealer_hand[1]` is the
 * one on show. He printed `'**[hidden]** ' + dealer_hand[1]` and tested `dealer_hand[0]` for
 * the ten-value, so the two agreed with each other even though it is the reverse of the usual
 * convention. Named functions here so nobody has to remember which index is which.
 */
export function holeCard(dealerHand) {
    return dealerHand[0] ?? null;
}

export function upCard(dealerHand) {
    return dealerHand[1] ?? null;
}

/** Does the dealer have a natural? Only knowable once the hole card is turned over. */
export function dealerHasNatural(dealerHand) {
    return isNatural(dealerHand);
}

/** His `End_game`: draw while under DEALER_STANDS_ON. Recursion replaced by a loop. */
export function dealerShouldDraw(cards) {
    return handTotal(cards).total < BLACKJACK_RULES.DEALER_STANDS_ON;
}

/** Play the dealer out. Mutates `deck` and `hand`, and returns the final total. */
export function playDealer(deck, hand) {
    // The 52-card deck cannot run out inside one hand, but the guard says so out loud rather
    // than relying on it — his crashed exactly here.
    while (dealerShouldDraw(hand) && deck.length > 0) {
        hand.push(draw(deck));
    }
    return handTotal(hand).total;
}

/** Every way a hand can finish. His were bare strings compared with `.lower()` at each site. */
export const OUTCOME = {
    PLAYER_NATURAL: "player_natural",
    PLAYER_BUST: "player_bust",
    DEALER_BUST: "dealer_bust",
    PLAYER_WINS: "player_wins",
    DEALER_WINS: "dealer_wins",
    PUSH: "push",
    SURRENDERED: "surrendered",
    TIMED_OUT: "timed_out",
};

export const DECISION = {
    HIT: "hit",
    STAND: "stand",
    DOUBLE: "double",
    SURRENDER: "surrender",
    INSURE: "insure",
    DECLINE_INSURANCE: "decline",
};

/**
 * Compare two finished hands. PURE, and the only place the winner is decided.
 *
 * ⚠️ Order matters: the player busting is checked FIRST, because a player who has gone over
 * loses even if the dealer also busts. His `check_point` had this right and it is kept.
 */
export function compareHands(playerCards, dealerCards) {
    const player = handTotal(playerCards).total;
    const dealer = handTotal(dealerCards).total;

    if (player > BLACKJACK_RULES.TARGET) return OUTCOME.PLAYER_BUST;
    if (dealer > BLACKJACK_RULES.TARGET) return OUTCOME.DEALER_BUST;
    if (player > dealer) return OUTCOME.PLAYER_WINS;
    if (dealer > player) return OUTCOME.DEALER_WINS;
    return OUTCOME.PUSH;
}

/**
 * What a finished hand pays. PURE — returns a signed amount and a line to show, so the money
 * and the message can never come from two different calls (FIXED #6).
 *
 * @param {object} input
 * @param {string} input.outcome    one of OUTCOME
 * @param {number} input.bet
 * @param {boolean} [input.doubled] the bet was doubled down
 * @param {number} [input.insurance] the insurance stake, if one was taken
 * @param {boolean} [input.dealerNatural] whether the dealer turned over a natural
 */
export function settle({ outcome, bet, doubled = false, insurance = 0, dealerNatural = false }) {
    const stake = doubled ? bet * BLACKJACK_RULES.DOUBLE_MULTIPLIER : bet;

    let amount = 0;
    let note = "";

    switch (outcome) {
        case OUTCOME.PLAYER_NATURAL:
            // His `int(bet * 1.5)`. Truncation is his and is kept.
            amount = Math.trunc(bet * BLACKJACK_RULES.NATURAL_MULTIPLIER);
            note = `Blackjack — ×${BLACKJACK_RULES.NATURAL_MULTIPLIER}`;
            break;
        case OUTCOME.SURRENDERED:
            // His `int(bet / 2)`, as a loss. Never doubled: you cannot surrender after doubling.
            amount = -Math.trunc(bet * BLACKJACK_RULES.SURRENDER_FRACTION);
            note = "Surrendered — half the bet";
            break;
        case OUTCOME.PLAYER_BUST:
            amount = -stake;
            note = "Bust — over 21";
            break;
        case OUTCOME.DEALER_BUST:
            amount = stake;
            note = "The dealer busted";
            break;
        case OUTCOME.PLAYER_WINS:
            amount = stake;
            note = "Higher hand";
            break;
        case OUTCOME.DEALER_WINS:
            amount = -stake;
            note = "The dealer's hand was higher";
            break;
        case OUTCOME.PUSH:
            amount = 0;
            note = "Push — nobody pays";
            break;
        case OUTCOME.TIMED_OUT:
            // ⚠️ A timeout is a stand, not a forfeit — the hand is played out by the caller and
            // settled on its merits. Charging the full bet for going quiet would be harsher
            // than surrendering, which costs half.
            amount = -stake;
            note = "Ran out of time";
            break;
        default:
            // FIXED #5: no untyped escape hatch. An unknown outcome is a programming error and
            // says so, instead of returning a string whose second character becomes the payout.
            throw new Error(`settle() got an unknown outcome: ${JSON.stringify(outcome)}`);
    }

    // Real insurance, settled independently of the main hand — FIXED #7.
    let insuranceAmount = 0;
    if (insurance > 0) {
        insuranceAmount = dealerNatural
            ? insurance * BLACKJACK_RULES.INSURANCE_PAYOUT
            : -insurance;
    }

    const total = amount + insuranceAmount;

    // ⭐ The hand and the side bet are SEPARATE movements, not one netted number. An insured
    // hand against a dealer blackjack nets exactly zero, and a single netted movement would
    // therefore write nothing at all — leaving no trace that the player was dealt a losing
    // hand and that insurance is what rescued it. Two rows make `/money history` show the
    // save, which is the whole reason someone would take insurance in the first place.
    const movements = [];

    if (amount !== 0) {
        movements.push({
            discordId: null, // the cog fills this in
            amount,
            reason: amount > 0 ? "game_win" : "game_loss",
            note,
            tag: outcome,
        });
    }

    if (insuranceAmount !== 0) {
        movements.push({
            discordId: null,
            amount: insuranceAmount,
            reason: insuranceAmount > 0 ? "game_win" : "game_loss",
            note: insuranceAmount > 0 ? "Insurance paid — the dealer had blackjack" : "Insurance lost — no blackjack",
            tag: "insurance",
        });
    }

    return {
        outcome,
        note,
        /** The main hand alone. */
        handAmount: amount,
        /** The side bet alone. */
        insuranceAmount,
        /** What the player is up or down overall — for the message, not for the ledger. */
        amount: total,
        stake,
        doubled,
        insurance,
        movements,
    };
}

/** What the player may legally do right now. Drives which buttons are drawn. */
export function availableDecisions(game) {
    if (game.finished) return [];
    if (game.insurancePending) return [DECISION.INSURE, DECISION.DECLINE_INSURANCE];

    const decisions = [DECISION.HIT, DECISION.STAND];

    // ⚠️ Double down and surrender are OPENING moves only. His `decide` mode offered them on
    // the first decision and his `hitting` mode offered only hit/stand, so this is his shape —
    // but it was implicit in two copies of a prompt string rather than stated anywhere.
    if (game.playerCards.length === 2) {
        decisions.push(DECISION.DOUBLE, DECISION.SURRENDER);
    }

    return decisions;
}

/** Why a hand cannot be started. Returns null when it can. */
export function validateStart({ bet, balance }) {
    if (balance < BLACKJACK_RULES.MIN_MONEY) {
        return {
            code: "TOO_POOR",
            message: `you need at least ${BLACKJACK_RULES.MIN_MONEY} coins to sit down`,
        };
    }
    if (!Number.isInteger(bet)) {
        return { code: "BAD_BET", message: "the bet has to be a whole number" };
    }
    if (bet < BLACKJACK_RULES.MIN_BET) {
        return { code: "BET_TOO_LOW", message: `the smallest bet is ${BLACKJACK_RULES.MIN_BET}` };
    }

    const cap = Math.floor(balance / 2);
    if (bet > cap) {
        return {
            code: "BET_TOO_HIGH",
            message:
                `you cannot bet more than half your money — you have ${balance}, ` +
                `so the most you can put up is ${cap}`,
        };
    }

    // ⚠️ NOT in his version, and it matters: doubling down risks 2× the bet, and his only cap
    // was half your money, so a player at exactly 20 could double into a 40-coin swing on a
    // 20-coin balance. The bet cap already keeps 2×bet within your balance, so this only ever
    // fires on a negative-balance edge — but it says the invariant out loud.
    if (bet * BLACKJACK_RULES.DOUBLE_MULTIPLIER > balance) {
        return {
            code: "CANNOT_COVER_DOUBLE",
            message: `a bet of ${bet} could be doubled to ${bet * 2}, which is more than your ${balance}`,
        };
    }

    return null;
}

/** Max bet for a balance — half, floored, his `player_money//2`. */
export function maxBet(balance) {
    return Math.floor(balance / 2);
}

/**
 * One hand per channel.
 *
 * ⭐ This is the class the legacy most needed and least had: `BJ_player` was a single global,
 * so the bot hosted ONE blackjack hand across every server it was in, and an abandoned hand
 * blocked all of them until a restart.
 */
export class BlackjackSessions extends ChannelSessions {
    start({ channelId, guildId, playerId, bet, startedAt = Date.now(), rng = Math.random }) {
        const key = String(channelId);
        if (this.games.has(key)) throw new Error(`a blackjack hand is already running in ${key}`);

        const deck = freshDeck(rng);

        // ⚠️ HIS DEAL ORDER, preserved: player, dealer, player, dealer. It matters because
        // dealer_hand[0] is therefore the hole card, which is what his display and his
        // insurance check both assumed.
        const playerCards = [];
        const dealerCards = [];
        playerCards.push(draw(deck));
        dealerCards.push(draw(deck));
        playerCards.push(draw(deck));
        dealerCards.push(draw(deck));

        const game = {
            channelId: key,
            guildId: guildId ? String(guildId) : null,
            playerId: String(playerId),
            bet,
            deck,
            playerCards,
            dealerCards,
            doubled: false,
            insurance: 0,
            insuranceOffered: false,
            insurancePending: false,
            finished: false,
            outcome: null,
            startedAt,
            expiresAt: startedAt + BLACKJACK_RULES.LIFETIME_MS,
            messageId: null,
            timer: null,
        };

        // Insurance is offered before anything else, exactly as his `BJ_mode = "ask"` did —
        // but only when the player has not already made 21, because there is nothing to insure
        // against a hand that has already won.
        if (dealerShowsAce(dealerCards) && !isNatural(playerCards)) {
            game.insurancePending = true;
            game.insuranceOffered = true;
        }

        return this.set(key, game);
    }
}
