/**
 * Mirrors {{schema}}.mst_player in database/migrations/001_core.sql.
 *
 * Keyed by Discord user id, exactly as the legacy `players_inv.json` was — which
 * is what keeps importing the 24 legacy players a later data job needing no
 * schema change.
 *
 * ⚠️ No `is_admin` here on purpose: the legacy read admin identity from player
 * rows that `reset_player` could wipe. Admin identity is config.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_player",
        {
            discord_id: {
                type: DataTypes.TEXT,
                primaryKey: true,
                comment: "Discord user snowflake, as a string — the join key the legacy data also used",
            },
            username: {
                type: DataTypes.TEXT,
                comment: "Discord username at last sight",
            },
            global_name: {
                type: DataTypes.TEXT,
                comment: "Display name. Replaces the legacy `discriminator`, which Discord retired in 2023",
            },
            is_bot: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                comment: "Bots get rows so they can be excluded from games explicitly, not by accident",
            },
            first_seen_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: "First interaction the bot saw from this user",
            },
            last_seen_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: "Most recent interaction",
            },
        },
        {
            tableName: "mst_player",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
