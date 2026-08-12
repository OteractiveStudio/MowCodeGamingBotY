/**
 * Unit: blackjack's cards, totals and payouts.
 *
 * Most of these exist because a specific line in his version was wrong. Each one names the
 * defect it guards, so a later "simplification" that reintroduces it fails with a reason
 * attached rather than just a red line.
 */

import assert from "node:assert/strict";

import {
    BLACKJACK_RULES,
    BlackjackSessions,
    DECISION,
    OUTCOME,
    RANKS,
    SUITS,
    availableDecisions,
    buildDeck,
    compareHands,
    dealerHasNatural,
    dealerShouldDraw,
    dealerShowsAce,
    draw,
    freshDeck,
    handTotal,
    holeCard,
    isBust,
    isNatural,
    maxBet,
    playDealer,
    settle,
    shuffle,
    upCard,
    validateStart,
} from "../../app/data/blackjack.js";

/** Build a hand from rank keys, so a test can read like a dealt hand. */
function hand(...ranks) {
    return ranks.map((rank) => {
        const found = RANKS.find((r) => r.key === rank);
        if (!found) throw new Error(`no such rank: ${rank}`);
        return { rank: found.key, suit: "S", value: found.value, label: found.label };
    });
}

export default [
    // ── FIXED #1: the deck ───────────────────────────────────────────────────
    {
        label: "🔑 FIXED — the deck is 52 cards with suits, not his 13 one-per-rank",
        fn: () => {
            const deck = buildDeck();
            assert.equal(deck.length, 52, "his deck had 13 entries and no suits");
            assert.equal(RANKS.length, 13);
            assert.equal(SUITS.length, 4);

            // Every rank appears exactly four times — so a PAIR is possible, which it was not
            // in his version.
            for (const rank of RANKS) {
                const count = deck.filter((card) => card.rank === rank.key).length;
                assert.equal(count, 4, `${rank.key} appears ${count} times, should be 4`);
            }

            // Every card is distinct.
            const ids = new Set(deck.map((card) => `${card.rank}${card.suit}`));
            assert.equal(ids.size, 52, "duplicate cards in the deck");
        },
    },
    {
        label: "a shuffle keeps every card — it permutes, it does not lose or invent",
        fn: () => {
            const before = buildDeck();
            const after = shuffle(before);
            assert.equal(after.length, 52);
            assert.notEqual(before, after, "shuffle must not return the same array reference");

            const key = (card) => `${card.rank}${card.suit}`;
            assert.deepEqual(after.map(key).sort(), before.map(key).sort());

            // And the original is untouched, so a caller cannot be surprised.
            assert.deepEqual(before.map(key), buildDeck().map(key));
        },
    },

    // ── FIXED #2: the draw ───────────────────────────────────────────────────
    {
        label: "🔑 FIXED — EVERY card is reachable, including the last one",
        fn: () => {
            // His `randrange(0, len(Deck)-1)` yields 0..n-2, so the final card of the shuffled
            // list could never be picked. Drawing off the top reaches all 52.
            const deck = buildDeck();
            const drawn = [];
            const size = deck.length;
            for (let i = 0; i < size; i += 1) drawn.push(draw(deck));

            assert.equal(drawn.length, 52, "should be able to draw the whole deck");
            assert.equal(deck.length, 0);
            assert.equal(new Set(drawn.map((c) => `${c.rank}${c.suit}`)).size, 52);
        },
    },
    {
        label: "🔑 FIXED — drawing from an empty deck throws instead of crashing on ValueError",
        fn: () => {
            // His `randrange(0, 0)` at len == 1 raised ValueError from inside the draw helper,
            // with the only guard being `if len(Deck) < 5` in one branch of one mode.
            assert.throws(() => draw([]), /empty deck/);
            assert.throws(() => draw(null), /empty deck/);
        },
    },

    // ── FIXED #3: soft aces ──────────────────────────────────────────────────
    {
        label: "🔑 FIXED — an ace is 11 where it fits and 1 where it would bust",
        fn: () => {
            // His values dict had '**Ace**': 1, always.
            assert.equal(handTotal(hand("A")).total, 11);
            assert.equal(handTotal(hand("A", "9")).total, 20);
            assert.equal(handTotal(hand("A", "K")).total, 21);

            // Demoted when it has to be.
            assert.equal(handTotal(hand("A", "K", "5")).total, 16, "ace must drop to 1");
            assert.equal(handTotal(hand("A", "A", "9")).total, 21, "one ace 11, one ace 1");
            assert.equal(handTotal(hand("A", "A", "A", "8")).total, 21);
            assert.equal(handTotal(hand("A", "A", "K", "9")).total, 21);
        },
    },
    {
        label: "a hand knows whether it is SOFT — 'soft 17' has to be sayable",
        fn: () => {
            assert.equal(handTotal(hand("A", "6")).soft, true);
            assert.equal(handTotal(hand("A", "6", "K")).soft, false, "the ace was demoted, so it is hard");
            assert.equal(handTotal(hand("9", "8")).soft, false);
        },
    },
    {
        label: "🔑 FIXED — a natural really is 21, so the label and the payout agree",
        fn: () => {
            // His check was "a ten-value card AND an ace are in the hand", which selected the
            // right hands but scored them 11 because the ace was worth 1 — then paid ×1.5 for
            // "blackjack". Testing the total makes those the same statement.
            assert.equal(isNatural(hand("A", "K")), true);
            assert.equal(handTotal(hand("A", "K")).total, 21);
            assert.equal(isNatural(hand("A", "10")), true);
            assert.equal(isNatural(hand("A", "Q")), true);

            // 21 on three cards is NOT a natural.
            assert.equal(isNatural(hand("7", "7", "7")), false);
            assert.equal(handTotal(hand("7", "7", "7")).total, 21);
            // Two cards that are not 21.
            assert.equal(isNatural(hand("K", "9")), false);
        },
    },

    // ── his dealer rule, kept ────────────────────────────────────────────────
    {
        label: "⚠️ HIS NUMBER KEPT — the dealer stands on 16, where real blackjack stands on 17",
        fn: () => {
            assert.equal(BLACKJACK_RULES.DEALER_STANDS_ON, 16);
            assert.equal(dealerShouldDraw(hand("9", "6")), true, "15 draws");
            assert.equal(dealerShouldDraw(hand("K", "6")), false, "16 stands — his rule, not 17");
            assert.equal(dealerShouldDraw(hand("K", "7")), false, "17 stands");
        },
    },
    {
        label: "the dealer plays out to at least 16 and stops",
        fn: () => {
            for (let i = 0; i < 500; i += 1) {
                const deck = freshDeck();
                const dealerHand = [draw(deck), draw(deck)];
                const total = playDealer(deck, dealerHand);
                assert.equal(total, handTotal(dealerHand).total);
                assert.ok(
                    total >= BLACKJACK_RULES.DEALER_STANDS_ON || total > BLACKJACK_RULES.TARGET,
                    `dealer stopped at ${total}`,
                );
            }
        },
    },
    {
        label: "the dealer cannot run out of cards mid-hand — his 13-card deck could",
        fn: () => {
            const deck = freshDeck();
            const dealerHand = [draw(deck), draw(deck)];
            playDealer(deck, dealerHand);
            assert.ok(deck.length > 0, "a 52-card deck must survive one dealer hand");
        },
    },

    // ── his hole-card indexing ───────────────────────────────────────────────
    {
        label: "⚠️ HIS INDEXING KEPT — hand[0] is the HOLE card, hand[1] is the one on show",
        fn: () => {
            // He printed '**[hidden]** ' + dealer_hand[1] and tested dealer_hand[0] for the
            // ten-value, so the two agreed even though it is the reverse of the usual order.
            const dealer = hand("K", "A");
            assert.equal(holeCard(dealer).rank, "K");
            assert.equal(upCard(dealer).rank, "A");
            assert.equal(dealerShowsAce(dealer), true, "the ACE is the visible card here");
            assert.equal(dealerHasNatural(dealer), true, "K hole + A up is 21");
        },
    },

    // ── comparing hands ─────────────────────────────────────────────────────
    {
        label: "🔑 a player bust loses even when the dealer busts too — order matters",
        fn: () => {
            assert.equal(compareHands(hand("K", "Q", "5"), hand("K", "Q", "5")), OUTCOME.PLAYER_BUST);
        },
    },
    {
        label: "the rest of the comparison table",
        fn: () => {
            assert.equal(compareHands(hand("K", "9"), hand("K", "Q", "5")), OUTCOME.DEALER_BUST);
            assert.equal(compareHands(hand("K", "9"), hand("K", "7")), OUTCOME.PLAYER_WINS);
            assert.equal(compareHands(hand("K", "7"), hand("K", "9")), OUTCOME.DEALER_WINS);
            assert.equal(compareHands(hand("K", "8"), hand("K", "8")), OUTCOME.PUSH);
        },
    },
    {
        label: "21 is not a bust, 22 is",
        fn: () => {
            assert.equal(isBust(hand("7", "7", "7")), false);
            assert.equal(isBust(hand("K", "Q", "2")), true);
        },
    },

    // ── his payouts, kept ────────────────────────────────────────────────────
    {
        label: "⭐ HIS PAYOUTS KEPT — natural ×1.5 truncated, surrender half, double ±2×, push 0",
        fn: () => {
            // int(bet * 1.5) — his truncation, on a bet that does not divide evenly.
            assert.equal(settle({ outcome: OUTCOME.PLAYER_NATURAL, bet: 15 }).amount, 22);
            assert.equal(settle({ outcome: OUTCOME.PLAYER_NATURAL, bet: 10 }).amount, 15);

            // int(bet / 2) as a loss.
            assert.equal(settle({ outcome: OUTCOME.SURRENDERED, bet: 15 }).amount, -7);
            assert.equal(settle({ outcome: OUTCOME.SURRENDERED, bet: 10 }).amount, -5);

            // Double down settles at twice the stake, either way.
            assert.equal(settle({ outcome: OUTCOME.PLAYER_WINS, bet: 10, doubled: true }).amount, 20);
            assert.equal(settle({ outcome: OUTCOME.PLAYER_BUST, bet: 10, doubled: true }).amount, -20);

            // A push moves nothing, and writes no ledger row at all.
            const push = settle({ outcome: OUTCOME.PUSH, bet: 10 });
            assert.equal(push.amount, 0);
            assert.deepEqual(push.movements, [], "a push must not write a zero-value ledger row");
        },
    },
    {
        label: "🔑 the hand and the side bet are SEPARATE movements, so a wash is still visible",
        fn: () => {
            // Netting them into one number would write NOTHING for an insured hand against a
            // dealer blackjack — hiding the fact that insurance is what rescued it.
            const covered = settle({
                outcome: OUTCOME.DEALER_WINS,
                bet: 10,
                insurance: 5,
                dealerNatural: true,
            });
            assert.equal(covered.amount, 0, "nets to zero overall");
            assert.equal(covered.movements.length, 2, "but must still leave two ledger rows");

            const byTag = Object.fromEntries(covered.movements.map((m) => [m.tag, m]));
            assert.equal(byTag[OUTCOME.DEALER_WINS].amount, -10);
            assert.equal(byTag[OUTCOME.DEALER_WINS].reason, "game_loss");
            assert.equal(byTag.insurance.amount, 10);
            assert.equal(byTag.insurance.reason, "game_win");

            // And the movements always sum to the headline figure.
            const sum = covered.movements.reduce((t, m) => t + m.amount, 0);
            assert.equal(sum, covered.amount);
        },
    },
    {
        label: "an uninsured hand writes exactly one movement",
        fn: () => {
            const plain = settle({ outcome: OUTCOME.PLAYER_WINS, bet: 10 });
            assert.equal(plain.movements.length, 1);
            assert.equal(plain.movements[0].tag, OUTCOME.PLAYER_WINS);
            assert.equal(plain.movements.reduce((t, m) => t + m.amount, 0), plain.amount);
        },
    },
    {
        label: "an ordinary win or loss is exactly the bet, and names the right ledger reason",
        fn: () => {
            const win = settle({ outcome: OUTCOME.DEALER_BUST, bet: 40 });
            assert.equal(win.amount, 40);
            assert.equal(win.movements[0].reason, "game_win");

            const loss = settle({ outcome: OUTCOME.DEALER_WINS, bet: 40 });
            assert.equal(loss.amount, -40);
            assert.equal(loss.movements[0].reason, "game_loss");
        },
    },
    {
        label: "🔑 FIXED — an unknown outcome THROWS instead of returning a string",
        fn: () => {
            // His fallback was `return 'เดี๋ยวแก้ครับ เล่นต่อไปก่อน'` — one value where callers
            // indexed [1], so money_add received the string's second character.
            assert.throws(() => settle({ outcome: "nonsense", bet: 10 }), /unknown outcome/);
            assert.throws(() => settle({ outcome: undefined, bet: 10 }), /unknown outcome/);
        },
    },
    {
        label: "a surrender is never doubled — you cannot surrender after doubling down",
        fn: () => {
            const surrender = settle({ outcome: OUTCOME.SURRENDERED, bet: 10, doubled: true });
            assert.equal(surrender.amount, -5, "still half the ORIGINAL bet");
        },
    },

    // ── FIXED #7: insurance ──────────────────────────────────────────────────
    {
        label: "🔑 FIXED — insurance is a half-bet side wager at 2:1, settled on its own",
        fn: () => {
            // Dealer has blackjack: the 5-coin side bet pays 10, offsetting the 10 lost on the
            // main hand, so the hand nets zero — which is what insurance is FOR.
            const covered = settle({
                outcome: OUTCOME.DEALER_WINS,
                bet: 10,
                insurance: 5,
                dealerNatural: true,
            });
            assert.equal(covered.handAmount, -10);
            assert.equal(covered.insuranceAmount, 10);
            assert.equal(covered.amount, 0, "insurance should make a dealer blackjack a wash");

            // No blackjack: you lose only the side bet and play on.
            const wasted = settle({
                outcome: OUTCOME.PLAYER_WINS,
                bet: 10,
                insurance: 5,
                dealerNatural: false,
            });
            assert.equal(wasted.handAmount, 10);
            assert.equal(wasted.insuranceAmount, -5);
            assert.equal(wasted.amount, 5, "won the hand, lost the side bet");
        },
    },
    {
        label: "⚠️ his insurance numbers, recorded so the change is reversible on purpose",
        fn: () => {
            // HIS version: hole card ten-value → +bet*2 and the hand ends;
            //              otherwise          → -(bet + bet/2) and the hand CONTINUES.
            // Kept as arithmetic so the divergence is documented in something that runs.
            const bet = 10;
            const hisWin = bet * 2;
            const hisLoss = -(bet + bet / 2);
            assert.equal(hisWin, 20);
            assert.equal(hisLoss, -15);

            // Ours, for the same bet: +10 / -5 on the side bet alone.
            assert.equal(settle({ outcome: OUTCOME.DEALER_WINS, bet, insurance: 5, dealerNatural: true }).insuranceAmount, 10);
            assert.equal(settle({ outcome: OUTCOME.PLAYER_WINS, bet, insurance: 5, dealerNatural: false }).insuranceAmount, -5);

            // His loss was worse than surrendering the whole hand, and left the main bet live.
            assert.ok(hisLoss < -bet, "his failed insurance cost MORE than the bet itself");
        },
    },

    // ── his bet limits ───────────────────────────────────────────────────────
    {
        label: "⭐ HIS LIMITS KEPT — 20 to sit down, minimum bet 10, maximum half your money",
        fn: () => {
            assert.equal(BLACKJACK_RULES.MIN_MONEY, 20);
            assert.equal(BLACKJACK_RULES.MIN_BET, 10);
            assert.equal(validateStart({ bet: 10, balance: 20 }), null, "20 coins, bet 10, exactly legal");
            assert.equal(validateStart({ bet: 10, balance: 19 })?.code, "TOO_POOR");
            assert.equal(validateStart({ bet: 9, balance: 100 })?.code, "BET_TOO_LOW");
            assert.equal(validateStart({ bet: 51, balance: 100 })?.code, "BET_TOO_HIGH");
            assert.equal(validateStart({ bet: 10.5, balance: 100 })?.code, "BAD_BET");
            assert.equal(maxBet(100), 50);
            assert.equal(maxBet(21), 10);
        },
    },
    {
        label: "🔑 the bet cap keeps a DOUBLE DOWN inside the balance — 2×bet ≤ money",
        fn: () => {
            // Because the cap is half, doubling can never exceed the balance. Asserted because
            // it is the invariant that makes doubling safe, and it is easy to break by raising
            // the cap without thinking about dd.
            for (const balance of [20, 21, 50, 99, 100, 1000]) {
                const cap = maxBet(balance);
                assert.ok(cap * 2 <= balance, `bet cap ${cap} doubles past ${balance}`);
                if (cap >= BLACKJACK_RULES.MIN_BET) {
                    assert.equal(validateStart({ bet: cap, balance }), null);
                }
            }
        },
    },
    {
        label: "a negative balance cannot sit down",
        fn: () => {
            assert.equal(validateStart({ bet: 10, balance: -50 })?.code, "TOO_POOR");
            assert.equal(validateStart({ bet: 10, balance: 0 })?.code, "TOO_POOR");
        },
    },

    // ── which buttons appear ─────────────────────────────────────────────────
    {
        label: "double down and surrender are OPENING moves only — his implicit rule, stated",
        fn: () => {
            const opening = { playerCards: hand("9", "5"), finished: false, insurancePending: false };
            assert.deepEqual(availableDecisions(opening).sort(), [
                DECISION.DOUBLE, DECISION.HIT, DECISION.STAND, DECISION.SURRENDER,
            ].sort());

            const afterHit = { playerCards: hand("9", "5", "2"), finished: false, insurancePending: false };
            assert.deepEqual(availableDecisions(afterHit).sort(), [DECISION.HIT, DECISION.STAND].sort());
        },
    },
    {
        label: "while insurance is pending, those are the ONLY two choices",
        fn: () => {
            const pending = { playerCards: hand("9", "5"), finished: false, insurancePending: true };
            assert.deepEqual(availableDecisions(pending).sort(), [
                DECISION.DECLINE_INSURANCE, DECISION.INSURE,
            ].sort());
        },
    },
    {
        label: "a finished hand offers nothing",
        fn: () => {
            assert.deepEqual(availableDecisions({ playerCards: hand("9", "5"), finished: true }), []);
        },
    },

    // ── FIXED #8: one hand per channel ───────────────────────────────────────
    {
        label: "🔑 FIXED — hands are keyed by CHANNEL, not one global game bot-wide",
        fn: () => {
            const sessions = new BlackjackSessions();
            sessions.start({ channelId: "c1", guildId: "g1", playerId: "p1", bet: 10 });
            sessions.start({ channelId: "c2", guildId: "g2", playerId: "p2", bet: 20 });

            assert.equal(sessions.size, 2, "two channels must hold two independent hands");
            assert.equal(sessions.get("c1").bet, 10);
            assert.equal(sessions.get("c2").bet, 20);

            // Independent decks, not one shared global.
            assert.notEqual(sessions.get("c1").deck, sessions.get("c2").deck);

            // And a second hand in the SAME channel is refused.
            assert.throws(
                () => sessions.start({ channelId: "c1", guildId: "g1", playerId: "p3", bet: 10 }),
                /already running/,
            );

            sessions.end("c1");
            sessions.end("c2");
            assert.equal(sessions.size, 0);
        },
    },
    {
        label: "⚠️ HIS DEAL ORDER KEPT — player, dealer, player, dealer, so hand[0] is the hole",
        fn: () => {
            const sessions = new BlackjackSessions();
            const game = sessions.start({ channelId: "c", guildId: "g", playerId: "p", bet: 10 });

            assert.equal(game.playerCards.length, 2);
            assert.equal(game.dealerCards.length, 2);
            // Four cards are gone from the 52.
            assert.equal(game.deck.length, 48);
            assert.equal(game.doubled, false);
            assert.equal(game.insurance, 0);
            assert.equal(game.finished, false);
            sessions.end("c");
        },
    },
    {
        label: "insurance is offered when the dealer shows an ace — and never against a natural",
        fn: () => {
            // Driven through the real deal 4,000 times: whenever the up card is an ace and the
            // player has not already made 21, the offer must be pending, and never otherwise.
            const sessions = new BlackjackSessions();
            let offers = 0;
            let sawAceWithPlayerNatural = 0;

            for (let i = 0; i < 4_000; i += 1) {
                const key = `c${i}`;
                const game = sessions.start({ channelId: key, guildId: "g", playerId: "p", bet: 10 });
                const aceUp = dealerShowsAce(game.dealerCards);
                const playerNatural = isNatural(game.playerCards);

                if (aceUp && !playerNatural) {
                    assert.equal(game.insurancePending, true, "ace showing must offer insurance");
                    offers += 1;
                } else {
                    assert.equal(game.insurancePending, false, "no ace, no offer");
                    if (aceUp && playerNatural) sawAceWithPlayerNatural += 1;
                }
                sessions.end(key);
            }

            // 4 aces in 52 — roughly a thirteenth of hands should offer it. Wide window.
            assert.ok(offers > 150 && offers < 500, `offered insurance ${offers} times in 4000`);
            void sawAceWithPlayerNatural;
        },
    },
];
