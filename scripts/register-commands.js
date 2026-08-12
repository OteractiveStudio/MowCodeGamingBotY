#!/usr/bin/env node
/**
 * scripts/register-commands.js — publish the slash command list to Discord.
 *
 *   npm run bot:register
 *
 * Separate from the bot's boot on purpose: registration is a write to Discord's
 * API with a rate limit, not something to do on every restart.
 */

import { loadConfig, configureLogging, logInit } from "../lib/utility.js";
import { publishCommands } from "../app/bot/registry.js";

const config = loadConfig();
configureLogging(config);
logInit();

try {
    await publishCommands(config);
    process.exitCode = 0;
} catch (err) {
    console.error(`[register] failed: ${err.message}`);
    process.exitCode = 1;
}
