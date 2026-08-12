/**
 * Mirrors {{schema}}.mst_guild in database/migrations/001_core.sql.
 *
 * The legacy `settings.json` held per-guild live state next to config keys. The
 * config half is config.json now; this is the live half. They do not share a
 * home again.
 */
export default (sequelize, DataTypes, schemas) =>
    sequelize.define(
        "mst_guild",
        {
            guild_id: {
                type: DataTypes.TEXT,
                primaryKey: true,
                comment: "Discord guild snowflake, as a string (a JS number loses precision above 2^53)",
            },
            name: {
                type: DataTypes.TEXT,
                comment: "Guild name at last sight — display only, Discord is the truth",
            },
            prefix: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "+",
                comment: "NOT USED YET — the command surface (slash vs prefix) is undecided",
            },
            lang: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "en",
                comment: "Message catalogue to answer this guild in",
            },
            music_channel_id: {
                type: DataTypes.TEXT,
                comment: "Voice channel bound for music/TTS, if any",
            },
            manager_role_id: {
                type: DataTypes.TEXT,
                comment: "Role allowed to change this guild's bot settings (the legacy bot_manager_role)",
            },
            joined_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                comment: "First time the bot joined this guild",
            },
            left_at: {
                type: DataTypes.DATE,
                comment: "Set on guild remove instead of deleting the row, so settings survive a re-invite",
            },
        },
        {
            tableName: "mst_guild",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
