/**
 * Unit: the OX rules, with no database and no Discord.
 *
 * ⚠️ This file closes a real gap — OX shipped and was being played live before it had any tests,
 * while `guess` had its rules covered from the start. Payout logic without tests is exactly the
 * kind of thing that quietly pays the wrong player.
 *
 * The numbers are his: duel bet ≤1000, vs bot ≤40, *"winning will get you half of the bet, while
 * losing will make you lose it all"*, and a draw costs nobody anything.
 */

import assert from "node:assert/strict";

import {
    OX_RULES,
    MARKS,
    WINNING_LINES,
    emptyBoard,
    cellLabel,
    cellPosition,
    winnerOf,
    isFull,
    emptyCells,
    botMove,
    validateOxStart,
    settle,
    markForTurn,
    OxSessions,
} from "../../app/data/ox.js";
import { BAD_ECON_THRESHOLD } from "../../app/data/economy.js";

const CHALLENGER = "800000000000000001";
const OPPONENT = "800000000000000002";

/** Build a board from a 9-character string: O, X, or . for empty. */
const boardFrom = (text) =>
    [...text].map((character) => (character === "." ? null : character));

const totals = (movements) => {
    const map = new Map();
    for (const movement of movements) {
        map.set(movement.discordId, (map.get(movement.discordId) ?? 0) + movement.amount);
    }
    return map;
};

export default [
    {
        label: "his caps: 1000 in a duel, 40 against the bot",
        fn: () => {
            assert.equal(OX_RULES.MAX_BET_VS_PLAYER, 1000);
            assert.equal(OX_RULES.MAX_BET_VS_BOT, 40);
        },
    },
    {
        label: "cells are labelled 1-9, left to right, top to bottom",
        fn: () => {
            assert.deepEqual(
                Array.from({ length: 9 }, (unused, index) => cellLabel(index)),
                ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
            );
            // The row/column form still exists for prose, just not as the label.
            assert.deepEqual(cellPosition(0), { row: 1, column: 1 });
            assert.deepEqual(cellPosition(4), { row: 2, column: 2 });
            assert.deepEqual(cellPosition(8), { row: 3, column: 3 });
        },
    },
    {
        label: "there are exactly 8 ways to win, and each is 3 distinct cells",
        fn: () => {
            assert.equal(WINNING_LINES.length, 8);
            for (const line of WINNING_LINES) {
                assert.equal(new Set(line).size, 3);
                for (const index of line) assert.ok(index >= 0 && index <= 8);
            }
        },
    },
    {
        label: "rows, columns and both diagonals are detected",
        fn: () => {
            assert.equal(winnerOf(boardFrom("OOO......")).mark, MARKS.FIRST, "top row");
            assert.equal(winnerOf(boardFrom("...XXX...")).mark, MARKS.SECOND, "middle row");
            assert.equal(winnerOf(boardFrom("......OOO")).mark, MARKS.FIRST, "bottom row");
            assert.equal(winnerOf(boardFrom("X..X..X..")).mark, MARKS.SECOND, "left column");
            assert.equal(winnerOf(boardFrom(".O..O..O.")).mark, MARKS.FIRST, "middle column");
            assert.equal(winnerOf(boardFrom("..X..X..X")).mark, MARKS.SECOND, "right column");
            assert.equal(winnerOf(boardFrom("O...O...O")).mark, MARKS.FIRST, "top-left diagonal");
            assert.equal(winnerOf(boardFrom("..X.X.X..")).mark, MARKS.SECOND, "top-right diagonal");
        },
    },
    {
        label: "the winning line is reported, so the board can highlight it",
        fn: () => {
            assert.deepEqual(winnerOf(boardFrom("O...O...O")).line, [0, 4, 8]);
            assert.deepEqual(winnerOf(boardFrom("XXX......")).line, [0, 1, 2]);
        },
    },
    {
        label: "no winner is null, and a full board with no line is a draw",
        fn: () => {
            assert.equal(winnerOf(emptyBoard()), null);
            assert.equal(winnerOf(boardFrom("OX.......")), null);

            const drawn = boardFrom("OXOXXOXOX");
            assert.equal(winnerOf(drawn), null, "this arrangement has no line");
            assert.equal(isFull(drawn), true);
            assert.equal(isFull(boardFrom("OXOXXOXO.")), false);
        },
    },
    {
        label: "O always moves first, and marks alternate",
        fn: () => {
            assert.equal(markForTurn(0), MARKS.FIRST);
            assert.equal(markForTurn(1), MARKS.SECOND);
            assert.equal(markForTurn(2), MARKS.FIRST);
            assert.equal(markForTurn(8), MARKS.FIRST, "the 9th move is O's");
        },
    },
    {
        label: "the bot only ever picks an empty cell",
        fn: () => {
            const board = boardFrom("OX.OX.O..");
            const free = emptyCells(board);
            assert.deepEqual(free, [2, 5, 7, 8]);

            // Every point of the random range must land on a free cell.
            for (const roll of [0, 0.1, 0.25, 0.49, 0.5, 0.75, 0.99, 0.999999]) {
                assert.ok(free.includes(botMove(board, () => roll)), `roll ${roll} picked a taken cell`);
            }
        },
    },
    {
        label: "the bot returns -1 on a full board rather than a bad index",
        fn: () => {
            assert.equal(botMove(boardFrom("OXOXXOXOX")), -1);
        },
    },
    {
        label: "a friendly game (bet 0) needs no coins and pays nothing",
        fn: () => {
            assert.equal(validateOxStart({ bet: 0, withBot: true, challengerBalance: 0 }), null);
            assert.deepEqual(
                settle({ bet: 0, withBot: true, challengerId: CHALLENGER, outcome: "challenger" }),
                [],
            );
        },
    },
    {
        label: "vs the bot: winning pays HALF the bet, floored",
        fn: () => {
            const movements = settle({
                bet: 25,
                withBot: true,
                challengerId: CHALLENGER,
                outcome: "challenger",
            });
            assert.equal(movements.length, 1);
            assert.equal(movements[0].discordId, CHALLENGER);
            assert.equal(movements[0].amount, 12, "int(25/2) is 12");
            assert.equal(movements[0].reason, "game_win");
        },
    },
    {
        label: "vs the bot: losing costs the WHOLE bet",
        fn: () => {
            const movements = settle({
                bet: 25,
                withBot: true,
                challengerId: CHALLENGER,
                outcome: "bot",
            });
            assert.equal(movements.length, 1);
            assert.equal(movements[0].discordId, CHALLENGER);
            assert.equal(movements[0].amount, -25);
            assert.equal(movements[0].reason, "game_loss");
        },
    },
    {
        label: "vs the bot the odds are asymmetric on purpose — half up, all down",
        fn: () => {
            // This is why the bot plays at random: at these odds a competent bot would make
            // betting a pure loss. Stated as a test so nobody "improves" the AI by accident.
            const won = settle({ bet: 40, withBot: true, challengerId: CHALLENGER, outcome: "challenger" });
            const lost = settle({ bet: 40, withBot: true, challengerId: CHALLENGER, outcome: "bot" });
            assert.equal(won[0].amount, 20);
            assert.equal(lost[0].amount, -40);
            assert.ok(Math.abs(lost[0].amount) > won[0].amount * 1.5, "the loss must outweigh the win");
        },
    },
    {
        label: "a duel moves the FULL bet from loser to winner, both ways round",
        fn: () => {
            const challengerWon = totals(
                settle({
                    bet: 100,
                    withBot: false,
                    challengerId: CHALLENGER,
                    opponentId: OPPONENT,
                    outcome: "challenger",
                }),
            );
            assert.equal(challengerWon.get(CHALLENGER), 100);
            assert.equal(challengerWon.get(OPPONENT), -100);

            const opponentWon = totals(
                settle({
                    bet: 100,
                    withBot: false,
                    challengerId: CHALLENGER,
                    opponentId: OPPONENT,
                    outcome: "opponent",
                }),
            );
            assert.equal(opponentWon.get(OPPONENT), 100);
            assert.equal(opponentWon.get(CHALLENGER), -100);
        },
    },
    {
        label: "a duel is zero-sum — coins move, none are created",
        fn: () => {
            const movements = settle({
                bet: 250,
                withBot: false,
                challengerId: CHALLENGER,
                opponentId: OPPONENT,
                outcome: "challenger",
            });
            assert.equal(
                movements.reduce((sum, movement) => sum + movement.amount, 0),
                0,
            );
        },
    },
    {
        label: "a draw pays nobody, with or without a bet",
        fn: () => {
            assert.deepEqual(
                settle({ bet: 500, withBot: false, challengerId: CHALLENGER, opponentId: OPPONENT, outcome: "draw" }),
                [],
            );
            assert.deepEqual(
                settle({ bet: 40, withBot: true, challengerId: CHALLENGER, outcome: "draw" }),
                [],
            );
        },
    },
    {
        label: "every settlement uses a reason the ledger accepts, and says why",
        fn: () => {
            const allowed = new Set(["game_win", "game_loss"]);
            for (const [withBot, outcome] of [
                [true, "challenger"],
                [true, "bot"],
                [false, "challenger"],
                [false, "opponent"],
            ]) {
                for (const movement of settle({
                    bet: 40,
                    withBot,
                    challengerId: CHALLENGER,
                    opponentId: OPPONENT,
                    outcome,
                })) {
                    assert.ok(allowed.has(movement.reason), `bad reason ${movement.reason}`);
                    assert.ok(movement.note, "a movement with no note explains nothing in the ledger");
                }
            }
        },
    },
    {
        label: "the bot's bet cap is enforced separately from the duel cap",
        fn: () => {
            assert.equal(validateOxStart({ bet: 40, withBot: true, challengerBalance: 500 }), null);
            assert.equal(
                validateOxStart({ bet: 41, withBot: true, challengerBalance: 500 }).code,
                "BET_TOO_HIGH",
            );
            // 41 is fine in a duel, where the cap is 1000.
            assert.equal(
                validateOxStart({ bet: 41, withBot: false, challengerBalance: 500, opponentBalance: 500 }),
                null,
            );
            assert.equal(
                validateOxStart({ bet: 1001, withBot: false, challengerBalance: 5000, opponentBalance: 5000 }).code,
                "BET_TOO_HIGH",
            );
        },
    },
    {
        label: "both players must afford a duel, and the error names the real ceiling",
        fn: () => {
            assert.equal(
                validateOxStart({ bet: 300, withBot: false, challengerBalance: 200, opponentBalance: 900 }).code,
                "CANNOT_AFFORD",
            );
            const problem = validateOxStart({
                bet: 300,
                withBot: false,
                challengerBalance: 900,
                opponentBalance: 150,
            });
            assert.equal(problem.code, "OPPONENT_CANNOT_AFFORD");
            assert.match(problem.message, /150/, "it should say what they can actually manage");
        },
    },
    {
        label: "bankruptcy is the established -20, not the legacy's contradictory -10",
        fn: () => {
            // His guard tested `< -10` while printing "less than -20 BezCoins".
            assert.equal(
                validateOxStart({ bet: 10, withBot: true, challengerBalance: BAD_ECON_THRESHOLD }).code,
                "BANKRUPT",
            );
            assert.equal(
                validateOxStart({ bet: 10, withBot: false, challengerBalance: 500, opponentBalance: -50 }).code,
                "OPPONENT_BANKRUPT",
            );
            // Just above the threshold, with enough coins, is allowed.
            assert.equal(validateOxStart({ bet: 10, withBot: true, challengerBalance: 19 }), null);
        },
    },
    {
        label: "a negative or fractional bet is refused",
        fn: () => {
            assert.equal(validateOxStart({ bet: -5, withBot: true, challengerBalance: 500 }).code, "BAD_BET");
            assert.equal(validateOxStart({ bet: 2.5, withBot: true, challengerBalance: 500 }).code, "BAD_BET");
        },
    },
    {
        label: "one game per channel, and channels do not interfere",
        fn: () => {
            const sessions = new OxSessions();
            const game = sessions.start({
                channelId: "c1",
                challengerId: CHALLENGER,
                opponentId: null,
                bet: 0,
                withBot: true,
            });
            assert.equal(game.accepted, true, "playing the bot needs nobody's permission");

            let threw = false;
            try {
                sessions.start({ channelId: "c1", challengerId: OPPONENT, bet: 0, withBot: true });
            } catch {
                threw = true;
            }
            assert.ok(threw, "a second game in one channel must be refused");

            // The legacy could not do this: its board was module-level.
            sessions.start({
                channelId: "c2",
                challengerId: OPPONENT,
                opponentId: CHALLENGER,
                bet: 0,
                withBot: false,
            });
            assert.equal(sessions.get("c2").accepted, false, "a duel waits to be accepted");
            assert.equal(sessions.get("c1").withBot, true);
            assert.equal(sessions.size, 2);
        },
    },
    {
        label: "turn order alternates between the two players, and the bot takes X",
        fn: () => {
            const sessions = new OxSessions();
            const duel = sessions.start({
                channelId: "d",
                challengerId: CHALLENGER,
                opponentId: OPPONENT,
                bet: 0,
                withBot: false,
            });
            assert.equal(sessions.currentPlayer(duel), CHALLENGER);
            sessions.place(duel, 0);
            assert.equal(sessions.currentPlayer(duel), OPPONENT);
            sessions.place(duel, 1);
            assert.equal(sessions.currentPlayer(duel), CHALLENGER);

            const solo = sessions.start({
                channelId: "s",
                challengerId: CHALLENGER,
                opponentId: null,
                bet: 0,
                withBot: true,
            });
            sessions.place(solo, 0);
            assert.equal(sessions.currentPlayer(solo), "bot");
        },
    },
    {
        label: "place() reports the win and the finish, and the board holds the marks",
        fn: () => {
            const sessions = new OxSessions();
            const game = sessions.start({
                channelId: "w",
                challengerId: CHALLENGER,
                opponentId: OPPONENT,
                bet: 0,
                withBot: false,
            });

            // O:0, X:3, O:1, X:4, O:2 wins the top row.
            for (const index of [0, 3, 1, 4]) {
                assert.equal(sessions.place(game, index).finished, false);
            }
            const final = sessions.place(game, 2);
            assert.equal(final.finished, true);
            assert.equal(final.win.mark, MARKS.FIRST);
            assert.deepEqual(final.win.line, [0, 1, 2]);
            assert.equal(game.moves, 5);
            assert.deepEqual(game.board.slice(0, 3), ["O", "O", "O"]);
        },
    },
];
