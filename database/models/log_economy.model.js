/**
 * Mirrors {{schema}}.log_economy in database/migrations/002_game_core.sql.
 *
 * ⭐ The point of this table: the legacy could tell you a player had 925 coins, but
 * not why, when, or whether a write had been lost. One row per money/exp mutation,
 * written in the SAME transaction as the mutation, so the log cannot disagree with
 * the balance.
 */
export default (sequelize, DataTypes, schemas, choices) =>
    sequelize.define(
        "log_economy",
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
                comment: "Order the chain by this — money_after must chain by money_delta",
            },
            discord_id: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            occurred_on: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            reason: {
                type: DataTypes.TEXT,
                allowNull: false,
                validate: { isIn: [choices.economy_reason] },
                comment: "CHECK-constrained in SQL — an unknown reason is a bug, not a new category",
            },
            money_delta: {
                type: DataTypes.BIGINT,
                allowNull: false,
            },
            money_after: {
                type: DataTypes.BIGINT,
                allowNull: false,
                comment: "The balance immediately after this row — what makes it auditable",
            },
            exp_delta: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            exp_after: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            level_after: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            crystal_after: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            levels_gained: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: "More than 1 when a single credit cascades through several levels",
            },
            crystals_gained: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            ref: {
                type: DataTypes.TEXT,
                comment: "A fish key, an item key, or the other player in a transfer",
            },
            guild_id: {
                type: DataTypes.TEXT,
            },
            actor_id: {
                type: DataTypes.TEXT,
                comment: "Who caused it, if not the player — an admin, or a gift sender",
            },
        },
        {
            tableName: "log_economy",
            schema: schemas.project,
            // created_at / updated_at added by 003. `occurred_on` stays: imported history has
            // an occurred_on from years ago and a created_at from the import.
            timestamps: true,
            underscored: true,
        },
    );
