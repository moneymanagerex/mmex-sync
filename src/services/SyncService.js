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
     * PUSH: Sends local changes to the server
     * Integrates fallback logic: Update -> if it fails -> Create
     */
    async pushTable(table) {
        const dirtyRecords = this.db.getDirtyRecords(table, this.options.force);
        if (dirtyRecords.length === 0) return;

        // console.log(`[Push] ${table}: elaborazione di ${dirtyRecords.length} record ${this.options.force ? '(MODALITÀ FORZATA)' : ''}`);
        const progress = new ProgressBarService(dirtyRecords.length)

        for (let record of dirtyRecords) {
            progress.update(`[Push] ${table}`);
            if (!record.pb_updated_at) {
                record.pb_updated_at = new Date().toISOString();
            }
            record._updated_at = record.pb_updated_at;
            delete record.pb_updated_at;
            const { rowid, pb_id, pb_is_dirty, ...dataToSync } = record;
            let response;

            try {
                // 1. State 2: We signal to the DB that we are working on this record
                // this.db.setPendingStatus(table, record.rowid);

                if (pb_id) {
                    try {
                        // Attempts the update
                        response = await this.pb.update(table, pb_id, dataToSync);
                    } catch (err) {
                        // If update fails (e.g., 404), attempt creation
                        if (err.status === 404) {
                            if (this.options.verbose) console.log(`[Push] Update failed for ${pb_id}, trying to recreate...`);
                            response = await this.pb.create(table, dataToSync);
                        } else if (err.status === 409 || (err.response && err.response.status === 409)) {
                            if (this.options.verbose) console.log(`[Push] 409 Conflict for ${table} (rowid: ${record.rowid}), downloading remote record...`);
                            const remoteRecord = await this.pb.getById(table, pb_id);
                            if (remoteRecord) {
                                this.db.applyRemoteChanges(table, remoteRecord);
                                if (this.options.verbose) {
                                    console.log(`[Push] Resolved 409 conflict: updated local database and cleared dirty flag for ${table} (rowid: ${record.rowid})`);
                                }
                            } else {
                                console.error(`❌ Critical push error on ${table} (rowid: ${record.rowid}): Remote record not found for 409 conflict resolution.`);
                            }
                            continue;
                        } else {
                            throw err;
                        }
                    }
                } else {
                    // New record never seen by the server
                    response = await this.pb.create(table, dataToSync);
                }

                // 2. Success: State 0 and ID saving (new or confirmed)
                if (response.id != null) {
                    // verify if I need to update the pb_id or not
                    if (pb_id != response.id) {
                        this.db.setSyncedStatus(table, record.rowid, response.id);
                    }
                } else {
                    console.log(`❌ Critical push error on ${table} (rowid: ${record.rowid}): ID not returned.`);
                }

            } catch (err) {
                let isUniqueValidationError = false;
                if (err && err.response && err.response.data) {
                    isUniqueValidationError = Object.values(err.response.data).some(
                        fieldError => fieldError && fieldError.code === 'validation_not_unique'
                    );
                }

                if (isUniqueValidationError) {
                    if (table === 'TAGLINK_V1') {
                        const { REFTYPE, REFID, TAGID } = record;
                        let remoteRecord;
                        try {
                            remoteRecord = await this.pb.getRemoteRecordByUniqueKeys(table, { REFTYPE, REFID, TAGID });
                        } catch (queryErr) {
                            if (queryErr.status !== 404) {
                                console.error(`❌ Critical push error on ${table} (rowid: ${record.rowid}) taglink query failed:`, queryErr.message);
                            }
                        }
                        if (remoteRecord) {
                            this.db.resolveTagLinkConflict(record.rowid, remoteRecord);
                            if (this.options.verbose) {
                                console.log(`[Push] Resolved conflict for ${table} (rowid: ${record.rowid}) using remote TAGLINKID: ${remoteRecord.TAGLINKID}`);
                            }
                        } else {
                            console.error(`❌ Critical push error on ${table} (rowid: ${record.rowid}) taglink not found on remote server.`);
                        }
                    } else {
                        // search for pk
                        let remoteRecord;
                        try {
                            remoteRecord = await this.pb.getByRowId(table, record.rowid);
                        } catch (err) {
                            console.error(`❌ Critical push error on ${table} (rowid: ${record.rowid}) not found and probabily unique constraint violation`, err.message);
                        }
                        if (remoteRecord) {
                            response = await this.pb.update(table, remoteRecord.id, dataToSync);
                            if (response.id != null) {
                                if (this.options.verbose) console.log(`[Push] Updated ${table} (rowid: ${record.rowid}) with pb_id: ${response.id}`);
                                this.db.setSyncedStatus(table, record.rowid, response.id);
                            } else {
                                console.log(`❌ Critical push error on ${table} (rowid: ${record.rowid}): ID not returned.`);
                            }
                        }
                    }
                } else {
                    console.error(`❌ Critical push error on ${table} (rowid: ${record.rowid}):`, err ? err.message : 'Unknown error');
                }
            }
        }
    }

    /**
     * PULL: Applies remote changes
     */
    async pullTable(table) {
        let result = true;
        const lastSyncDate = this.options.force ? null :
            (new Date(new Date(this.configMgr.config.lastSync).getTime() - 5000).toISOString());

        let filter = '';
        if (lastSyncDate) {
            filter = `_updated_at > "${lastSyncDate.replace('T', ' ').split('.')[0]}"`;
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
                    console.error(`\n❌ applyRemoteChanges error on ${table} (pb_id: ${remote.id}, pk: ${remote[this.db.schemas[table].pk]}):`, err.message);
                }
            }
            this.db.resetUnfinishedOps(table);
        } catch (err) {
            result = false;
            console.error(`❌ Pull error on ${table}:`, err.message);
        }
        return result;
    }

    /**
     * DELETE: Synchronizes local deletions to the server
     */
    async syncDeletions() {
        const log = this.db.getDeletedLog() || [];
        if (log.length === 0) return;

        for (const item of log) {
            const tableName = item.table_name || item.TABLE_NAME;
            const pbId = item.pb_id || item.PB_ID;

            try {
                await this.pb.update(tableName, pbId, { _is_deleted: 1 });
                this.db.removeDeletedRecordLog(tableName, pbId);
            } catch (err) {
                // If it's 404 it's already gone on server, we can remove it from local log
                if (err.status === 404) {
                    this.db.removeDeletedRecordLog(tableName, pbId);
                } else {
                    console.error(`⚠️ Error during remote soft-delete of ${pbId}:`, err.message);
                }
            }
        }
    }

    async runSyncCycle() {
        const syncParam = this.options.sync; // Can be true or a string "init,pull"

        // Define available operations
        const ops = {
            init: false,
            push: false,
            pull: false
        };

        if (syncParam === true || syncParam === undefined) {
            // If --sync has no arguments, do everything
            ops.init = ops.push = ops.pull = true;
        } else if (typeof syncParam === 'string') {
            // If --sync=init,pull, split and activate only those
            const requested = syncParam.split(',').map(s => s.trim().toLowerCase());
            ops.init = requested.includes('init');
            ops.push = requested.includes('push');
            ops.pull = requested.includes('pull');
        }

        console.log(`🚀 Starting Synchronization: [${Object.keys(ops).filter(k => ops[k]).join(' + ')}]`);

        // 1. INIT: Schema, triggers, and columns regeneration
        if (ops.init) {
            // done in main. here only for reference
        }

        // 2. PUSH: Local changes sending (State 1 -> State 0/2)
        if (ops.push) {
            console.log("📤 Operation: PUSH (Local -> Remote)");
            
            // Sync local deletions first
            console.log("[Sync Deletions] Synchronizing local deletions to the server...");
            await this.syncDeletions();

            for (const table of SYNC_ORDER) {
                await this.pushTable(table);
            }
        }

        // 3. PULL: Remote changes receiving (lastSync filter)
        if (ops.pull) {
            let result = true;
            console.log("📥 Operation: PULL (Remote -> Local)");
            // save the time immediately so that next time I start from the beginning of sending and not the end
            // where maybe another client inserted a record in the meantime. 
            const newSyncTime = new Date().toISOString();
            for (const table of SYNC_ORDER) {
                result = result && await this.pullTable(table);
            }

            // Save the timestamp only after a completed pull without errors
            if (result) {
                this.configMgr.save({
                    ...this.configMgr.config,
                    lastSync: newSyncTime
                });
            }
        }

        console.log("✅ Cycle completed.");
    }

}