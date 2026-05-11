import fs from 'fs';
import { ConfigManager } from './config/ConfigManager.js';
import { DatabaseService } from './database/DatabaseService.js';
import { PocketBaseService } from './api/PocketBaseService.js';
import { SyncService } from './services/SyncService.js';
import { WatcherService } from './services/WatcherService.js';
import { spawn } from 'child_process';
import { showHelp } from './cli/help.js';
import enquirer from 'enquirer';


// 1. Parsing degli argomenti (utility interna o esterna)
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

    try {
        // --- INIZIALIZZAZIONE CONFIGURAZIONE ---
        const configMgr = new ConfigManager(args);
        const config = await configMgr.getEffectiveConfig();

        // show all relevant parametert from configuration
        console.log("Path DB: " + config.dbPath);
        console.log("URL: " + config.pbUrl);
        console.log("User: " + config.pbUser);
        console.log("MMEX Path: " + config.mmexExe);

        // --- INIZIALIZZAZIONE SERVIZI ---
        const db = new DatabaseService(config.dbPath, args.verbose);
        db.connect(args.create);

        const pb = new PocketBaseService(config.pbUrl);

        if (config.pbPass || !config.token) { // password is supplied invalidate any token
            pb.invalidateToken();
            await pb.authenticate(config.pbUser, config.pbPass);
            configMgr.save(config, pb.getToken());
        } else {
            pb.setToken(config.token);
        }

        // todo gestire refresh del token quando scade

        const sync = new SyncService(db, pb, configMgr, args);

        if (args.clearServer) {
            const { confirm } = await enquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Sei sicuro di voler svuotare TUTTI i dati sul server PocketBase?'
            });
            if (confirm) await pb.clearRemoteServer();
        }

        if (args.clearDb) {
            const { confirm } = await enquirer.prompt({
                type: 'confirm',
                name: 'confirm',
                message: 'Sei sicuro di voler rimuovere TUTTE le tabelle tecniche sul database locale?'
            });
            if (confirm) db.clearTechnicalSchema();
        }

        if (args.clearServer || args.clearDb) {
            process.exit(0);
        }

        // --- DETERMINAZIONE MODALITÀ ---
        let mode = args.watch ? 'watch' : (args.run ? 'run' : (args.sync ? 'sync' : config.defaultMode));
        console.log(`🚀 MMEX-Sync | Profilo: ${configMgr.profile} | Modo: ${mode.toUpperCase()}`);

        if ((mode === 'run' || mode === 'watch') && !fs.existsSync(config.mmexExe)) {
            throw new Error(`Eseguibile MMEX non trovato al percorso: ${config.mmexExe}. Usa --exe per specificarlo.`);
        }

        // 1. Init obbligatorio (Triggers & Columns) come nel vecchio core
        db.initSchema();

        // --- ESECUZIONE LOGICA ---
        switch (mode) {
            case 'watch':
                // Ciclo iniziale -> Lancio MMEX (detached) -> Avvio Watcher
                await sync.runSyncCycle();
                launchMMEX(config.mmexExe, config.dbPath, true);
                const watcher = new WatcherService(db, pb, sync, config);
                await watcher.start();
                break;

            case 'run':
                // Ciclo iniziale -> Lancio MMEX (attesa) -> Ciclo finale
                await sync.runSyncCycle();
                await launchMMEX(config.mmexExe, config.dbPath, false);
                console.log("📝 MMEX chiuso. Eseguo sincronizzazione finale...");
                await sync.runSyncCycle();
                process.exit(0);
                break;

            case 'sync':
            default:
                // await sync.fullCycle();
                // Esegue solo le parti richieste (es: --push --pull)
                await sync.runSyncCycle();
                process.exit(0);
        }

    } catch (err) {
        console.error(`\n❌ ERRORE CRITICO: ${err.message}`);
        if (args.verbose) console.error(err.stack);
        process.exit(1);
    }
}

/**
 * Helper per l'avvio di MMEX
 */
function launchMMEX(exePath, dbPath, detached) {
    console.log(`\n=== Avvio MMEX: ${exePath} ===`);
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

// Avvio applicazione
main();