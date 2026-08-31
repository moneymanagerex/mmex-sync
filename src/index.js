import fs from 'fs';
import os from 'os';
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
import { expandTildePath } from './utils/pathUtils.js';

let configMgr = null;
let config = null;
let hasAcquiredRunning = false;
let isExiting = false;

// List of all valid command line parameters
const VALID_PARAMETERS = [
    'profile',
    'ignoreProfile',
    'listProfile',
    'showProfile',
    'deleteProfile',
    'db',
    'filePassword',
    'saveFilePassword',
    'url',
    'user',
    'pass',
    'setDefaultProfile',
    'renameProfileTo',
    'setDefaultMode',
    'exe',
    'serverType',
    'create',
    'verbose',
    'sync',
    'force',
    'run',
    'watch',
    'checkForUpdate',
    'autoDownloadUpdate',
    'clearDb',
    'clearServer',
    'help',
    'version',
    'nowait'
];

/**
 * Validates command line parameters
 * @returns {string|null} Returns the name of the first invalid parameter, or null if all are valid
 */
function validateParameters(rawArgs) {
    for (const param of Object.keys(rawArgs)) {
        const lowerParam = param.toLowerCase();
        if (!VALID_PARAMETERS.some(vp => vp.toLowerCase() === lowerParam)) {
            return param;
        }
    }
    return null;
}

async function exitProgram(code = 0) {
    if (isExiting) return;
    isExiting = true;

    if (config) {
        config.filePassword = null;
    }
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
    // Get version for use in help and logging
    let version = 'unknown';
    try {
        version = __APP_VERSION__;
    } catch (err) {
        // __APP_VERSION__ is not defined (e.g., running in Node.js directly)
    }

    // Validate command line parameters
    const invalidParam = validateParameters(rawArgs);
    if (invalidParam) {
        console.error(`❌ wrong parameters: ${invalidParam}`);
        showHelp(version);
        await exitProgram(1);
    }

    if (args.help) {
        showHelp(version);
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

    if (args.deleteProfile) {
        const configMgrInstance = new ConfigManager(args);
        const profileName = typeof args.deleteProfile === 'string' ? args.deleteProfile : undefined;
        const success = configMgrInstance.deleteProfile(profileName);
        await exitProgram(success ? 0 : 1);
    }

    if (args.setDefaultProfile) {
        const configMgrInstance = new ConfigManager(args);
        const success = configMgrInstance.setDefaultProfile(args.setDefaultProfile);
        await exitProgram(success ? 0 : 1);
    }

    if (args.renameProfileTo) {
        const configMgrInstance = new ConfigManager(args);
        const success = configMgrInstance.renameProfile(args.renameProfileTo);
        await exitProgram(success ? 0 : 1);
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

        // Expand tilde in dbPath and get full path
        config.dbPath = expandTildePath(config.dbPath);
        const newDbPath = path.resolve(config.dbPath);
        if (newDbPath != config.dbPath) {
            config.dbPath = newDbPath;
            // save config
            await configMgr.save(config);
        }

        // Expand tilde in mmexExe path (in case user entered it via prompt in ConfigManager)
        config.mmexExe = expandTildePath(config.mmexExe);

        // show all relevant parametert from configuration
        const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '[nodejs version]';
        console.log(`mmex-sync: v${appVersion}`);
        console.log("Path DB: " + config.dbPath);
        console.log("Server Type: " + (config.serverType || 'pocketbase'));
        console.log("URL: " + config.pbUrl);
        console.log("User: " + config.pbUser);
        console.log("MMEX Path: " + config.mmexExe);
        console.log("Profile: " + configMgr.profile);

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

        const db = new DatabaseService(config.dbPath, args.verbose, config.filePassword);

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
            const { pass } = await enquirer.prompt({
                type: 'password',
                name: 'pass',
                message: `Password (${config.pbUser}):`
            });
            if (!pass) {
                throw new Error("No password provided.");
            }
            console.log("🔑 Authenticating with password...");
            remoteService.invalidateToken();
            await remoteService.authenticate(config.pbUser, pass);
            config.token = remoteService.getToken();
            config.pbAuthCollection = remoteService.authCollection;
            configMgr.updateConfig(config);
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

        if ((mode === 'run' || mode === 'watch') && (!config.mmexExe || !fs.existsSync(config.mmexExe))) {
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