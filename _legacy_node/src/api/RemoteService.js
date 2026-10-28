export class RemoteService {
    constructor(url) {
        this.url = url;
        this.authCollection = null;
        this.verbose = false;
    }

    async authenticate(email, password) {
        throw new Error('RemoteService.authenticate() must be implemented by subclass');
    }

    getToken() {
        throw new Error('RemoteService.getToken() must be implemented by subclass');
    }

    setToken(token) {
        throw new Error('RemoteService.setToken() must be implemented by subclass');
    }

    invalidateToken() {
        throw new Error('RemoteService.invalidateToken() must be implemented by subclass');
    }

    isTokenValid() {
        throw new Error('RemoteService.isTokenValid() must be implemented by subclass');
    }

    async refreshToken() {
        throw new Error('RemoteService.refreshToken() must be implemented by subclass');
    }

    async getFullList(collection, filter = null) {
        throw new Error('RemoteService.getFullList() must be implemented by subclass');
    }

    async getByRowId(collection, rowId) {
        throw new Error('RemoteService.getByRowId() must be implemented by subclass');
    }

    async getById(collection, id) {
        throw new Error('RemoteService.getById() must be implemented by subclass');
    }

    async getRemoteRecordByUniqueKeys(collection, keys) {
        throw new Error('RemoteService.getRemoteRecordByUniqueKeys() must be implemented by subclass');
    }

    async create(collection, data) {
        throw new Error('RemoteService.create() must be implemented by subclass');
    }

    async update(collection, id, data) {
        throw new Error('RemoteService.update() must be implemented by subclass');
    }

    async delete(collection, id) {
        throw new Error('RemoteService.delete() must be implemented by subclass');
    }

    async subscribe(targets = null, callback) {
        throw new Error('RemoteService.subscribe() must be implemented by subclass');
    }

    async unsubscribeAll() {
        throw new Error('RemoteService.unsubscribeAll() must be implemented by subclass');
    }

    async clearRemoteServer() {
        throw new Error('RemoteService.clearRemoteServer() must be implemented by subclass');
    }
}
