// src/services/WatcherService.js

import chokidar from 'chokidar';

export class WatcherService {
    constructor(dbService, pbService, syncService, config) {
        this.db = dbService;
        this.pb = pbService;
        this.sync = syncService;
        this.config = config;
        
        this.isSyncing = false;
        this.debounceTimer = null;
    }

    /**
     * Avvia il monitoraggio combinato
     */
    async start() {
        console.log("👀 Watcher avviato: monitoraggio modifiche in corso...");

        // 1. Watch Locale (Chokidar sul file SQLite)
        const fileWatcher = chokidar.watch(this.config.dbPath, {
            persistent: true,
            awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }
        });

        fileWatcher.on('change', () => {
            console.log("📝 Modifica locale rilevata (MMEX).");
            this._triggerSync('local');
        });

		try {
			await this.pb.subscribe(null, (e) => {
				console.log(`🌐 Modifica remota: ${e.collection} [${e.action}]`);
				this._triggerSync('remote');
			});
		} catch (err) {
			console.error("❌ Errore Realtime:", err.message);
		}
    }

    /**
     * Orchestratore del trigger con debounce
     * Evita di lanciare sincronizzazioni sovrapposte
     */
    _triggerSync(source) {
        if (this.isSyncing) return;

        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        this.debounceTimer = setTimeout(async () => {
            this.isSyncing = true;
            try {
                // Eseguiamo il ciclo che abbiamo definito nel SyncService
                // Il SyncService userà lo stato 2 (Pending) per gestire i conflitti
                await this.sync.fullCycle();
            } catch (err) {
                console.error(`❌ Errore durante il sync automatico (${source}):`, err.message);
            } finally {
                this.isSyncing = false;
            }
        }, 1500); // Aspetta 1.5 secondi di silenzio prima di agire
    }
}