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
     * Starts combined monitoring
     */
    async start() {
        console.log("👀 Watcher started: monitoring changes...");

        // 1. Local Watch (Chokidar on the SQLite file)
        const fileWatcher = chokidar.watch(this.config.dbPath, {
            persistent: true,
            awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }
        });

        fileWatcher.on('change', () => {
            console.log("📝 Local change detected (MMEX).");
            this._triggerSync('local');
        });

		try {
			await this.pb.subscribe(null, (e) => {
				console.log(`🌐 Remote change: ${e.collection} [${e.action}]`);
				this._triggerSync('remote');
			});
		} catch (err) {
			console.error("❌ Realtime error:", err.message);
		}
    }

    /**
     * Trigger orchestrator with debounce
     * Avoids launching overlapping synchronizations
     */
    _triggerSync(source) {
        if (this.isSyncing) return;

        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        this.debounceTimer = setTimeout(async () => {
            this.isSyncing = true;
            try {
                // We execute the cycle defined in SyncService
                // SyncService will use state 2 (Pending) to handle conflicts
                await this.sync.fullCycle();
            } catch (err) {
                console.error(`❌ Error during automatic sync (${source}):`, err.message);
            } finally {
                this.isSyncing = false;
            }
        }, 1500); // Wait 1.5 seconds of silence before acting
    }
}