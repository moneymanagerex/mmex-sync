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
import { waitForExit } from './utils/waitForExit.js';

let configMgr = null;
let config = null;
let hasAcquiredRunning = false;
let isExiting = false;

async function exitProgram(code = 0) {
    if (isExiting) return;
    isExiting = true;

    if (hasAcquiredRunning && configMgr && config) {
        try {
            config.isRunning = false;
            configMgr.save(config);
            hasAcquiredRunning = false;
        } catch (err) {
            console.error(`⚠️ Failed to reset isRunning flag on exit: ${err.message}`);
        }
    }
    await waitForExit({ noWait: args.nowait });
    process.exit(code);
}

process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT. Exiting...');
    await exitProgram(0);
});

process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM. Exiting...');
    await exitProgram(0);
});


// 1. Argument parsing (internal or external utility)
const rawArgs = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    const cleanKey = key.replace('--', '');
    acc[cleanKey] = value !== undefined ? value : true;
    return acc;
}, {});

const args = new Proxy(rawArgs, {
    get(target, prop) {
        if (typeof prop === 'string') {
            const lowerProp = prop.toLowerCase();
            const foundKey = Object.keys(target).find(k => k.toLowerCase() === lowerProp);
            if (foundKey !== undefined) {
                return target[foundKey];
            }
        }
        return target[prop];
    },
    has(target, prop) {
        if (typeof prop === 'string') {
            const lowerProp = prop.toLowerCase();
            return Object.keys(target).some(k => k.toLowerCase() === lowerProp);
        }
        return prop in target;
    },
    ownKeys(target) {
        return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
    }
});


async function main() {
    if (args.help) {
        showHelp();
        await exitProgram(0);
    }

    if (args.version) {
        try {
            console.log(`mmex-sync v${__APP_VERSION__}`);
        }
        catch (err) {
            // fail silently if __APP_VERSION__ is not defined (build time)
            console.log(`unknow version`);
        }
        await exitProgram(0);
    }

    if (args.checkForUpdate || args.autoDownloadUpdate) {
        try {
            const { UpdateService } = await import('./services/UpdateService.js');
            const updateService = new UpdateService(args);
            if (args.checkForUpdate) {
                await updateService.checkForUpdate();
            } else {
                await updateService.autoDownloadUpdate();
            }
        } catch (err) {
            console.error(`❌ Error during update execution: ${err.message}`);
        }
        return;
    }

    if (args.listProfile) {
        const configMgrInstance = new ConfigManager(args);
        configMgrInstance.listProfiles();
        await exitProgram(0);
    }

    if (args.showProfile) {
        const configMgrInstance = new ConfigManager(args);
        const profileName = typeof args.showProfile === 'string' ? args.showProfile : undefined;
        configMgrInstance.showProfile(profileName);
        await exitProgram(0);
    }

    if (args.setDefaultMode) {
        const configMgrInstance = new ConfigManager(args);
        const success = configMgrInstance.setDefaultMode(args.setDefaultMode);
        await exitProgram(success ? 0 : 1);
    }

    try {
        // --- CONFIGURATION INITIALIZATION ---
        configMgr = new ConfigManager(args);
        config = await configMgr.getEffectiveConfig();

        // get full path of db
        const newDbPath = path.resolve(config.dbPath);
        if (newDbPath != config.dbPath) {
            config.dbPath = newDbPath;
            // save config
            await configMgr.save(config);
        }

        // show all relevant parametert from configuration
        const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown';
        console.log(`mmex-sync: v: ${appVersion}`);
        console.log("Path DB: " + config.dbPath);
        console.log("Server Type: " + (config.serverType || 'pocketbase'));
        console.log("URL: " + config.pbUrl);
        console.log("User: " + config.pbUser);
        console.log("MMEX Path: " + config.mmexExe);
        console.log("Profile: " + config.profileName);

        if (config.isRunning) {
            const { confirm } = await enquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'It seems another instance is running. Running two instances concurrently is dangerous. Are you sure you want to proceed?'
            });
            if (!confirm) {
                await exitProgram(0);
            }
        }

        // --- SERVICES INITIALIZATION ---
        config.isRunning = true;
        hasAcquiredRunning = true;
        configMgr.save(config);

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
            await exitProgram(0);
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
                break;

            case 'run':
                // Initial cycle -> Launch MMEX (waiting) -> Final cycle
                await sync.runSyncCycle();
                await launchMMEX(config.mmexExe, config.dbPath, false);
                console.log("📝 MMEX closed. Executing final synchronization...");
                await sync.runSyncCycle();
                break;

            case 'sync':
            default:
                // await sync.fullCycle();
                // Executes only requested parts (e.g., --push --pull)
                await sync.runSyncCycle();
                break;
        }

        await exitProgram(0);

    } catch (err) {
        console.error(`\n❌ CRITICAL ERROR: ${err.message}`);
        if (args.verbose) console.error(err.stack);
        await exitProgram(1);
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