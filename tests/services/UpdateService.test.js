import { jest } from '@jest/globals';
import { UpdateService } from '../../src/services/UpdateService.js';

describe('UpdateService', () => {
    let updateService;
    let consoleLogSpy;
    let consoleErrorSpy;
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = jest.fn();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        updateService = new UpdateService();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('parseVersion', () => {
        test('parses version with v prefix', () => {
            expect(updateService.parseVersion('v0.1.7')).toEqual({ major: 0, minor: 1, patch: 7 });
        });

        test('parses version without v prefix', () => {
            expect(updateService.parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
        });

        test('parses pre-release or build suffix versions', () => {
            expect(updateService.parseVersion('v1.0.0-beta.1')).toEqual({ major: 1, minor: 0, patch: 0 });
        });

        test('handles invalid version formats gracefully', () => {
            expect(updateService.parseVersion('invalid')).toEqual({ major: 0, minor: 0, patch: 0 });
            expect(updateService.parseVersion(null)).toEqual({ major: 0, minor: 0, patch: 0 });
            expect(updateService.parseVersion(undefined)).toEqual({ major: 0, minor: 0, patch: 0 });
        });
    });

    describe('compareVersions', () => {
        test('compares major versions', () => {
            expect(updateService.compareVersions('2.0.0', '1.9.9')).toBe(1);
            expect(updateService.compareVersions('1.0.0', '2.0.0')).toBe(-1);
        });

        test('compares minor versions', () => {
            expect(updateService.compareVersions('0.2.0', '0.1.9')).toBe(1);
            expect(updateService.compareVersions('0.1.5', '0.2.0')).toBe(-1);
        });

        test('compares patch versions', () => {
            expect(updateService.compareVersions('0.1.8', '0.1.7')).toBe(1);
            expect(updateService.compareVersions('0.1.7', '0.1.8')).toBe(-1);
        });

        test('compares identical versions', () => {
            expect(updateService.compareVersions('v0.1.7', '0.1.7')).toBe(0);
        });
    });

    describe('checkForUpdate', () => {
        test('detects when local is older than remote', async () => {
            jest.spyOn(updateService, 'getLocalVersion').mockReturnValue('0.1.7');
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tag_name: 'v0.1.8',
                    html_url: 'https://github.com/moneymanagerex/mmex-sync/releases/tag/v0.1.8',
                    assets: []
                })
            });

            const result = await updateService.checkForUpdate();

            expect(result.hasUpdate).toBe(true);
            expect(result.latestVersion).toBe('v0.1.8');
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('A new version is available: v0.1.8'));
        });

        test('detects when local is up to date', async () => {
            jest.spyOn(updateService, 'getLocalVersion').mockReturnValue('0.1.7');
            global.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tag_name: 'v0.1.7',
                    html_url: 'https://github.com/moneymanagerex/mmex-sync/releases/tag/v0.1.7',
                    assets: []
                })
            });

            const result = await updateService.checkForUpdate();

            expect(result.hasUpdate).toBe(false);
            expect(result.latestVersion).toBe('v0.1.7');
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('You are running the latest version'));
        });

        test('handles network errors gracefully', async () => {
            jest.spyOn(updateService, 'getLocalVersion').mockReturnValue('0.1.7');
            global.fetch.mockRejectedValueOnce(new Error('Connection failed'));

            const result = await updateService.checkForUpdate();

            expect(result.error).toBe('Connection failed');
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error checking for updates: Connection failed'));
        });
    });
});
