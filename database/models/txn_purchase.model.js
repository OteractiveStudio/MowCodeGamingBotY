/**
 * Mirrors {{schema}}.txn_purchase in database/migrations/002_game_core.sql.
 * What happened at the market. The legacy recorded nothing — the coins just left.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "txn_purchase",
        {
            uuid: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            rolling_id: {
                type: DataTypes.BIGINT,
                autoIncrement: true,
                allowNull: false,
                unique: true,
            },
            discord_id: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            item_key: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            category_key: {
                type: DataTypes.TEXT,
                comment: "Which category it was bought from — fishingrod is sold in two",
            },
            quantity: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            unit_price: {
                type: DataTypes.BIGINT,
                allowNull: false,
                comment: "The price AT THE TIME — relisting must not rewrite history",
            },
            total_price: {
                type: DataTypes.BIGINT,
                allowNull: false,
                comment: "CHECK-constrained in SQL to equal unit_price * quantity",
            },
            guild_id: {
                type: DataTypes.TEXT,
            },
            purchased_on: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
        },
        {
            tableName: "txn_purchase",
            schema: schemas.project,
            // created_at / updated_at added by 003. `purchased_on` stays as the domain time.
            timestamps: true,
            underscored: true,
        },
    );
