// src/services/SyncService.js

import { SYNC_ORDER } from '../config/table_config.js';
import { ProgressBarService } from './../utils/ProgressBarService.js';


export class SyncService {
    constructor(dbService, pbService, configManager, options = {}) {
        this.db = dbService;
        this.pb = pbService;
        this.configMgr = configManager;
        this.options = options;
    }

    /**
     * PUSH: Invia le modifiche locali al server
     * Integra la logica di fallback: Update -> se fallisce -> Create
     */
    async pushTable(table) {
        const dirtyRecords = this.db.getDirtyRecords(table, this.options.force);
        if (dirtyRecords.length === 0) return;

        // console.log(`[Push] ${table}: elaborazione di ${dirtyRecords.length} record ${this.options.force ? '(MODALITÀ FORZATA)' : ''}`);
        const progress = new ProgressBarService(dirtyRecords.length)

        for (const record of dirtyRecords) {
            progress.update(`[Push] ${table}`);
            const { rowid, pb_id, pb_is_dirty, ...dataToSync } = record;
            let response;

            try {
                // 1. Stato 2: Segnaliamo al DB che stiamo lavorando questo record
                // this.db.setPendingStatus(table, record.rowid);

                if (pb_id) {
                    try {
                        // Tenta l'aggiornamento
                        response = await this.pb.update(table, pb_id, dataToSync);
                    } catch (err) {
                        // Se l'update fallisce (es. 404), tenta la creazione
                        if (err.status === 404) {
                            if (this.options.verbose) console.log(`[Push] Update fallito per ${pb_id}, provo a ricreare...`);
                            response = await this.pb.create(table, dataToSync);
                        } else {
                            throw err;
                        }
                    }
                } else {
                    // Nuovo record mai visto dal server
                    response = await this.pb.create(table, dataToSync);
                }

                // 2. Successo: Stato 0 e salvataggio dell'ID (nuovo o confermato)
                if (response.id != null) {
                    // verifico se devo aggiroanere il pb_id o no
                    if (pb_id != response.id) {
                        this.db.setSyncedStatus(table, record.rowid, response.id);
                    }
                } else {
                    console.log(`❌ Errore critico push su ${table} (rowid: ${record.rowid}): ID non ritornato.`);
                }

            } catch (err) {
                if (err && err.response && err.response.data && err.response.data._userid && err.response.data._userid.code == 'validation_not_unique') {
                    // serach for pk
                    const remoteRecord = await this.pb.getByRowId(table, record.rowid);
                    if (remoteRecord) {
                        response = await this.pb.update(table, remoteRecord.id, dataToSync);
                        if (response.id != null) {
                            if (this.options.verbose) console.log(`[Push] Aggiornato ${table} (rowid: ${record.rowid}) con pb_id: ${response.id}`);
                            this.db.setSyncedStatus(table, record.rowid, response.id);
                        } else {
                            // TODO: gestire al meglio
                            console.log(`❌ Errore critico push su ${table} (rowid: ${record.rowid}): ID non ritornato.`);
                        }
                    }
                } else {
                    console.error(`❌ Errore critico push su ${table} (rowid: ${record.rowid}):`, err.message);
                }
            }
        }
    }

    /**
     * PULL: Applica le modifiche remote
     */
    async pullTable(table) {
        let result = true;
        const lastSyncDate = this.options.force ? null : this.configMgr.config.lastSync;
        let filter = '';
        if (lastSyncDate) {
            // TODO: lastSyncDate need to be 5 seconds befor to be sure to download all latest chagne
            filter = `updated > "${lastSyncDate.replace('T', ' ').split('.')[0]}"`;
        }
        try {
            const remoteRecords = await this.pb.getFullList(table, filter);

            // console.log(`[Pull] ${table}: elaborazione di ${remoteRecords.length} record`);
            const progress = new ProgressBarService(remoteRecords.length)

            for (const remote of remoteRecords) {
                progress.update(`[Pull] ${table}`);
                try {
                    this.db.applyRemoteChanges(table, remote);
                } catch (err) {
                    result = false;
                    console.error(`\n❌ Errore applyRemoteChanges su ${table} (pb_id: ${remote.id}, pk: ${remote[this.db.schemas[table].pk]}):`, err.message);
                }
            }
            this.db.resetUnfinishedOps(table);
        } catch (err) {
            result = false;
            console.error(`❌ Errore pull su ${table}:`, err.message);
        }
        return result;
    }

    /**
     * DELETE: Sincronizza le cancellazioni locali verso il server
     */
    async syncDeletions() {
        const log = this.db.getDeletedLog();
        if (log.length === 0) return;

        for (const item of log) {
            try {
                await this.pb.delete(item.TABLE_NAME, item.PB_ID);
            } catch (err) {
                // Se è 404 è già sparito, ignoriamo l'errore e puliamo il log
                if (err.status !== 404) {
                    console.error(`⚠️ Errore durante DELETE remota di ${item.PB_ID}:`, err.message);
                }
            }
        }
        this.db.clearDeletedLog();
    }

    async runSyncCycle() {
        const syncParam = this.options.sync; // Può essere true o una stringa "init,pull"

        // Definiamo le operazioni disponibili
        const ops = {
            init: false,
            push: false,
            pull: false
        };

        if (syncParam === true || syncParam === undefined) {
            // Se --sync è senza argomenti, facciamo tutto
            ops.init = ops.push = ops.pull = true;
        } else if (typeof syncParam === 'string') {
            // Se --sync=init,pull, splittiamo e attiviamo solo quelle
            const requested = syncParam.split(',').map(s => s.trim().toLowerCase());
            ops.init = requested.includes('init');
            ops.push = requested.includes('push');
            ops.pull = requested.includes('pull');
        }

        console.log(`🚀 Avvio Sincronizzazione: [${Object.keys(ops).filter(k => ops[k]).join(' + ')}]`);

        // 1. INIT: Rigenerazione schema, trigger e colonne
        if (ops.init) {
            // fatto nel main. qui serve solo per referenza
        }

        // 2. PUSH: Invio modifiche locali (Stato 1 -> Stato 0/2)
        if (ops.push) {
            console.log("📤 Operazione: PUSH (Locale -> Remoto)");
            for (const table of SYNC_ORDER) {
                await this.pushTable(table);
            }
        }

        // 3. PULL: Ricezione modifiche remote (Filtro lastSync)
        if (ops.pull) {
            let result = true;
            console.log("📥 Operazione: PULL (Remoto -> Locale)");
            // salvo subito l'ora in modo che la volta prossima riprendo da inizio invio e non ala fine
            // dove magari un altro client ha inserito un record nel frattempo. 
            const newSyncTime = new Date().toISOString();
            for (const table of SYNC_ORDER) {
                result = result && await this.pullTable(table);
            }

            // Salviamo il timestamp solo dopo un pull completato e senza errori
            if (result) {
                this.configMgr.save({
                    ...this.configMgr.config,
                    lastSync: newSyncTime
                });
            }
        }

        console.log("✅ Ciclo completato.");
    }

}