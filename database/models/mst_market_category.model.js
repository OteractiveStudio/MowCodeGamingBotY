/**
 * Mirrors {{schema}}.mst_market_category in database/migrations/002_game_core.sql.
 * The legacy market.json's top-level keys: Quick_menu ⚡, Pet 1️⃣, Tool 2️⃣.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_market_category",
        {
            category_key: {
                type: DataTypes.TEXT,
                primaryKey: true,
            },
            display_name: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            emoji: {
                type: DataTypes.TEXT,
                comment: "The legacy selected a category by reacting with this",
            },
            sort_order: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: "Display order — the legacy relied on dict insertion order",
            },
            is_active: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
        },
        {
            tableName: "mst_market_category",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
