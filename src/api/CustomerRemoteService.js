import { RemoteService } from './RemoteService.js';

/* 
   This is a sample class for direct connect to remote REST services without PocketBase SDK. It can be used as a template for custom implementations or for direct REST API connections. It is registered in the RemoteServiceFactory under the type 'customer'.
   need to be tested with a real REST API and may require adjustments based on the specific API structure and authentication methods used by the target service. The subscribe() method is not implemented as it depends on the capabilities of the remote service (e.g., WebSockets, Server-Sent Events, etc.) and would need to be customized accordingly.
*/


const buildHeaders = (token) => {
    const headers = {
        'Content-Type': 'application/json'
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
};

const normalizeUrl = (url) => url.replace(/\/+$/u, '');

export class CustomerRemoteService extends RemoteService {
    constructor(url) {
        super(url);
        this.token = null;
        this.url = normalizeUrl(url);
    }

    async authenticate(email, password) {
        const response = await fetch(`${this.url}/auth/login`, {
            method: 'POST',
            headers: buildHeaders(this.token),
            body: JSON.stringify({ email, password })
        });
        const authData = await this._handleResponse(response);
        if (authData?.token) {
            this.token = authData.token;
        }
        return authData;
    }

    getToken() {
        return this.token;
    }

    setToken(token) {
        this.token = token;
    }

    invalidateToken() {
        this.token = null;
    }

    isTokenValid() {
        return Boolean(this.token);
    }

    async refreshToken() {
        const response = await fetch(`${this.url}/auth/refresh`, {
            method: 'POST',
            headers: buildHeaders(this.token)
        });
        return await this._handleResponse(response);
    }

    async getFullList(collection, filter = null) {
        const query = new URLSearchParams({ sort: '_updated_at' });
        if (filter) {
            query.set('filter', filter);
        }
        const response = await fetch(`${this.url}/${collection}?${query.toString()}`, {
            method: 'GET',
            headers: buildHeaders(this.token)
        });
        return await this._handleResponse(response);
    }

    async getByRowId(collection, rowId) {
        const response = await fetch(`${this.url}/${collection}/${encodeURIComponent(rowId)}`, {
            method: 'GET',
            headers: buildHeaders(this.token)
        });
        return await this._handleResponse(response);
    }

    async getById(collection, id) {
        const response = await fetch(`${this.url}/${collection}/${encodeURIComponent(id)}`, {
            method: 'GET',
            headers: buildHeaders(this.token)
        });
        return await this._handleResponse(response);
    }

    async getRemoteRecordByUniqueKeys(collection, keys) {
        const query = new URLSearchParams();
        const searchParts = Object.entries(keys).map(([k, v]) => {
            if (typeof v === 'string') {
                return `${k} = "${v}"`;
            }
            return `${k} = ${v}`;
        });
        query.set('filter', searchParts.join(' && '));
        const response = await fetch(`${this.url}/${collection}?${query.toString()}`, {
            method: 'GET',
            headers: buildHeaders(this.token)
        });
        const list = await this._handleResponse(response);
        return list && list.length > 0 ? list[0] : null;
    }

    async create(collection, data) {
        const response = await fetch(`${this.url}/${collection}`, {
            method: 'POST',
            headers: buildHeaders(this.token),
            body: JSON.stringify(data)
        });
        return await this._handleResponse(response);
    }

    async update(collection, id, data) {
        const response = await fetch(`${this.url}/${collection}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: buildHeaders(this.token),
            body: JSON.stringify(data)
        });
        return await this._handleResponse(response);
    }

    async delete(collection, id) {
        const response = await fetch(`${this.url}/${collection}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: buildHeaders(this.token)
        });
        return await this._handleResponse(response);
    }

    async subscribe(targets = null, callback) {
        throw new Error('CustomerRemoteService.subscribe() is not implemented in the generic REST template');
    }

    async unsubscribeAll() {
        // No-op for a generic REST service by default
        return true;
    }

    async clearRemoteServer() {
        if (!Array.isArray(this.syncOrder) || this.syncOrder.length === 0) {
            throw new Error('clearRemoteServer requires a concrete sync order to delete collections');
        }

        const reverseOrder = [...this.syncOrder].reverse();
        for (const collection of reverseOrder) {
            const rows = await this.getFullList(collection);
            if (!Array.isArray(rows)) {
                continue;
            }
            for (const row of rows) {
                if (!row?.id) {
                    continue;
                }
                await this.delete(collection, row.id);
            }
        }
        return true;
    }

    async _handleResponse(response) {
        const text = await response.text();
        if (!response.ok) {
            let message = text;
            try {
                const json = JSON.parse(text);
                message = json.message || JSON.stringify(json);
            } catch {
                message = text;
            }
            throw new Error(`HTTP ${response.status}: ${message}`);
        }
        try {
            return text ? JSON.parse(text) : null;
        } catch (error) {
            throw new Error(`Invalid JSON response from ${response.url}`);
        }
    }
}
