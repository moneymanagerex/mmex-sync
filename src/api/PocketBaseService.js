// PocketBaseService
import PocketBase from 'pocketbase';
import { EventSource } from 'eventsource';
import { SYNC_CONFIG, SYNC_ORDER } from '../config/table_config.js';
import { ProgressBarService } from './../utils/ProgressBarService.js';
import { RemoteService } from './RemoteService.js';

// TODO: instead of using SYNC_CONFIG which contains columns to synchronize
// we should call get Collection to retrieve available columns on the server
// obviously technical PB side columns must be excluded (_is_deleted, _updated_at and obviously pb_id) 

global.EventSource = EventSource;

export class PocketBaseService extends RemoteService {
    constructor(url) {
        super(url);
        this.client = new PocketBase(url);
    }

    async authenticate(email, password) {
        try {
            const authData = await this.client.collection('users').authWithPassword(email, password);
            this.authCollection = 'users';
            return authData;
        } catch (error) {
            console.log(`⚠️ Authenticating with 'users' failed, trying '_superusers' fallback...`);
            try {
                const fallbackAuthData = await this.client.collection('_superusers').authWithPassword(email, password);
                this.authCollection = '_superusers';
                return fallbackAuthData;
            } catch (fallbackError) {
                throw fallbackError;
            }
        }
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

    isTokenValid() {
        return this.client.authStore.isValid;
    }

    async refreshToken() {
        return await this.client.collection(this.authCollection).authRefresh();
    }

    /**
     * Retrieves the full list, optionally filtered by date
     * @param {string} collection - Name of the table/collection
     * @param {string|null} filter - Filter string (e.g. 'updated > "2023-01-01"')
     */
    async getFullList(collection, filter = null) {
        const options = {};

        if (filter) {
            options.filter = filter;
        }

        options.sort = "_updated_at";

        // If no filter is present, options remains an empty object {} 
        // and getFullList will download everything (--force behavior)
        return await this.client.collection(collection).getFullList(options);
    }

    async getByRowId(collection, rowId) {
        const searchString = `${SYNC_CONFIG[collection].pk} = "${rowId}"`;
        return await this.client.collection(collection).getFirstListItem(searchString);
    }

    async getRemoteRecordByUniqueKeys(collection, keys) {
        const searchParts = Object.entries(keys).map(([k, v]) => {
            if (typeof v === 'string') {
                return `${k} = "${v}"`;
            }
            return `${k} = ${v}`;
        });
        const searchString = searchParts.join(' && ');
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
         * Optimized Realtime subscription
         * @param {string|string[]} targets - Single table, array of tables or null for all
         * @param {function} callback - Function to execute on data change
         */
    async subscribe(targets = null, callback) {
        // If targets is null, use the entire sync order
        const collections = Array.isArray(targets)
            ? targets
            : (targets ? [targets] : SYNC_ORDER);

        for (const table of collections) {
            await this.client.collection(table).subscribe('*', (e) => {
                // Enrich the event with the collection name for the Watcher
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
     * Utility to remove all subscriptions (important for cleanup)
     */
    async unsubscribeAll() {
        return await this.client.realtime.unsubscribe();
    }

    /**
     * Clears all collections on the server respecting inverse dependency order
     */
    async clearRemoteServer() {
        console.log("⚠️ WARNING: PocketBase server cleanup started (Inverse Order)...");

        // Reverse the order: if SYNC_ORDER is [Currencies, Accounts, Transactions],
        // reverseOrder will become [Transactions, Accounts, Currencies].
        const reverseOrder = [...SYNC_ORDER].reverse();

        for (const table of reverseOrder) {
            try {
                // Retrieve all records from the collection
                const records = await this.client.collection(table).getFullList();

                if (records.length > 0) {
                    const progress = new ProgressBarService(records.length)
                    // console.log(`[Server] Deleting ${records.length} records from: ${table}...`);

                    // Sequential deletion to avoid overloading the server and respect constraints
                    for (const record of records) {
                        progress.update(`[Server] Cleaning ${table}`);
                        await this.client.collection(table).delete(record.id);
                    }
                }
            } catch (err) {
                // If the collection doesn't exist on the server, ignore the error and proceed
                if (err.status !== 404) {
                    console.error(`❌ Error during cleanup of ${table}:`, err.message);
                }
            }
        }
        console.log("✅ PocketBase server cleared successfully.");
    }

}