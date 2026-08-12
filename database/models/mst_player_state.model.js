/**
 * Mirrors {{schema}}.mst_player_state in database/migrations/002_game_core.sql.
 *
 * The legacy `inventory` + `stats` blocks of players_inv.json, minus the item dict
 * (which is now mst_player_item, a row per item).
 *
 * ⚠️ `money` is BIGINT, which Sequelize hands back as a STRING. Read it through
 * app/data/economy.js rather than doing arithmetic on the attribute directly.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_player_state",
        {
            discord_id: {
                type: DataTypes.TEXT,
                primaryKey: true,
                comment: "Discord user snowflake — FK to mst_player",
            },
            money: {
                type: DataTypes.BIGINT,
                allowNull: false,
                defaultValue: 200,
                comment: "May be NEGATIVE; below -20 the legacy calls the player bad econ",
            },
            exp: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: "Resets on level up. Cap is level*10 + magical_crystal*2",
            },
            level: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 1,
                comment: "0-99. Reaching 100 converts to a magical crystal",
            },
            magical_crystal: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: "Earned at level 100; raises the exp cap permanently",
            },
            fishing_rod: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 10,
                comment: "Consumed one per cast",
            },
            inventory_size: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 1,
                comment: "How many distinct item types the player may hold",
            },
            fishing_count: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                comment: "Lifetime catches — the legacy stats.fishing",
            },
        },
        {
            tableName: "mst_player_state",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
