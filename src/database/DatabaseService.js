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

        // this.db.pragma('journal_mode = WAL');

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
     * Ripristina esattamente la tua logica di inizializzazione
     */
    initSchema() {
        this.db.transaction(() => {
            // 1. Tabella log cancellazioni (come nel tuo sync_core)
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
     * TRIGGER ORIGINALI: manteniamo la logica dello stato '1' 
     * e la prevenzione del loop (WHEN NEW.pb_is_dirty != 2)
     */
    _createTriggers(table) {

        // Trigger Insert
        this.db.prepare(`
            CREATE TRIGGER IF NOT EXISTS TRG_${table}_INSERT
            AFTER INSERT ON ${table}
            FOR EACH ROW
            BEGIN
                UPDATE ${table} SET pb_is_dirty = 1 WHERE ROWID = NEW.ROWID;
            END
        `).run();

        const nonTechnicalColumnsString = this.schemas[table].fields.join(', ');
        // Trigger Update
        this.db.prepare(`
            CREATE TRIGGER IF NOT EXISTS TRG_${table}_UPDATE
            AFTER UPDATE OF ${nonTechnicalColumnsString} ON ${table}
            WHEN (NEW.pb_is_dirty != 2) 
            BEGIN
                UPDATE ${table} SET pb_is_dirty = 1 WHERE ROWID = NEW.ROWID;
            END
        `).run();


        // Trigger Delete (Logica fedele al tuo sync_core)
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

    // --- Metodi per il SyncService che rispettano lo stato a 3 livelli ---

    /**
     * Recupera i record da sincronizzare.
     * @param {string} table - Nome della tabella
     * @param {boolean} force - Se true, ignora il flag pb_is_dirty e restituisce tutto
     */
    getDirtyRecords(table, force = false) {
        const baseSelect = `SELECT *, ROWID as rowid FROM ${table}`;
        if (force) {
            // Se forziamo il push, prendiamo tutti i record che hanno un pb_id 
            // (o tutti se vogliamo popolare il server da zero)
            return this.db.prepare(baseSelect).all();
        } else {
            // Logica standard: solo quelli marcati localmente
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
     * Applica i cambiamenti remoti al database locale.
     * Gestisce l'upsert basandosi sul pb_id.
     */
    applyRemoteChanges(table, remoteRecord) {
        const { id, _is_deleted, ...data } = remoteRecord;
        const pb_id = id;
        const is_deleted = _is_deleted != 0;

        // Cerca se esiste già un record con questo pb_id
        const localRecord = this.db.prepare(`SELECT ROWID FROM ${table} WHERE pb_id = ?`).get(pb_id);

        this.db.transaction(() => {
            if (localRecord) {
                // check to see if is deleted
                if (is_deleted) {
                    this.removeRecord(table, localRecord.rowid);
                } else {
                    // UPDATE 
                    const keys = this.schemas[table].fields;
                    const setClause = keys.map(k => `${k} = ?`).join(', ');
                    const values = keys.map(k => data[k]);

                    // Aggiungiamo lo stato 2 per bypassare i trigger locali
                    this.db.prepare(`
                    UPDATE ${table} 
                    SET ${setClause}, pb_is_dirty = 2 
                    WHERE ROWID = ?
                `).run(...values, localRecord.rowid);

                    // Riportiamo a 0 (Sincronizzato)
                    this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 0 WHERE ROWID = ?`).run(localRecord.rowid);

                    if (this.verbose) console.log(`[DB] Updated ${table} (pb_id: ${pb_id})`);
                }
            } else {
                if (!is_deleted) {
                    // se non è cancellato, inseriamo
                    const keys = this.schemas[table].fields;
                    const pk = this.schemas[table].pk;
                    const columns = [pk, ...keys, 'pb_id', 'pb_is_dirty'].join(', ');
                    const placeholders = ['?', ...keys.map(() => '?'), '?', '2'].join(', ');
                    const values = [data[pk], ...keys.map(k => data[k]), pb_id];

                    const result = this.db.prepare(`
                        INSERT INTO ${table} (${columns}) 
                        VALUES (${placeholders})
                     `).run(...values);

                    // Riportiamo a 0
                    this.db.prepare(`UPDATE ${table} SET pb_is_dirty = 0 WHERE ROWID = ?`).run(result.lastInsertRowid);

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
     * Rimuove lo schema tecnico in modo sicuro (Ordine: Trigger -> Tabelle -> Colonne)
     */
    clearTechnicalSchema() {
        console.log("🧹 Avvio pulizia profonda del database locale...");

        this.db.transaction(() => {
            for (const table of this.syncOrder) {
                // 1. RIMOZIONE TRIGGER (Sempre per primi)
                // Dobbiamo eliminare i trigger che "puntano" alle tabelle tecniche
                this.db.prepare(`DROP TRIGGER IF EXISTS TRG_${table}_INSERT`).run();
                this.db.prepare(`DROP TRIGGER IF EXISTS TRG_${table}_UPDATE`).run();
                this.db.prepare(`DROP TRIGGER IF EXISTS TRG_${table}_DELETE`).run();

                if (this.verbose) console.log(`[Clean] Trigger rimossi per: ${table}`);

                // 2. RIMOZIONE COLONNE
                for (const column of this.schemas[table].techFields) {
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN ${column}`).run();
                    if (this.verbose) console.log(`[Clean] Colonna ${column} rimossa per: ${table}`);
                }

                /*
                try {
                    // Rimuoviamo le colonne pb_id e pb_is_dirty
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN pb_id`).run();
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN pb_is_dirty`).run();
                    this.db.prepare(`ALTER TABLE ${table} DROP COLUMN pb_updated_at`).run();
                } catch (e) {
                    // Fallback: se la versione di SQLite non supporta DROP COLUMN, 
                    // i dati rimarranno ma saranno inerti senza i trigger.
                    console.log(`[Info] Nota: Colonne su ${table} non rimosse (SQLite < 3.35.0)`);
                    if (this.verbose) console.log(`[Error] ${e}`);
                }
*/
            }

            // 3. RIMOZIONE TABELLE TECNICHE
            // Ora che nessun trigger punta più a questa tabella, possiamo eliminarla
            this.db.prepare(`DROP TABLE IF EXISTS pb_DELETED_RECORDS_LOG`).run();

            if (this.verbose) console.log(`[Clean] Tabelle tecniche rimosse.`);
        })();

        console.log("✅ Pulizia completata con successo.");
    }

    /**
     * Crea un nuovo database MMEX partendo dallo schema SQL esterno
     */
    createEmptyDatabase() {
        console.log(`🏗️  [Create] Creazione nuovo database in corso: ${this.dbPath}`);

        // 1. Legge ed esegue il file table_v1.sql
        // Il file deve trovarsi nella root del progetto o specifichiamo il path
        let sqlSchemaPath = './assets/sql/tables_v1_for_sync.sql';
        if (!fs.existsSync(sqlSchemaPath)) {
            sqlSchemaPath = './tables_v1_for_sync.sql';
            if (!fs.existsSync(sqlSchemaPath)) {
                throw new Error(`File schema non trovato: ${sqlSchemaPath}`);
            }
        }

        // Rimuove il file se esiste già per una creazione pulita (come nel tuo codice originale)
        if (fs.existsSync(this.dbPath)) {
            if (this.verbose) console.log("[Create] Rimozione file database esistente...");
            fs.unlinkSync(this.dbPath);
        }

        try {
            // Apriamo una nuova connessione
            // this.db = new Database(this.dbPath, { verbose: this.verbose ? console.log : null });
            this.db = new Database(this.dbPath);

            const sqlSchema = fs.readFileSync(sqlSchemaPath, 'utf8');

            // Eseguiamo tutto in una transazione per massime performance e sicurezza
            this.db.transaction(() => {
                this.db.exec(sqlSchema);

                // 2. Imposta il PRAGMA user_version a 21 (fondamentale per compatibilità MMEX)
                this.db.pragma('user_version = 21');

                if (this.verbose) console.log("[Create] Schema SQL applicato e user_version impostata a 21.");

            })();

            // non serve. lo fara dopo
            // 3. Inizializziamo subito i trigger e le colonne tecniche pb_id/pb_is_dirty
            // this.initSchema();

            console.log("✅ Database creato e pronto per la sincronizzazione.");
            return this.db;

        } catch (err) {
            console.error("❌ [Create] Errore critico durante la creazione del database:", err.message);
            if (this.verbose) console.log(err);
            if (this.db) this.db.close();
            throw err;
        }
    }


}