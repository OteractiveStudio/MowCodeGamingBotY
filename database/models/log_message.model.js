/**
 * Mirrors {{schema}}.log_message in database/migrations/001_core.sql.
 * The SQL is the source of truth — if the two disagree, the SQL is right and a
 * unit test in test/unit/ fails.
 */
export default (sequelize, DataTypes, schemas, choices) =>
    sequelize.define(
        "log_message",
        {
            uuid: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
                comment: "Primary key of the table",
            },
            rolling_id: {
                type: DataTypes.BIGINT,
                autoIncrement: true,
                allowNull: false,
                unique: true,
                comment: "Monotonic counter — cheap ordering without parsing timestamps",
            },
            process_start_on: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: "When the emitting process started — groups a whole run",
            },
            report_on: {
                type: DataTypes.DATE,
                allowNull: false,
                comment: "When the line was logged",
            },
            report_by: {
                type: DataTypes.TEXT,
                allowNull: false,
                comment: "Project-relative path of the module that logged it",
            },
            level: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "info",
                validate: {
                    isIn: [choices.log_message_level],
                },
                comment: "debug | info | warning | error — CHECK-constrained in SQL",
            },
            message: {
                type: DataTypes.TEXT,
                allowNull: false,
                comment: "The log line itself",
            },
        },
        {
            tableName: "log_message",
            schema: schemas.project,
            // created_at / updated_at added by 003. `report_on` stays: it is when the line was
            // logged, which is not the same as when the row was written.
            timestamps: true,
            underscored: true,
        },
    );
