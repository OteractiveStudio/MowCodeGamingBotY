/**
 * Mirrors {{schema}}.mst_player_item in database/migrations/002_game_core.sql.
 *
 * ⭐ A row per item. The legacy held `inventory.item = {"dog": 1}` inside the player
 * document, so acquiring one item rewrote every player's entire record.
 *
 * ⚠️ quantity > 0 is enforced in SQL: owning none is the ABSENCE of a row.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_player_item",
        {
            discord_id: {
                type: DataTypes.TEXT,
                primaryKey: true,
                comment: "FK to mst_player",
            },
            item_key: {
                type: DataTypes.TEXT,
                primaryKey: true,
                comment: "FK to mst_item",
            },
            quantity: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: "Always > 0 — a zero row is deleted instead",
            },
            acquired_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: "When the player first got this item type",
            },
        },
        {
            tableName: "mst_player_item",
            schema: schemas.project,
            // created_at added by 003, so the `createdAt: false` exception this used to carry
            // is gone — every model is plain `timestamps: true` now.
            timestamps: true,
            underscored: true,
        },
    );
