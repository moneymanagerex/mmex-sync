import { RemoteServiceFactory } from '../../src/api/RemoteServiceFactory.js';

describe('RemoteServiceFactory', () => {
    class DummyService {
        constructor(url) {
            this.url = url;
        }
    }

    const dummyType = 'dummy-service';

    beforeAll(() => {
        RemoteServiceFactory.register(dummyType, DummyService);
    });

    test('creates a registered remote service by type', () => {
        const service = RemoteServiceFactory.create(dummyType, 'http://example.com');

        expect(service).toBeInstanceOf(DummyService);
        expect(service.url).toBe('http://example.com');
    });

    test('throws when requesting an unsupported server type', () => {
        expect(() => RemoteServiceFactory.create('unsupported', 'http://example.com')).toThrow(/Unsupported serverType/);
    });
});
