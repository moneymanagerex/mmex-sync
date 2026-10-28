import { PocketBaseService } from './PocketBaseService.js';
import { CustomerRemoteService } from './CustomerRemoteService.js';

const registry = new Map();

export class RemoteServiceFactory {
    static register(type, ServiceClass) {
        if (!type || typeof type !== 'string') {
            throw new Error('RemoteServiceFactory.register() requires a valid service type string');
        }

        registry.set(type.toLowerCase(), ServiceClass);
    }

    static create(type = 'pocketbase', url) {
        const serviceType = typeof type === 'string' ? type.toLowerCase() : 'pocketbase';
        const ServiceClass = registry.get(serviceType);

        if (!ServiceClass) {
            const available = [...registry.keys()].join(', ');
            throw new Error(`Unsupported serverType '${type}'. Available types: ${available}`);
        }

        return new ServiceClass(url);
    }

    static availableTypes() {
        return [...registry.keys()];
    }
}

RemoteServiceFactory.register('pocketbase', PocketBaseService);
RemoteServiceFactory.register('customer', CustomerRemoteService);
