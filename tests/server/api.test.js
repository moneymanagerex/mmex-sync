import { jest } from '@jest/globals';
import http from 'http';

// Mock dependencies
jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: jest.fn(),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: jest.fn(),
        readdirSync: jest.fn(),
        renameSync: jest.fn(),
        unlinkSync: jest.fn()
    }
}));

jest.unstable_mockModule('../../src/utils/security.js', () => ({
    protect: jest.fn((val) => `enc_${val}`),
    unprotect: jest.fn((val) => val.replace('enc_', ''))
}));

const fs = (await import('fs')).default;
const { createApp } = await import('../../src/server/server.js');

describe('Server API Endpoints', () => {
    let app;
    let server;
    let baseUrl;

    beforeAll((done) => {
        app = createApp();
        server = http.createServer(app);
        server.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            done();
        });
    });

    afterAll((done) => {
        if (server) {
            if (typeof server.closeAllConnections === 'function') {
                server.closeAllConnections();
            }
            server.close(done);
        } else {
            done();
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('GET /api/profiles returns list of profiles and default profile', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['default.mmex-sync.json']);
        fs.readFileSync.mockImplementation((filePath) => {
            if (filePath.endsWith('mmex-sync.config.json')) {
                return JSON.stringify({ defaultProfile: 'default' });
            }
            return JSON.stringify({ dbPath: '/test.mmb', pbUrl: 'http://localhost:8090', pbUser: 'user' });
        });

        const res = await fetch(`${baseUrl}/api/profiles`);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.defaultProfile).toBe('default');
        expect(data.profiles).toHaveLength(1);
        expect(data.profiles[0].name).toBe('default');
    });

    test('GET /api/profile/:name returns 404 for non-existent profile', async () => {
        fs.existsSync.mockReturnValue(false);

        const res = await fetch(`${baseUrl}/api/profile/unknown`);
        const data = await res.json();

        expect(res.status).toBe(404);
        expect(data.success).toBe(false);
    });

    test('GET /api/profile/:name returns profile details', async () => {
        fs.existsSync.mockImplementation((p) => p.endsWith('default.mmex-sync.json'));
        fs.readFileSync.mockReturnValue(JSON.stringify({
            dbPath: '/test.mmb',
            pbUrl: 'http://localhost:8090',
            pbUser: 'admin'
        }));

        const res = await fetch(`${baseUrl}/api/profile/default`);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.profile.name).toBe('default');
        expect(data.profile.dbPath).toBe('/test.mmb');
    });

    test('POST /api/profile creates a new profile', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readdirSync.mockReturnValue(['personal.mmex-sync.json']);
        fs.readFileSync.mockReturnValue(JSON.stringify({ dbPath: '/test.mmb' }));

        const payload = {
            name: 'personal',
            dbPath: '/path/to/db.mmb',
            pbUrl: 'http://127.0.0.1:8090',
            pbUser: 'user@test.com',
            defaultMode: 'run',
            isDefault: true
        };

        const res = await fetch(`${baseUrl}/api/profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('POST /api/profile/:name/default sets the default profile', async () => {
        fs.existsSync.mockImplementation((p) => p.endsWith('work.mmex-sync.json') || p.endsWith('mmex-sync.config.json'));
        fs.readFileSync.mockImplementation((p) => {
            if (p.endsWith('work.mmex-sync.json')) return JSON.stringify({ dbPath: '/work.mmb' });
            return JSON.stringify({ defaultProfile: 'default' });
        });

        const res = await fetch(`${baseUrl}/api/profile/work/default`, { method: 'POST' });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test('PUT /api/profile/:name/rename renames profile', async () => {
        fs.existsSync.mockImplementation((p) => p.endsWith('oldname.mmex-sync.json') ? true : false);
        fs.readFileSync.mockReturnValue(JSON.stringify({ defaultProfile: 'oldname' }));

        const res = await fetch(`${baseUrl}/api/profile/oldname/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName: 'newname' })
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(fs.renameSync).toHaveBeenCalled();
    });

    test('DELETE /api/profile/:name deletes profile', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify({ defaultProfile: 'to_delete' }));

        const res = await fetch(`${baseUrl}/api/profile/to_delete`, { method: 'DELETE' });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(fs.unlinkSync).toHaveBeenCalled();
    });

    test('GET /api/system/detect-mmex returns auto-detected path or null', async () => {
        const res = await fetch(`${baseUrl}/api/system/detect-mmex`);
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data).toHaveProperty('mmexPath');
    });

    test('POST /api/system/shutdown handles exit action', async () => {
        const res = await fetch(`${baseUrl}/api/system/shutdown`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'exit' })
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.action).toBe('exit');
    });

    test('POST /api/system/shutdown handles run action', async () => {
        const res = await fetch(`${baseUrl}/api/system/shutdown`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'run' })
        });
        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.action).toBe('run');
    });
});
