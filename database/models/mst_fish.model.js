/**
 * Mirrors {{schema}}.mst_fish in database/migrations/002_game_core.sql.
 *
 * 🔑 Draw weight is `10 - tier`, straight from the legacy pool builder, so tier is
 * constrained to 0-9 in SQL: tier 10 would be undrawable and tier 11 would
 * contribute a negative count to the pool.
 */
export default (sequelize, DataTypes, schemas, choices) =>
    sequelize.define(
        "mst_fish",
        {
            fish_key: {
                type: DataTypes.TEXT,
                primaryKey: true,
            },
            display_name: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            file_name: {
                type: DataTypes.TEXT,
                comment: "The legacy reconciled this list against the picture files on disk",
            },
            fish_type: {
                type: DataTypes.TEXT,
                allowNull: false,
                defaultValue: "creature",
                validate: { isIn: [choices.fish_type] },
                comment: "not_creature covers Nothing and Trash",
            },
            price: {
                type: DataTypes.BIGINT,
                allowNull: false,
                comment: "Auto-sold for this on catch, which also grants the same exp",
            },
            tier: {
                type: DataTypes.INTEGER,
                allowNull: false,
                comment: "0-9. Weight = 10 - tier, so a LOWER tier is MORE common",
            },
            is_active: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
                comment: "Retiring a fish keeps its catch history readable",
            },
        },
        {
            tableName: "mst_fish",
            schema: schemas.project,
            timestamps: true,
            underscored: true,
        },
    );
