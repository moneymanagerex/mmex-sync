import fs from 'fs';
import { ConfigManager } from './config/ConfigManager.js';
import { DatabaseService } from './database/DatabaseService.js';
import { RemoteServiceFactory } from './api/RemoteServiceFactory.js';
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
        console.log("Server Type: " + (config.serverType || 'pocketbase'));
        console.log("URL: " + config.pbUrl);
        console.log("User: " + config.pbUser);
        console.log("MMEX Path: " + config.mmexExe);

        // --- SERVICES INITIALIZATION ---
        const db = new DatabaseService(config.dbPath, args.verbose);

        db.connect(args.create);

        const remoteService = RemoteServiceFactory.create(config.serverType, config.pbUrl);

        if (config.pbPass) { // password is supplied invalidate any token
            console.log("🔑 Authenticating with password...");
            remoteService.invalidateToken();
            await remoteService.authenticate(config.pbUser, config.pbPass);
            config.token = remoteService.getToken();
            config.pbAuthCollection = remoteService.authCollection;
            configMgr.updateConfig(config);
        } else if (config.token) {
            remoteService.setToken(config.token);
            remoteService.authCollection = config.pbAuthCollection;
            try {
                await remoteService.refreshToken(); // Esegue l'authRefresh() interno
                // Salva il nuovo token generato dal server
                config.token = remoteService.getToken();
                await configMgr.updateConfig(config);
            } catch (refreshErr) {
                console.warn("⚠️ Token refresh failed on server. Clearing saved token.");
                config.token = null;
                await configMgr.updateConfig(config);
                throw new Error("Session expired on server. Please run again providing your password.");
            }
        } else {
            throw new Error("No authentication method found. Please provide a password.");
        }

        const sync = new SyncService(db, remoteService, configMgr, args);

        if (args.clearServer) {
            const { confirm } = await enquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to clear ALL data on the remote server?'
            });
            if (confirm) await remoteService.clearRemoteServer();
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
            console.warn(`⚠️ MMEX executable not found at path: ${config.mmexExe}. Switching to sync mode.`);
            mode = 'sync';
        }

        // 1. Mandatory init (Triggers & Columns) as in the old core
        db.initSchema();

        // --- LOGIC EXECUTION ---
        switch (mode) {
            case 'watch':
                // Initial cycle -> Start Watcher -> Launch MMEX (waiting) -> Stop Watcher -> Final cycle
                await sync.runSyncCycle();
                const watcher = new WatcherService(db, remoteService, sync, config);
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