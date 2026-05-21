import { jest } from '@jest/globals';
import { PB_MOCK_SUCCESS_LIST, PB_MOCK_SUCCESS_RECORD } from '../__mocks__/pocketbaseMockData.js';

// Mock dependencies
const mockAuthWithPassword = jest.fn();
const mockGetFullList = jest.fn();
const mockGetFirstListItem = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();
const mockAuthStoreSave = jest.fn();
const mockAuthStoreClear = jest.fn();

jest.unstable_mockModule('pocketbase', () => {
    return {
        default: jest.fn().mockImplementation(() => {
            return {
                authStore: {
                    get token() { return 'mock-token'; },
                    save: mockAuthStoreSave,
                    clear: mockAuthStoreClear
                },
                collection: jest.fn().mockReturnValue({
                    authWithPassword: mockAuthWithPassword,
                    getFullList: mockGetFullList,
                    getFirstListItem: mockGetFirstListItem,
                    create: mockCreate,
                    update: mockUpdate,
                    delete: mockDelete,
                    subscribe: mockSubscribe
                }),
                realtime: {
                    unsubscribe: mockUnsubscribe
                }
            };
        })
    };
});

jest.unstable_mockModule('../../src/config/table_config.js', () => ({
    SYNC_CONFIG: {
        'ACCOUNTLIST_V1': { pk: 'ACCOUNTID' },
        'PAYEE_V1': { pk: 'PAYEEID' }
    },
    SYNC_ORDER: ['ACCOUNTLIST_V1', 'PAYEE_V1']
}));

jest.unstable_mockModule('../../src/utils/ProgressBarService.js', () => ({
    ProgressBarService: jest.fn().mockImplementation(() => ({
        update: jest.fn(),
        complete: jest.fn()
    }))
}));

const { PocketBaseService } = await import('../../src/api/PocketBaseService.js');

describe('PocketBaseService', () => {
    let service;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new PocketBaseService('http://localhost:8090');
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => true);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Auth & Tokens', () => {
        test('authenticates via users on first try', async () => {
            mockAuthWithPassword.mockResolvedValueOnce({ token: '123' });
            
            const result = await service.authenticate('test@test.com', 'pass');
            
            expect(mockAuthWithPassword).toHaveBeenCalledWith('test@test.com', 'pass');
            expect(service.authCollection).toBe('users');
            expect(result).toEqual({ token: '123' });
        });

        test('falls back to _superusers if users fails', async () => {
            // First try fails
            mockAuthWithPassword.mockRejectedValueOnce(new Error('Invalid credentials'));
            // Second try (fallback) succeeds
            mockAuthWithPassword.mockResolvedValueOnce({ token: '456' });

            const result = await service.authenticate('admin@test.com', 'admin');

            expect(mockAuthWithPassword).toHaveBeenCalledTimes(2);
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("trying '_superusers' fallback"));
            expect(service.authCollection).toBe('_superusers');
            expect(result).toEqual({ token: '456' });
        });

        test('throws exception if _superusers also fails', async () => {
            mockAuthWithPassword.mockRejectedValue(new Error('Auth failed'));
            await expect(service.authenticate('bad@test.com', 'bad')).rejects.toThrow('Auth failed');
        });

        test('handles getToken, setToken and invalidateToken', () => {
            expect(service.getToken()).toBe('mock-token');

            service.setToken('new-token');
            expect(mockAuthStoreSave).toHaveBeenCalledWith('new-token', null);

            service.invalidateToken();
            expect(mockAuthStoreClear).toHaveBeenCalled();
        });
    });

    describe('CRUD Operations', () => {
        test('getFullList applies filter correctly', async () => {
            mockGetFullList.mockResolvedValueOnce(PB_MOCK_SUCCESS_LIST.items);
            
            const result = await service.getFullList('ACCOUNTLIST_V1', 'updated > "2023-01-01"');
            
            expect(mockGetFullList).toHaveBeenCalledWith({
                filter: 'updated > "2023-01-01"',
                sort: "_updated_at"
            });
            expect(result).toEqual(PB_MOCK_SUCCESS_LIST.items);
        });

        test('getFullList does not apply filter if null', async () => {
            mockGetFullList.mockResolvedValueOnce([]);
            
            await service.getFullList('ACCOUNTLIST_V1');
            
            expect(mockGetFullList).toHaveBeenCalledWith({
                sort: "_updated_at"
            });
        });

        test('getByRowId correctly builds search string using SYNC_CONFIG', async () => {
            mockGetFirstListItem.mockResolvedValueOnce(PB_MOCK_SUCCESS_RECORD);
            
            const result = await service.getByRowId('ACCOUNTLIST_V1', '999');
            
            // For ACCOUNTLIST_V1 the pk is ACCOUNTID
            expect(mockGetFirstListItem).toHaveBeenCalledWith('ACCOUNTID = "999"');
            expect(result).toEqual(PB_MOCK_SUCCESS_RECORD);
        });

        test('create, update and delete call SDK correctly', async () => {
            mockCreate.mockResolvedValueOnce(PB_MOCK_SUCCESS_RECORD);
            mockUpdate.mockResolvedValueOnce(PB_MOCK_SUCCESS_RECORD);
            mockDelete.mockResolvedValueOnce(true);

            await service.create('ACCOUNTLIST_V1', { name: 'test' });
            expect(mockCreate).toHaveBeenCalledWith({ name: 'test' });

            await service.update('ACCOUNTLIST_V1', 'id123', { name: 'test2' });
            expect(mockUpdate).toHaveBeenCalledWith('id123', { name: 'test2' });

            await service.delete('ACCOUNTLIST_V1', 'id123');
            expect(mockDelete).toHaveBeenCalledWith('id123');
        });
    });

    describe('Subscriptions', () => {
        test('subscribe subscribes to provided tables or SYNC_ORDER', async () => {
            const callback = jest.fn();
            await service.subscribe(null, callback);
            
            // SYNC_ORDER has 2 elements, so two calls to collection().subscribe()
            expect(mockSubscribe).toHaveBeenCalledTimes(2);

            // Manually test trigger event if simulating SDK
            const callArgs = mockSubscribe.mock.calls[0];
            expect(callArgs[0]).toBe('*'); // subscribe all events
        });

        test('unsubscribeAll calls realtime.unsubscribe method', async () => {
            await service.unsubscribeAll();
            expect(mockUnsubscribe).toHaveBeenCalled();
        });
    });

    describe('clearRemoteServer', () => {
        test('deletes collections in reverse order (SYNC_ORDER)', async () => {
            // Simulate each collection having 1 record (taken from mocks)
            mockGetFullList.mockResolvedValue([{ id: 'id_to_delete' }]);
            
            await service.clearRemoteServer();
            
            // SYNC_ORDER is ['ACCOUNTLIST_V1', 'PAYEE_V1']
            // Reverse order will be ['PAYEE_V1', 'ACCOUNTLIST_V1']
            // getFullList called twice
            expect(mockGetFullList).toHaveBeenCalledTimes(2);
            // delete called twice
            expect(mockDelete).toHaveBeenCalledTimes(2);
            expect(mockDelete).toHaveBeenCalledWith('id_to_delete');
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("server cleared successfully"));
        });

        test('handles errors during clearRemoteServer (not 404, but e.g. 403 or others)', async () => {
            // Simulate an error (since PB never returns 404, we can test a generic 400 or 403)
            const mockError = new Error('Permission denied');
            mockError.status = 403; // different from 404 to trigger console.error in code
            mockGetFullList.mockRejectedValue(mockError);

            await service.clearRemoteServer();

            // The loop continues catching the error and printing it
            expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Error during cleanup'),
                'Permission denied'
            );
        });
    });
});
