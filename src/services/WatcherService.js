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
        this.ignoreNextLocalChange = false;
        this.fileWatcher = null;
    }

    /**
     * Starts combined monitoring
     */
    async start() {
        console.log("👀 Watcher started: monitoring changes...");

        // 1. Local Watch (Chokidar on the SQLite file)
        this.fileWatcher = chokidar.watch(this.config.dbPath, {
            persistent: true,
            usePolling: true,
            interval: 5000,
            awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 500 }
        });

        this.fileWatcher.on('change', () => {
            if (this.ignoreNextLocalChange) {
                this.ignoreNextLocalChange = false;
                return;
            }
            if (this.isSyncing) return;

            console.log("📝 Local change detected (MMEX).");
            this._triggerSync('local');
        });

        try {
            await this.pb.subscribe(null, (e) => {
                console.log(`🌐 Remote change: ${e.collection} [${e.action}]`);
                this._triggerSync('remote', 5000);
            });
        } catch (err) {
            console.error("❌ Realtime error:", err.message);
        }
    }

    /**
     * Stops monitoring
     */
    async stop() {
        if (this.fileWatcher) {
            await this.fileWatcher.close();
            console.log("🛑 Local watcher stopped.");
        }
        try {
            await this.pb.unsubscribeAll();
            console.log("🛑 Remote watcher unsubscribed.");
        } catch (err) {
            console.error("❌ Error during unsubscribe:", err.message);
        }
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
    }

    /**
     * Trigger orchestrator with debounce
     * Avoids launching overlapping synchronizations
     */
    _triggerSync(source, delay = 2000) {
        if (this.isSyncing) return;

        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        this.debounceTimer = setTimeout(async () => {
            this.isSyncing = true;
            this.ignoreNextLocalChange = true;
            try {
                // We execute the cycle defined in SyncService
                // SyncService will use state 2 (Pending) to handle conflicts
                await this.sync.runSyncCycle();
            } catch (err) {
                console.error(`❌ Error during automatic sync (${source}):`, err.message);
            } finally {
                this.isSyncing = false;
            }
        }, delay); // Wait 'delay' milliseconds of silence before acting
    }
}