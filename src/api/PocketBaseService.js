// PocketBaseService
import PocketBase from 'pocketbase';
import { EventSource } from 'eventsource';
import { SYNC_CONFIG, SYNC_ORDER } from '../config/table_config.js';
import { ProgressBarService } from './../utils/ProgressBarService.js';

// TODO: invece di usare SYNC_CONFIG che contiene le colonne da sincronizzare
// dobremmo chiamare la get Collection in modo da recuperare le colonne disponibili sul server
// ovviamente vanno escluse le colonne tecniche lato PB (_is_deleted, _updated_at e ovviamente la pb_id) 

global.EventSource = EventSource;

export class PocketBaseService {
    constructor(url) {
        this.client = new PocketBase(url);
    }

    async authenticate(email, password) {
        return await this.client.collection('users').authWithPassword(email, password);
    }

    getToken() {
        return this.client.authStore.token;
    }

    setToken(token) {
        this.client.authStore.save(token, null);
    }

    invalidateToken() {
        this.client.authStore.clear();
    }

    /**
     * Recupera la lista completa, opzionalmente filtrata per data
     * @param {string} collection - Nome della tabella/collezione
     * @param {string|null} filter - Stringa di filtro (es. 'updated > "2023-01-01"')
     */
    async getFullList(collection, filter = null) {
        const options = {};

        if (filter) {
            options.filter = filter;
        }

        // Se non c'è filtro, options rimane un oggetto vuoto {} 
        // e getFullList scaricherà tutto (comportamento --force)
        return await this.client.collection(collection).getFullList(options);
    }

    async getByRowId(collection, rowId) {
        const searchString = `${SYNC_CONFIG[collection].pk} = "${rowId}"`;
        return await this.client.collection(collection).getFirstListItem(searchString);
    }

    async create(collection, data) {
        return await this.client.collection(collection).create(data);
    }

    async update(collection, id, data) {
        return await this.client.collection(collection).update(id, data);
    }

    async delete(collection, id) {
        return await this.client.collection(collection).delete(id);
    }

    /**
         * Sottoscrizione Realtime ottimizzata
         * @param {string|string[]} targets - Singola tabella, array di tabelle o null per tutte
         * @param {function} callback - Funzione da eseguire al cambio dati
         */
    async subscribe(targets = null, callback) {
        // Se targets è null, usa tutto l'ordine di sincronizzazione
        const collections = Array.isArray(targets)
            ? targets
            : (targets ? [targets] : SYNC_ORDER);

        for (const table of collections) {
            await this.client.collection(table).subscribe('*', (e) => {
                // Arricchiamo l'evento con il nome della collezione per il Watcher
                callback({
                    collection: table,
                    action: e.action,
                    record: e.record
                });
            });
        }

        if (this.verbose) console.log(`[PB] Subscribed to: ${collections.join(', ')}`);
    }

    /**
     * Utility per rimuovere tutte le sottoscrizioni (importante per il cleanup)
     */
    async unsubscribeAll() {
        return await this.client.realtime.unsubscribe();
    }

    /**
     * Svuota tutte le collezioni sul server rispettando l'ordine inverso delle dipendenze
     */
    async clearRemoteServer() {
        console.log("⚠️ ATTENZIONE: Pulizia server PocketBase avviata (Ordine Inverso)...");

        // Invertiamo l'ordine: se SYNC_ORDER è [Valute, Account, Transazioni],
        // reverseOrder diventerà [Transazioni, Account, Valute].
        const reverseOrder = [...SYNC_ORDER].reverse();

        for (const table of reverseOrder) {
            try {
                // Prendiamo tutti i record della collezione
                const records = await this.client.collection(table).getFullList();

                if (records.length > 0) {
                    const progress = new ProgressBarService(records.length)
                    // console.log(`[Server] Eliminazione di ${records.length} record da: ${table}...`);

                    // Cancellazione sequenziale per non sovraccaricare il server e rispettare i vincoli
                    for (const record of records) {
                        progress.update(`[Server] Pulizia di ${table}`);
                        await this.client.collection(table).delete(record.id);
                    }
                }
            } catch (err) {
                // Se la collezione non esiste sul server, ignoriamo l'errore e procediamo
                if (err.status !== 404) {
                    console.error(`❌ Errore durante la pulizia di ${table}:`, err.message);
                }
            }
        }
        console.log("✅ Server PocketBase ripulito con successo.");
    }

}