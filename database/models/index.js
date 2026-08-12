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
import mstPlayerStateModel from "./mst_player_state.model.js";
import mstItemModel from "./mst_item.model.js";
import mstPlayerItemModel from "./mst_player_item.model.js";
import mstMarketCategoryModel from "./mst_market_category.model.js";
import mstMarketListingModel from "./mst_market_listing.model.js";
import mstFishModel from "./mst_fish.model.js";
import txnPurchaseModel from "./txn_purchase.model.js";
import logEconomyModel from "./log_economy.model.js";
import mstWordleWordModel from "./mst_wordle_word.model.js";

export default function initModels(sequelize, schemas) {
    /**
     * Enumerations shared between the models and the SQL CHECK constraints.
     * When one of these changes, the SQL changes in the same commit.
     */
    const choices = {
        log_message_level: ["debug", "info", "warning", "error"],
        fish_type: ["creature", "not_creature"],
        economy_reason: [
            "provision",
            "fishing_catch",
            "market_purchase",
            "transfer_in",
            "transfer_out",
            "admin_adjust",
            "game_win",
            "game_loss",
            "steal_gain",
            "steal_loss",
            "correction",
        ],
    };

    /** Sequelize lifecycle hooks, keyed by table name. Empty until a row needs logic. */
    const hooks = {};

    const models = {
        log_message: logMessageModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_guild: mstGuildModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_player: mstPlayerModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_player_state: mstPlayerStateModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_item: mstItemModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_player_item: mstPlayerItemModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_market_category: mstMarketCategoryModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_market_listing: mstMarketListingModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_fish: mstFishModel(sequelize, DataTypes, schemas, choices, hooks),
        mst_wordle_word: mstWordleWordModel(sequelize, DataTypes, schemas, choices, hooks),
        txn_purchase: txnPurchaseModel(sequelize, DataTypes, schemas, choices, hooks),
        log_economy: logEconomyModel(sequelize, DataTypes, schemas, choices, hooks),
    };

    return { models, choices };
}
