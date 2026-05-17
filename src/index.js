import fs from 'fs';
import { ConfigManager } from './config/ConfigManager.js';
import { DatabaseService } from './database/DatabaseService.js';
import { PocketBaseService } from './api/PocketBaseService.js';
import { SyncService } from './services/SyncService.js';
import { WatcherService } from './services/WatcherService.js';
import { spawn } from 'child_process';
import { showHelp } from './cli/help.js';
import enquirer from 'enquirer';
import path from 'path';


// 1. Argument parsing (internal or external utility)
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    const cleanKey = key.replace('--', '');
    acc[cleanKey] = value !== undefined ? value : true;
    return acc;
}, {});

async function main() {
    if (args.help) {
        showHelp();
        process.exit(0);
    }

    if (args.listProfile) {
        const configMgr = new ConfigManager(args);
        configMgr.listProfiles();
        process.exit(0);
    }

    if (args.showProfile) {
        const configMgr = new ConfigManager(args);
        const profileName = typeof args.showProfile === 'string' ? args.showProfile : undefined;
        configMgr.showProfile(profileName);
        process.exit(0);
    }

    if (args.setDefaultMode) {
        const configMgr = new ConfigManager(args);
        const success = configMgr.setDefaultMode(args.setDefaultMode);
        process.exit(success ? 0 : 1);
    }

    try {
        // --- CONFIGURATION INITIALIZATION ---
        const configMgr = new ConfigManager(args);
        const config = await configMgr.getEffectiveConfig();

        // get full path of db
        const newDbPath = path.resolve(config.dbPath);
        if (newDbPath != config.dbPath) {
            config.dbPath = newDbPath;
            // save config
            await configMgr.save(config);
        }

        // show all relevant parametert from configuration
        console.log("Path DB: " + config.dbPath);
        console.log("URL: " + config.pbUrl);
        console.log("User: " + config.pbUser);
        console.log("MMEX Path: " + config.mmexExe);

        // --- SERVICES INITIALIZATION ---
        const db = new DatabaseService(config.dbPath, args.verbose);

        db.connect(args.create);

        const pb = new PocketBaseService(config.pbUrl);

        if (config.pbPass || !config.token) { // password is supplied invalidate any token
            pb.invalidateToken();
            await pb.authenticate(config.pbUser, config.pbPass);
            config.token = pb.getToken();
            configMgr.updateConfig(config);
        } else {
            pb.setToken(config.token);
        }

        // todo handle token refresh when expired

        const sync = new SyncService(db, pb, configMgr, args);

        if (args.clearServer) {
            const { confirm } = await enquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to clear ALL data on the PocketBase server?'
            });
            if (confirm) await pb.clearRemoteServer();
        }

        if (args.clearDb) {
            const { confirm } = await enquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to remove ALL technical tables on the local database?'
            });
            if (confirm) db.clearTechnicalSchema();
        }

        if (args.clearServer || args.clearDb) {
            process.exit(0);
        }

        // --- MODE DETERMINATION ---
        let mode = args.watch ? 'watch' : (args.run ? 'run' : (args.sync ? 'sync' : config.defaultMode));
        console.log(`🚀 MMEX-Sync | Profile: ${configMgr.profile} | Mode: ${mode.toUpperCase()}`);

        if ((mode === 'run' || mode === 'watch') && !fs.existsSync(config.mmexExe)) {
            throw new Error(`MMEX executable not found at path: ${config.mmexExe}. Use --exe to specify it.`);
        }

        // 1. Mandatory init (Triggers & Columns) as in the old core
        db.initSchema();

        // --- LOGIC EXECUTION ---
        switch (mode) {
            case 'watch':
                // Initial cycle -> Start Watcher -> Launch MMEX (waiting) -> Stop Watcher -> Final cycle
                await sync.runSyncCycle();
                const watcher = new WatcherService(db, pb, sync, config);
                await watcher.start();

                await launchMMEX(config.mmexExe, config.dbPath, false);

                console.log("📝 MMEX closed. Stopping watcher and executing final synchronization...");
                await watcher.stop();
                await sync.runSyncCycle();
                process.exit(0);
                break;

            case 'run':
                // Initial cycle -> Launch MMEX (waiting) -> Final cycle
                await sync.runSyncCycle();
                await launchMMEX(config.mmexExe, config.dbPath, false);
                console.log("📝 MMEX closed. Executing final synchronization...");
                await sync.runSyncCycle();
                process.exit(0);
                break;

            case 'sync':
            default:
                // await sync.fullCycle();
                // Executes only requested parts (e.g., --push --pull)
                await sync.runSyncCycle();
                process.exit(0);
        }

    } catch (err) {
        console.error(`\n❌ CRITICAL ERROR: ${err.message}`);
        if (args.verbose) console.error(err.stack);
        process.exit(1);
    }
}

/**
 * Helper for starting MMEX
 */
function launchMMEX(exePath, dbPath, detached) {
    console.log(`\n=== Starting MMEX: ${exePath} ===`);
    const mmex = spawn(exePath, [dbPath], {
        detached: detached,
        stdio: detached ? 'ignore' : 'inherit'
    });

    if (detached) {
        mmex.unref();
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        mmex.on('close', resolve);
    });
}

// Application startup
main();