import { jest } from '@jest/globals';
import path from 'path';

// Mock dependencies
jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: jest.fn(),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: jest.fn(),
        readdirSync: jest.fn()
    }
}));

jest.unstable_mockModule('enquirer', () => ({
    default: {
        prompt: jest.fn()
    }
}));

jest.unstable_mockModule('../../src/utils/dpapi.js', () => ({
    protect: jest.fn(val => `encrypted_${val}`),
    unprotect: jest.fn(val => val.replace('encrypted_', ''))
}));

const fs = (await import('fs')).default;
const enquirer = (await import('enquirer')).default;
const dpapi = await import('../../src/utils/dpapi.js');
const { ConfigManager } = await import('../../src/config/ConfigManager.js');

describe('ConfigManager', () => {
    let processStdoutSpy;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        processStdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => true);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Constructor', () => {
        test('initializes paths correctly with default profile', () => {
            const config = new ConfigManager({});
            expect(config.profile).toBe('default');
            expect(config.configPath).toContain('default.mmex-sync.json');
        });

        test('initializes paths correctly with specified profile', () => {
            const config = new ConfigManager({ profile: 'test-profile' });
            expect(config.profile).toBe('test-profile');
            expect(config.configPath).toContain('test-profile.mmex-sync.json');
        });
    });

    describe('updateConfig', () => {
        test('updates configuration and executes protect on token', () => {
            const config = new ConfigManager({});
            // mock existsSync for save
            fs.existsSync.mockReturnValue(true);

            config.updateConfig({ token: 'my-secret-token' });

            expect(dpapi.protect).toHaveBeenCalledWith('my-secret-token');
            expect(config.config.encryptedToken).toBe('encrypted_my-secret-token');
            expect(fs.writeFileSync).toHaveBeenCalled();
        });
    });

    describe('getEffectiveConfig', () => {
        test('reads from file and resolves config without prompt if all fields are present', async () => {
            const configManager = new ConfigManager({});
            const mockSavedConfig = {
                dbPath: '/test/db.mmb',
                pbUrl: 'http://test',
                pbUser: 'user@test.com',
                encryptedToken: 'encrypted_token123'
            };

            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockSavedConfig));

            const finalConfig = await configManager.getEffectiveConfig();

            expect(enquirer.prompt).not.toHaveBeenCalled();
            expect(finalConfig.dbPath).toBe('/test/db.mmb');
            expect(finalConfig.token).toBe('token123'); // decrypted
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        test('asks for missing values via enquirer if they are not in the config', async () => {
            const configManager = new ConfigManager({});
            fs.existsSync.mockReturnValue(false); // no config file
            
            enquirer.prompt.mockResolvedValue({
                dbPath: '/prompt/db.mmb',
                pbUrl: 'http://prompt',
                pbUser: 'prompt@user.com',
                pbPass: 'secret',
                mmexExe: 'C:\\prompt.exe'
            });

            const finalConfig = await configManager.getEffectiveConfig();

            expect(enquirer.prompt).toHaveBeenCalled();
            expect(finalConfig.dbPath).toBe('/prompt/db.mmb');
            expect(finalConfig.pbUser).toBe('prompt@user.com');
        });

        test('overwrites saved configuration if cli parameters are passed', async () => {
            const cliArgs = {
                db: '/cli/db.mmb',
                url: 'http://cli',
                user: 'cli@user.com'
            };
            const configManager = new ConfigManager(cliArgs);
            
            const mockSavedConfig = {
                dbPath: '/test/db.mmb',
                pbUrl: 'http://test',
                pbUser: 'user@test.com',
                encryptedToken: 'encrypted_token123'
            };

            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockSavedConfig));

            const finalConfig = await configManager.getEffectiveConfig();

            // CLI parameters take precedence
            expect(finalConfig.dbPath).toBe('/cli/db.mmb');
            expect(finalConfig.pbUrl).toBe('http://cli');
            expect(finalConfig.pbUser).toBe('cli@user.com');
        });
    });

    describe('setDefaultMode', () => {
        test('returns error if mode is invalid', () => {
            const config = new ConfigManager({});
            const result = config.setDefaultMode('invalid-mode');
            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid mode'));
        });

        test('saves new mode if valid', () => {
            const config = new ConfigManager({});
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify({ dbPath: '/test' }));
            
            const result = config.setDefaultMode('watch');
            
            expect(result).toBe(true);
            expect(config.config.defaultMode).toBe('watch');
            expect(fs.writeFileSync).toHaveBeenCalled();
        });
    });
});
