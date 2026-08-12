/**
 * Mirrors {{schema}}.log_feedback in database/migrations/006_feedback.sql.
 *
 * ⚠️ NO ASSOCIATION TO mst_player, on purpose. Feedback is a message to the maintainers, not part
 * of a player's state, so it must survive the player row being deleted — which has already
 * happened once to every row in this schema. `username_at_time` is the snapshot that keeps a row
 * readable on its own. The full reasoning is in the migration's header.
 */
export default (sequelize, DataTypes, schemas, choices) =>
    sequelize.define(
        "log_feedback",
        {
            uuid: {
                type: DataTypes.UUID,
                primaryKey: true,
                defaultValue: DataTypes.UUIDV4,
            },
            rolling_id: {
                type: DataTypes.BIGINT,
                autoIncrement: true,
                unique: true,
            },
            discord_id: {
                type: DataTypes.TEXT,
                allowNull: false,
                validate: { is: /^[0-9]{1,32}$/ },
                comment: "Shape-checked but NOT a foreign key — feedback outlives the player row",
            },
            username_at_time: {
                type: DataTypes.TEXT,
                comment: "Snapshot, so the row reads on its own after a player reset",
            },
            guild_id: { type: DataTypes.TEXT },
            channel_id: { type: DataTypes.TEXT },
            message: {
                type: DataTypes.TEXT,
                allowNull: false,
                comment: "3-1000 characters, matching the bounds the command declares",
            },
            status: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "new",
                validate: { isIn: [choices.feedback_status] },
            },
            handled_by: {
                type: DataTypes.TEXT,
                comment: "Which bot admin moved it off 'new'. SQL pairs this with handled_at.",
            },
            handled_at: { type: DataTypes.DATE },
        },
        {
            tableName: "log_feedback",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
