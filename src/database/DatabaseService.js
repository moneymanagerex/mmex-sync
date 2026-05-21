// src/database/DatabaseService.js
import fs from 'fs';
import Database from 'better-sqlite3';
import { SYNC_ORDER } from '../config/table_config.js';


export class DatabaseService {
    constructor(dbPath, verbose = false) {
        this.dbPath = dbPath;
        this.verbose = verbose;
        this.db = null;
        this.syncOrder = SYNC_ORDER;
    }

    connect(create = false) {
        if (!fs.existsSync(this.dbPath) || create) {
            // if not exists create
            this.createEmptyDatabase();
        } else {
            // this.db = new Database(this.dbPath, { verbose: this.verbose ? console.log : null });
            this.db = new Database(this.dbPath);
        }

        // TODO: remove PK from fields (because we have pk in separatd fields.)
        this.schemas = {};
        for (const table of this.syncOrder) {
            const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
            const pk = columns.find(col => col.pk === 1).name;
            const fields = columns.filter(col => ![pk, 'pb_id', 'pb_is_dirty', 'pb_updated_at'].includes(col.name)).map(col => col.name);
            const techFields = columns.filter(col => ['pb_id', 'pb_is_dirty', 'pb_updated_at'].includes(col.name)).map(col => col.name);
            this.schemas[table] = { pk, fields, techFields };
        }
        return this;
    }

    /**
     * Restores your initialization logic exactly
     */
    initSchema() {
        this.db.transaction(() => {
            // 1. Deletion log table (as in your sync_core)
            this.db.prepare(`
                CREATE TABLE IF NOT EXISTS pb_DELETED_RECORDS_LOG (
                    TABLE_NAME TEXT,
                    PB_ID TEXT,
                    DELETED_AT DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `).run();

            for (const table of this.syncOrder) {
                this._ensureTechnicalColumns(table);
                this._createTriggers(table);
            }
        })();
    }

    _ensureTechnicalColumns(table) {
        const columns = this.schemas[table].techFields;
        if (!columns.includes('pb_id')) {
            this.db.prepare(`ALTER TABLE ${table} ADD COLUMN pb_id TEXT`).run();
        }
        if (!columns.includes('pb_is_dirty')) {
            this.db.prepare(`ALTER TABLE ${table} ADD COLUMN pb_is_dirty INTEGER DEFAULT 0`).run();
        }
        if (!columns.includes('pb_updated_at')) {
            this.db.prepare(`ALTER TABLE ${table} ADD COLUMN pb_updated_at TEXT`).run();
        }
    }

    /**
     * ORIGINAL TRIGGERS: we keep the state '1' logic
     * and loop prevention (WHEN NEW.pb_is_dirty != 2)
     */
    _createTriggers(table) {

        // Trigger Insert
        this.db.prepare(`
            CREATE TRIGGER IF NOT EXISTS TRG_${table}_INSERT
            AFTER INSERT ON ${table}
            FOR EACH ROW WHEN NEW.pb_is_dirty IS NOT 2
            BEGIN
                UPDATE ${table} SET pb_is_dirty = 1,
                       pb_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW')
                       WHERE ROWID = NEW.ROWID;
            END
        `).run();

        const nonTechnicalColumnsString = this.schemas[table].fields.join(', ');
        // Trigger Update
        this.db.prepare(`
            CREATE TRIGGER IF NOT EXISTS TRG_${table}_UPDATE
            AFTER UPDATE OF ${nonTechnicalColumnsString} ON ${table}
            WHEN (NEW.pb_is_dirty != 2) 
            BEGIN
                UPDATE ${table} SET pb_is_dirty = 1, 
                       pb_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW') 
                       WHERE ROWID = NEW.ROWID;
            END
        `).run();


        // Delete Trigger (Logic faithful to your sync_core)
        this.db.prepare(`
            CREATE TRIGGER IF NOT EXISTS TRG_${table}_DELETE
            BEFORE DELETE ON ${table}
            FOR EACH ROW
            WHEN OLD.pb_id IS NOT NULL
            BEGIN
                INSERT INTO pb_DELETED_RECORDS_LOG (TABLE_NAME, PB_ID) VALUES ('${table}', OLD.pb_id);
            END
        `).run();
    }

    // --- SyncService methods respecting the 3-level state ---

    /**
     * Retrieves records to be synchronized.
     * @param {string} table - Table name
     * @param {boolean} force - If true, ignores the pb_is_dirty flag and returns everything
     */
    getDirtyRecords(table, force = false) {
        const baseSelect = `SELECT *, ROWID as rowid FROM ${table}`;
        if (force) {
            // If we force push, we take all records that have a pb_id 
            // (or all if we want to populate the server from scratch)
            return this.db.prepare(baseSelect).all();
        } else {
            // Standard logic: only those marked locally
            return this.db.prepare(`${baseSelect} WHERE pb_is_dirty = 1 OR pb_id = '' OR pb_id IS NULL`).all();
        }
    }

    setPendingStatus(table, rowid) {
        this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 2 WHERE ROWID = ?`).run(rowid);
    }

    setSyncedStatus(table, rowid, pbId) {
        this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 0, pb_id = ? WHERE ROWID = ?`).run(pbId, rowid);
    }

    //    closeSyncOperation(table) {
    //        this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 0 WHERE pb_is_dirty = 2`).run();
    //    }

    resetUnfinishedOps(table) {
        this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 1 WHERE pb_is_dirty = 2`).run();
    }

    setDirtyStatus(table, rowid) {
        this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 1 WHERE ROWID = ?`).run(rowid);
    }

    removeRecord(table, rowid) {
        this.db.prepare(`DELETE FROM ${table} WHERE ROWID = ?`).run(rowid);
    }

    /**
     * Applies remote changes to the local database.
     * Manages upsert based on pb_id.
     */
    applyRemoteChanges(table, remoteRecord) {
        let { id, _is_deleted, _updated_at, ...data } = remoteRecord;
        // uf _updated_at is null set to now
        if (!_updated_at) {
            _updated_at = new Date().toISOString();
        }
        const pb_id = id;
        const is_deleted = _is_deleted != 0;

        // Check if a record with this pb_id already exists
        let localRecord = this.db.prepare(`SELECT ROWID as ROWID FROM ${table} WHERE pb_id = ?`).get(pb_id);
        const localRecordPk = localRecord?.ROWID;

        this.db.transaction(() => {
            if (localRecord) {
                // check to see if it is deleted
                if (is_deleted) {
                    this.removeRecord(table, localRecord.rowid);
                } else {
                    // UPDATE 
                    const keys = this.schemas[table].fields;
                    const setClause = keys.map(k => `${k} = ?`).join(', ');
                    const values = keys.map(k => data[k]);

                    // Add state 2 to bypass local triggers
                    this.db.prepare(`
                        UPDATE ${table} 
                        SET ${setClause}, pb_is_dirty = 2, pb_updated_at = ?
                        WHERE ROWID = ?
                    `).run(...values, _updated_at, localRecordPk); // was localRecord.rowid

                    // Reset to 0 (Synchronized)
                    this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 0 WHERE ROWID = ?`).run(localRecordPk);

                    if (this.verbose) console.log(`[DB] Updated ${table} (pb_id: ${pb_id})`);
                }
            } else {
                if (!is_deleted) {
                    // if not deleted, insert
                    const keys = this.schemas[table].fields;
                    const pk = this.schemas[table].pk;
                    const columns = [pk, ...keys, 'pb_id', 'pb_is_dirty', 'pb_updated_at'].join(', ');
                    const placeholders = ['?', ...keys.map(() => '?'), '?', '2', '?'].join(', ');
                    const values = [data[pk], ...keys.map(k => data[k]), pb_id, _updated_at];

                    const result = this.db.prepare(`
                        INSERT INTO ${table} (${columns}) 
                        VALUES (${placeholders})
                     `).run(...values);

                    const localRecordPk = result.lastInsertRowid;
                    // Reset to 0
                    this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 0 WHERE ROWID = ?`).run(localRecordPk);

                    if (this.verbose) console.log(`[DB] Inserted ${table} (pb_id: ${pb_id})`);
                }
            }
        })();
    }

    getDeletedLog() {
        return this.db.prepare(`SELECT * FROM DELETED_LOG`).all();
    }

    clearDeletedLog() {
        this.db.prepare(`DELETE FROM DELETED_LOG`).run();
    }

    close() {
        if (this.db) this.db.close();
    }

    /**
     * Safely removes the technical schema (Order: Triggers -> Tables -> Columns)
     */
    clearTechnicalSchema() {
        console.log("🧹 Starting deep cleanup of local database...");

        this.db.transaction(() => {
            for (const table of this.syncOrder) {
                // 1. TRIGGER REMOVAL (Always first)
                // We must delete triggers that "point" to technical tables
                this.db.prepare(`DROP TRIGGER IF EXISTS TRG_${table}_INSERT`).run();
                this.db.prepare(`DROP TRIGGER IF EXISTS TRG_${table}_UPDATE`).run();
                this.db.prepare(`DROP TRIGGER IF EXISTS TRG_${table}_DELETE`).run();

                if (this.verbose) console.log(`[Clean] Triggers removed for: ${table}`);

                // 2. COLUMN REMOVAL
                for (const column of this.schemas[table].techFields) {
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN ${column}`).run();
                    if (this.verbose) console.log(`[Clean] Column ${column} removed for: ${table}`);
                }

                /*
                try {
                    // Remove pb_id and pb_is_dirty columns
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN pb_id`).run();
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN pb_is_dirty`).run();
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN pb_updated_at`).run();
                } catch (e) {
                    // Fallback: if the SQLite version doesn't support DROP COLUMN, 
                    // the data will remain but will be inert without the triggers.
                    console.log(`[Info] Note: Columns on ${table} not removed (SQLite < 3.35.0)`);
                    if (this.verbose) console.log(`[Error] ${e}`);
                }
*/
            }

            // 3. TECHNICAL TABLE REMOVAL
            // Now that no more triggers point to this table, we can delete it
            this.db.prepare(`DROP TABLE IF EXISTS pb_DELETED_RECORDS_LOG`).run();

            if (this.verbose) console.log(`[Clean] Technical tables removed.`);
        })();

        console.log("✅ Cleanup completed successfully.");
    }

    /**
     * Creates a new MMEX database starting from the external SQL schema
     */
    createEmptyDatabase() {
        console.log(`🏗️  [Create] Creating new database: ${this.dbPath}`);

        // 1. Read and execute the table_v1.sql file
        // The file must be in the project root or we specify the path
        let sqlSchemaPath = './assets/sql/tables_v1_for_sync.sql';
        if (!fs.existsSync(sqlSchemaPath)) {
            sqlSchemaPath = './tables_v1_for_sync.sql';
            if (!fs.existsSync(sqlSchemaPath)) {
                throw new Error(`File schema non trovato: ${sqlSchemaPath}`);
            }
        }

        // Removes the file if it already exists for a clean creation (as in your original code)
        if (fs.existsSync(this.dbPath)) {
            if (this.verbose) console.log("[Create] Removing existing database file...");
            fs.unlinkSync(this.dbPath);
        }

        try {
            // Open a new connection
            // this.db = new Database(this.dbPath, { verbose: this.verbose ? console.log : null });
            this.db = new Database(this.dbPath);

            const sqlSchema = fs.readFileSync(sqlSchemaPath, 'utf8');

            // Execute everything in a transaction for maximum performance and safety
            this.db.transaction(() => {
                this.db.exec(sqlSchema);

                // 2. Set PRAGMA user_version to 21 (essential for MMEX compatibility)
                this.db.pragma('user_version = 21');

                if (this.verbose) console.log("[Create] SQL schema applied and user_version set to 21.");

            })();

            // not needed. will be done later
            // 3. Immediately initialize triggers and technical columns pb_id/pb_is_dirty
            // this.initSchema();

            console.log("✅ Database created and ready for synchronization.");
            return this.db;

        } catch (err) {
            console.error("❌ [Create] Critical error during database creation:", err.message);
            if (this.verbose) console.log(err);
            if (this.db) this.db.close();
            throw err;
        }
    }


}