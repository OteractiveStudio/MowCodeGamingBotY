/**
 * Mirrors {{schema}}.mst_wordle_word in database/migrations/005_wordle.sql.
 *
 * ⭐ This table exists because the legacy had NO word list. `BN_bot/data/wordle/words.txt` is
 * zero bytes; the real source was `zenquotes.io/api/random` feeding `api.datamuse.com`, called
 * at module import time — so starting the bot made two external HTTP requests, and the game
 * could not run at all without the internet. A game word is not worth that dependency.
 *
 * ⚠️ Length is 4-6, not 5. His `wordle_target_rand(4, 6)` picked in that range and the board
 * is sized from `len(target)`, so the grid width varies per game. That is his design.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_wordle_word",
        {
            word: {
                type: DataTypes.TEXT,
                primaryKey: true,
                validate: { is: /^[a-z]+$/ },
                comment: "Lowercase a-z only — his isalpha()+islower() filter accepted any Unicode letter",
            },
            length: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: "4-6, and SQL checks it equals char_length(word) so a query can trust it",
            },
            is_answer: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
                comment: "false = never chosen as a target. Nothing sets this yet.",
            },
            is_active: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
                comment: "Retiring a word keeps finished games readable",
            },
        },
        {
            tableName: "mst_wordle_word",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
