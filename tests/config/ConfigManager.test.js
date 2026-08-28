import { jest } from '@jest/globals';
import path from 'path';

// Mock dependencies
jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: jest.fn(),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
        readFileSync: jest.fn(),
        readdirSync: jest.fn(),
        renameSync: jest.fn()
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
            expect(finalConfig.serverType).toBe('pocketbase');
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        test('defaults serverType to pocketbase when not specified', async () => {
            const configManager = new ConfigManager({});
            fs.existsSync.mockReturnValue(false);
            enquirer.prompt.mockResolvedValue({
                dbPath: '/prompt/db.mmb',
                pbUrl: 'http://prompt',
                pbUser: 'prompt@user.com',
                pbPass: 'secret',
                mmexExe: 'C:\prompt.exe'
            });

            const finalConfig = await configManager.getEffectiveConfig();

            expect(finalConfig.serverType).toBe('pocketbase');
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
                user: 'cli@user.com',
                serverType: 'customer'
            };
            const configManager = new ConfigManager(cliArgs);
            
            const mockSavedConfig = {
                dbPath: '/test/db.mmb',
                pbUrl: 'http://test',
                pbUser: 'user@test.com',
                serverType: 'pocketbase',
                encryptedToken: 'encrypted_token123'
            };

            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockSavedConfig));

            const finalConfig = await configManager.getEffectiveConfig();

            // CLI parameters take precedence
            expect(finalConfig.dbPath).toBe('/cli/db.mmb');
            expect(finalConfig.pbUrl).toBe('http://cli');
            expect(finalConfig.pbUser).toBe('cli@user.com');
            expect(finalConfig.serverType).toBe('customer');
        });

        test('handles isRunning flag correctly when present or absent in saved config', async () => {
            const configManager = new ConfigManager({});
            const mockSavedConfig = {
                dbPath: '/test/db.mmb',
                pbUrl: 'http://test',
                pbUser: 'user@test.com',
                encryptedToken: 'encrypted_token123',
                isRunning: true
            };

            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockSavedConfig));

            const finalConfig = await configManager.getEffectiveConfig();
            expect(finalConfig.isRunning).toBe(true);

            // Test saving preserves or updates isRunning
            finalConfig.isRunning = false;
            configManager.save(finalConfig);

            const savedContent = JSON.parse(fs.writeFileSync.mock.calls[fs.writeFileSync.mock.calls.length - 1][1]);
            expect(savedContent.isRunning).toBe(false);
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

    describe('setDefaultProfile', () => {
        test('returns false if profile name is invalid', () => {
            const config = new ConfigManager({});
            const result = config.setDefaultProfile('');
            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Please specify a profile name'));
        });

        test('updates global config with specified profile name', () => {
            const config = new ConfigManager({});
            fs.existsSync.mockReturnValue(false);

            const result = config.setDefaultProfile('work');

            expect(result).toBe(true);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('mmex-sync.config.json'),
                expect.stringContaining('"defaultProfile": "work"')
            );
        });
    });

    describe('renameProfile', () => {
        test('returns false if current profile file does not exist', () => {
            const config = new ConfigManager({ profile: 'nonexistent' });
            fs.existsSync.mockReturnValue(false);

            const result = config.renameProfile('newname');

            expect(result).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
        });

        test('renames profile file and updates global config if current profile was default', () => {
            const config = new ConfigManager({ profile: 'work' });
            // Mock exist checks for: configDir, currentPath, newPath, globalConfigPath
            fs.existsSync.mockImplementation(p => {
                const base = path.basename(p);
                if (base === 'work.mmex-sync.json') return true;
                if (base === 'newwork.mmex-sync.json') return false;
                if (base === 'mmex-sync.config.json') return true;
                return true;
            });
            fs.readFileSync.mockImplementation(p => {
                if (p.includes('mmex-sync.config.json')) return JSON.stringify({ defaultProfile: 'work' });
                return '{}';
            });
            const result = config.renameProfile('newwork');

            expect(result).toBe(true);
            expect(fs.renameSync).toHaveBeenCalledWith(
                expect.stringContaining('work.mmex-sync.json'),
                expect.stringContaining('newwork.mmex-sync.json')
            );
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('mmex-sync.config.json'),
                expect.stringContaining('"defaultProfile": "newwork"')
            );
        });
    });

    describe('.emb File Password Handling', () => {
        test('prompts for file password and save choice when .emb file is specified', async () => {
            const configManager = new ConfigManager({ db: '/test/data.emb' });
            fs.existsSync.mockReturnValue(false);

            enquirer.prompt
                .mockResolvedValueOnce({
                    pbUrl: 'http://localhost:8090',
                    pbUser: 'test@example.com',
                    pbPass: 'secret',
                    mmexExe: 'C:\\mmex.exe'
                })
                .mockResolvedValueOnce({
                    filePassword: 'mypassword123',
                    savePasswordChoice: 'no'
                });

            const finalConfig = await configManager.getEffectiveConfig();

            expect(finalConfig.filePassword).toBe('mypassword123');
            expect(finalConfig.savePassword).toBe('no');

            const profileCalls = fs.writeFileSync.mock.calls.filter(c => c[0].endsWith('.mmex-sync.json') && !c[0].endsWith('mmex-sync.config.json'));
            const savedContent = JSON.parse(profileCalls[profileCalls.length - 1][1]);
            expect(savedContent.savePassword).toBe('no');
            expect(savedContent.encryptedFilePassword).toBeUndefined();
        });

        test('uses CLI --filePassword and saves encryptedFilePassword when --saveFilePassword=yes', async () => {
            const cliArgs = {
                db: '/test/data.emb',
                filePassword: 'cliFilePassword123',
                saveFilePassword: 'yes',
                url: 'http://localhost:8090',
                user: 'test@example.com'
            };
            const configManager = new ConfigManager(cliArgs);
            fs.existsSync.mockReturnValue(false);
            enquirer.prompt.mockResolvedValue({ pbPass: 'secret', mmexExe: 'C:\\mmex.exe' });

            const finalConfig = await configManager.getEffectiveConfig();

            expect(finalConfig.filePassword).toBe('cliFilePassword123');
            expect(finalConfig.savePassword).toBe('yes');
            expect(dpapi.protect).toHaveBeenCalledWith('cliFilePassword123');

            const profileCalls = fs.writeFileSync.mock.calls.filter(c => c[0].endsWith('.mmex-sync.json') && !c[0].endsWith('mmex-sync.config.json'));
            const savedContent = JSON.parse(profileCalls[profileCalls.length - 1][1]);
            expect(savedContent.savePassword).toBe('yes');
            expect(savedContent.encryptedFilePassword).toBe('encrypted_cliFilePassword123');
        });

        test('decrypts saved encryptedFilePassword if savePassword is not "no"', async () => {
            const configManager = new ConfigManager({ db: '/test/data.emb' });
            const mockSavedConfig = {
                dbPath: '/test/data.emb',
                pbUrl: 'http://localhost:8090',
                pbUser: 'user@test.com',
                encryptedToken: 'encrypted_token123',
                savePassword: 'yes',
                encryptedFilePassword: 'encrypted_dbpassword123'
            };

            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(mockSavedConfig));

            const finalConfig = await configManager.getEffectiveConfig();

            expect(dpapi.unprotect).toHaveBeenCalledWith('encrypted_dbpassword123');
            expect(finalConfig.filePassword).toBe('dbpassword123');
        });

        test('preserves encryptedFilePassword when save is called after filePassword is set to null (e.g. on exit)', async () => {
            const cliArgs = {
                db: '/test/data.emb',
                filePassword: 'cliFilePassword123',
                saveFilePassword: 'yes',
                url: 'http://localhost:8090',
                user: 'test@example.com'
            };
            const configManager = new ConfigManager(cliArgs);
            fs.existsSync.mockReturnValue(false);
            enquirer.prompt.mockResolvedValue({ pbPass: 'secret', mmexExe: 'C:\\mmex.exe' });

            const finalConfig = await configManager.getEffectiveConfig();
            expect(finalConfig.filePassword).toBe('cliFilePassword123');

            // Simulate exit procedure where clear-text password is wiped
            finalConfig.filePassword = null;
            finalConfig.isRunning = false;
            configManager.save(finalConfig);

            const profileCalls = fs.writeFileSync.mock.calls.filter(c => c[0].endsWith('.mmex-sync.json') && !c[0].endsWith('mmex-sync.config.json'));
            const savedContentOnExit = JSON.parse(profileCalls[profileCalls.length - 1][1]);
            expect(savedContentOnExit.savePassword).toBe('yes');
            expect(savedContentOnExit.encryptedFilePassword).toBe('encrypted_cliFilePassword123');
        });
    });
});
