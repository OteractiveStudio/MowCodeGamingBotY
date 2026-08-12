/**
 * database/models/index.js — the model registry.
 *
 * ⭐ This is the descendant of the legacy `MCGB_BasicClass.datafile` dict:
 *
 *     datafile = { "players": "./data/files/players_inv.json",
 *                  "fish":    "./data/fish/fish.json", ... }
 *
 * A logical name → where the data lives, in ONE place. Same idea, better store.
 *
 * ⚠️ ONE NAME END TO END (STANDARDS §4): the file name, the `sequelize.define()`
 * name, the `tableName`, and the `db.` accessor are the same literal string —
 * `db.mst_player`. No name map, no camelCase accessor, no helper (a helper would
 * add a fourth name). test/unit/model-name-parity.test.mjs fails if they drift.
 */

import { DataTypes } from "sequelize";

import logMessageModel from "./log_message.model.js";
import mstGuildModel from "./mst_guild.model.js";
import mstPlayerModel from "./mst_player.model.js";

export default function initModels(sequelize, schemas) {
    /**
     * Enumerations shared between the models and the SQL CHECK constraints.
     * When one of these changes, the SQL changes in the same commit.
     */
    const choices = {
        log_message_level: ["debug", "info", "warning", "error"],
    };

    /** Sequelize lifecycle hooks, keyed by table name. Empty until a row needs logic. */
    const hooks = {};

    const models = {
        log_message: logMessageModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_guild: mstGuildModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_player: mstPlayerModel(sequelize, DataTypes, schemas, choices, hooks),
    };

    return { models, choices };
}
