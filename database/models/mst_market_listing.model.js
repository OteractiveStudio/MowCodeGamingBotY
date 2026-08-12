/**
 * Mirrors {{schema}}.mst_market_listing in database/migrations/002_game_core.sql.
 *
 * ⚠️ This table exists because of one detail in the legacy data: `fishingrod` is
 * listed in BOTH "Quick_menu" AND "Tool", at the same price. An item is defined once
 * in mst_item and listed as many times as it is sold.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_market_listing",
        {
            category_key: {
                type: DataTypes.TEXT,
                primaryKey: true,
            },
            item_key: {
                type: DataTypes.TEXT,
                primaryKey: true,
            },
            price: {
                type: DataTypes.BIGINT,
                allowNull: false,
                comment: "Price in this category — BIGINT, so Sequelize returns a string",
            },
            is_available: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
                comment: "Delisting keeps the price history instead of deleting the row",
            },
        },
        {
            tableName: "mst_market_listing",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
