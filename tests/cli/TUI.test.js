// tests/cli/TUI.test.js
import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: jest.fn(() => true),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: jest.fn(() => '{}'),
        readdirSync: jest.fn(() => [])
    }
}));

jest.unstable_mockModule('@clack/prompts', () => ({
    intro: jest.fn(),
    outro: jest.fn(),
    text: jest.fn(),
    password: jest.fn(),
    select: jest.fn(),
    confirm: jest.fn(),
    log: {
        error: jest.fn(),
        success: jest.fn(),
        warn: jest.fn(),
        info: jest.fn()
    },
    spinner: jest.fn(() => ({
        start: jest.fn(),
        stop: jest.fn(),
        message: jest.fn()
    })),
    isCancel: jest.fn(val => val === null)
}));

jest.unstable_mockModule('../../src/config/ConfigManager.js', () => {
    class MockConfigManager {
        constructor(cliArgs) {
            this.cliArgs = cliArgs;
            this.configDir = '/mock/config/dir';
            this.profile = cliArgs.profile || 'default';
            this.configPath = '/mock/config/dir/default.mmex-sync.json';
            this.config = {};
        }
        updateConfig = jest.fn();
        _loadFromFile = jest.fn(() => ({}));
        save = jest.fn();
        getProfiles = jest.fn(() => ['default', 'custom']);
        switchProfile = jest.fn(p => { this.profile = p; });
        deleteProfile = jest.fn(() => true);
        _searchMMEXExecutable = jest.fn(() => ['/mock/exe']);
    }
    return { ConfigManager: MockConfigManager };
});

const fs = (await import('fs')).default;
const clack = await import('@clack/prompts');
const { TUI } = await import('../../src/cli/tui.js');

describe('TUI', () => {
    let tui;
    let consoleLogSpy;
    let consoleClearSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => true);
        consoleClearSpy = jest.spyOn(console, 'clear').mockImplementation(() => true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Constructor', () => {
        test('initializes with default values', () => {
            tui = new TUI({});
            expect(tui.profile).toBe('default');
            expect(tui.configMgr).toBeDefined();
        });
    });

    describe('validateAndSaveConfig', () => {
        test('returns false if dbPath is missing', async () => {
            tui = new TUI({});
            tui.configMgr.config = {}; // empty
            tui.pressEnterToContinue = jest.fn().mockResolvedValue(true);

            const result = await tui.validateAndSaveConfig('run');
            expect(result).toBe(false);
            expect(clack.log.error).toHaveBeenCalledWith(expect.stringContaining('DB Path is missing'));
        });

        test('returns false if pbUrl is missing', async () => {
            tui = new TUI({});
            tui.configMgr.config = { dbPath: '/my/db.mmb' };
            tui.pressEnterToContinue = jest.fn().mockResolvedValue(true);

            const result = await tui.validateAndSaveConfig('run');
            expect(result).toBe(false);
            expect(clack.log.error).toHaveBeenCalledWith(expect.stringContaining('Server URL is missing'));
        });

        test('returns false if pbUser is missing', async () => {
            tui = new TUI({});
            tui.configMgr.config = { dbPath: '/my/db.mmb', pbUrl: 'http://localhost' };
            tui.pressEnterToContinue = jest.fn().mockResolvedValue(true);

            const result = await tui.validateAndSaveConfig('run');
            expect(result).toBe(false);
            expect(clack.log.error).toHaveBeenCalledWith(expect.stringContaining('Username/Email is missing'));
        });

        test('returns false if session token and cli password are both missing', async () => {
            tui = new TUI({});
            tui.configMgr.config = { dbPath: '/my/db.mmb', pbUrl: 'http://localhost', pbUser: 'user' };
            tui.pressEnterToContinue = jest.fn().mockResolvedValue(true);

            const result = await tui.validateAndSaveConfig('run');
            expect(result).toBe(false);
            expect(clack.log.error).toHaveBeenCalledWith(expect.stringContaining('No active session'));
        });

        test('returns false if mmexExe is missing in run/watch mode', async () => {
            tui = new TUI({});
            tui.configMgr.config = { 
                dbPath: '/my/db.mmb', 
                pbUrl: 'http://localhost', 
                pbUser: 'user', 
                encryptedToken: 'token' 
            };
            tui.pressEnterToContinue = jest.fn().mockResolvedValue(true);

            const result = await tui.validateAndSaveConfig('run');
            expect(result).toBe(false);
            expect(clack.log.error).toHaveBeenCalledWith(expect.stringContaining('MoneyManagerEx executable path is missing'));
        });

        test('returns true and saves if configuration is valid', async () => {
            tui = new TUI({});
            tui.configMgr.config = { 
                dbPath: '/my/db.mmb', 
                pbUrl: 'http://localhost', 
                pbUser: 'user', 
                encryptedToken: 'token',
                mmexExe: '/my/mmex.exe'
            };

            const result = await tui.validateAndSaveConfig('run');
            expect(result).toBe(true);
            expect(tui.configMgr.save).toHaveBeenCalledWith(tui.configMgr.config);
        });
    });

    describe('handleProfileMenu - switch action', () => {
        test('switches profile successfully', async () => {
            tui = new TUI({});
            tui.pressEnterToContinue = jest.fn().mockResolvedValue(true);
            clack.select.mockResolvedValueOnce('switch').mockResolvedValueOnce('custom');

            await tui.handleProfileMenu();

            expect(tui.configMgr.switchProfile).toHaveBeenCalledWith('custom');
            expect(tui.profile).toBe('custom');
            expect(clack.log.success).toHaveBeenCalledWith(expect.stringContaining('Switched to profile: custom'));
        });
    });
});
