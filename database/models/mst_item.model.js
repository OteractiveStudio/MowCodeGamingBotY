/**
 * Mirrors {{schema}}.mst_item in database/migrations/002_game_core.sql.
 *
 * The legacy had no item catalogue at all — an item existed if it appeared in some
 * market category, and a player's items were a bare {name: count} dict with nothing
 * to validate the name against.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_item",
        {
            item_key: {
                type: DataTypes.TEXT,
                primaryKey: true,
                comment: "Stable lowercase key — what other tables reference",
            },
            display_name: {
                type: DataTypes.TEXT,
                allowNull: false,
                comment: "What a player sees",
            },
            emoji: {
                type: DataTypes.TEXT,
                comment: "The legacy drove its market entirely with these",
            },
            detail: {
                type: DataTypes.TEXT,
                comment: "What the item is for, shown in the market",
            },
        },
        {
            tableName: "mst_item",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
