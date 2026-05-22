import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/config/table_config.js', () => ({
    SYNC_ORDER: ['ACCOUNTLIST_V1']
}));

jest.unstable_mockModule('../../src/utils/ProgressBarService.js', () => ({
    ProgressBarService: jest.fn().mockImplementation(() => ({
        update: jest.fn(),
        complete: jest.fn()
    }))
}));

const { SyncService } = await import('../../src/services/SyncService.js');

describe('SyncService', () => {
    let syncService;
    let mockDbService;
    let mockPbService;
    let mockConfigManager;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        
        mockDbService = {
            getDirtyRecords: jest.fn(),
            setSyncedStatus: jest.fn(),
            resetUnfinishedOps: jest.fn(),
            applyRemoteChanges: jest.fn(),
            getDeletedLog: jest.fn(),
            clearDeletedLog: jest.fn(),
            schemas: {
                'ACCOUNTLIST_V1': { pk: 'ACCOUNTID' }
            }
        };

        mockPbService = {
            update: jest.fn(),
            create: jest.fn(),
            getByRowId: jest.fn(),
            getFullList: jest.fn(),
            delete: jest.fn()
        };

        mockConfigManager = {
            config: {
                lastSync: '2023-01-01T12:00:00.000Z'
            },
            save: jest.fn()
        };

        // Default options verbose off to avoid noise, force off
        const options = { verbose: false, force: false, sync: true };
        
        syncService = new SyncService(mockDbService, mockPbService, mockConfigManager, options);
        
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => true);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('pushTable', () => {
        test('returns immediately if there are no dirty records', async () => {
            mockDbService.getDirtyRecords.mockReturnValue([]);
            await syncService.pushTable('ACCOUNTLIST_V1');
            expect(mockPbService.create).not.toHaveBeenCalled();
            expect(mockPbService.update).not.toHaveBeenCalled();
        });

        test('executes CREATE if pb_id is missing', async () => {
            mockDbService.getDirtyRecords.mockReturnValue([{ rowid: 1, name: 'Test' }]);
            mockPbService.create.mockResolvedValue({ id: 'pb_123' });

            await syncService.pushTable('ACCOUNTLIST_V1');

            expect(mockPbService.create).toHaveBeenCalled();
            // Verify that setSyncedStatus is called with the new pb_id
            expect(mockDbService.setSyncedStatus).toHaveBeenCalledWith('ACCOUNTLIST_V1', 1, 'pb_123');
        });

        test('executes UPDATE if pb_id is present', async () => {
            mockDbService.getDirtyRecords.mockReturnValue([{ rowid: 1, pb_id: 'pb_999', name: 'Test' }]);
            mockPbService.update.mockResolvedValue({ id: 'pb_999' });

            await syncService.pushTable('ACCOUNTLIST_V1');

            expect(mockPbService.update).toHaveBeenCalledWith('ACCOUNTLIST_V1', 'pb_999', expect.any(Object));
            // Does not call setSyncedStatus because the id hasn't changed
            expect(mockDbService.setSyncedStatus).not.toHaveBeenCalled();
        });

        test('falls back to CREATE if UPDATE returns 404 error', async () => {
            mockDbService.getDirtyRecords.mockReturnValue([{ rowid: 1, pb_id: 'pb_old', name: 'Test' }]);
            
            const error404 = new Error('Not found');
            error404.status = 404;
            mockPbService.update.mockRejectedValueOnce(error404);
            mockPbService.create.mockResolvedValue({ id: 'pb_new' });

            await syncService.pushTable('ACCOUNTLIST_V1');

            expect(mockPbService.update).toHaveBeenCalled();
            expect(mockPbService.create).toHaveBeenCalled();
            expect(mockDbService.setSyncedStatus).toHaveBeenCalledWith('ACCOUNTLIST_V1', 1, 'pb_new');
        });

        test('handles validation_not_unique error by fetching remote id and retrying update', async () => {
            mockDbService.getDirtyRecords.mockReturnValue([{ rowid: 1, name: 'Test' }]);
            
            // Simulate validation error
            const validationError = { response: { data: { _userid: { code: 'validation_not_unique' } } } };
            mockPbService.create.mockRejectedValueOnce(validationError);
            
            // Simulate fetch from remote db
            mockPbService.getByRowId.mockResolvedValue({ id: 'pb_remote_123' });
            
            // Simulate subsequent update
            mockPbService.update.mockResolvedValue({ id: 'pb_remote_123' });

            await syncService.pushTable('ACCOUNTLIST_V1');

            expect(mockPbService.create).toHaveBeenCalled();
            expect(mockPbService.getByRowId).toHaveBeenCalledWith('ACCOUNTLIST_V1', 1);
            expect(mockPbService.update).toHaveBeenCalledWith('ACCOUNTLIST_V1', 'pb_remote_123', expect.any(Object));
            expect(mockDbService.setSyncedStatus).toHaveBeenCalledWith('ACCOUNTLIST_V1', 1, 'pb_remote_123');
        });
    });

    describe('pullTable', () => {
        test('uses lastSync filter if force = false', async () => {
            mockPbService.getFullList.mockResolvedValue([]);
            
            await syncService.pullTable('ACCOUNTLIST_V1');
            
            // lastSync was 12:00, -5 seconds -> 11:59:55
            expect(mockPbService.getFullList).toHaveBeenCalledWith('ACCOUNTLIST_V1', expect.stringContaining('11:59:55'));
        });

        test('does not use filter if force = true', async () => {
            syncService.options.force = true;
            mockPbService.getFullList.mockResolvedValue([]);
            
            await syncService.pullTable('ACCOUNTLIST_V1');
            
            expect(mockPbService.getFullList).toHaveBeenCalledWith('ACCOUNTLIST_V1', '');
        });

        test('processes remote records by updating the local database', async () => {
            const remoteRecords = [{ id: 'pb_1' }, { id: 'pb_2' }];
            mockPbService.getFullList.mockResolvedValue(remoteRecords);
            
            const result = await syncService.pullTable('ACCOUNTLIST_V1');
            
            expect(mockDbService.applyRemoteChanges).toHaveBeenCalledTimes(2);
            expect(mockDbService.resetUnfinishedOps).toHaveBeenCalledWith('ACCOUNTLIST_V1');
            expect(result).toBe(true);
        });

        test('catches errors during applyRemoteChanges and returns false', async () => {
            const remoteRecords = [{ id: 'pb_1' }];
            mockPbService.getFullList.mockResolvedValue(remoteRecords);
            
            mockDbService.applyRemoteChanges.mockImplementation(() => {
                throw new Error('Local DB locked');
            });
            
            const result = await syncService.pullTable('ACCOUNTLIST_V1');
            
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('applyRemoteChanges error'), 'Local DB locked');
            expect(result).toBe(false);
        });
    });

    describe('syncDeletions', () => {
        test('exits if the log is empty', async () => {
            mockDbService.getDeletedLog.mockReturnValue([]);
            await syncService.syncDeletions();
            expect(mockPbService.delete).not.toHaveBeenCalled();
        });

        test('executes deletes on pb for each record in the log', async () => {
            mockDbService.getDeletedLog.mockReturnValue([
                { TABLE_NAME: 'ACCOUNTLIST_V1', PB_ID: 'pb_1' }
            ]);

            await syncService.syncDeletions();

            expect(mockPbService.delete).toHaveBeenCalledWith('ACCOUNTLIST_V1', 'pb_1');
            expect(mockDbService.clearDeletedLog).toHaveBeenCalled();
        });

        test('ignores 404 errors (already deleted on server)', async () => {
            mockDbService.getDeletedLog.mockReturnValue([
                { TABLE_NAME: 'ACCOUNTLIST_V1', PB_ID: 'pb_1' }
            ]);
            
            const error404 = new Error('Not found');
            error404.status = 404;
            mockPbService.delete.mockRejectedValueOnce(error404);

            await syncService.syncDeletions();

            expect(consoleErrorSpy).not.toHaveBeenCalled(); // 404 error is silenced
            expect(mockDbService.clearDeletedLog).toHaveBeenCalled();
        });
    });

    describe('runSyncCycle', () => {
        beforeEach(() => {
            syncService.pushTable = jest.fn();
            syncService.pullTable = jest.fn().mockResolvedValue(true);
        });

        test('executes push and pull if options.sync = true', async () => {
            await syncService.runSyncCycle();
            
            // In SYNC_ORDER there is only one element 'ACCOUNTLIST_V1'
            expect(syncService.pushTable).toHaveBeenCalledWith('ACCOUNTLIST_V1');
            expect(syncService.pullTable).toHaveBeenCalledWith('ACCOUNTLIST_V1');
            // Must save the config
            expect(mockConfigManager.save).toHaveBeenCalled();
        });

        test('executes only push if options.sync = "push"', async () => {
            syncService.options.sync = "push";
            
            await syncService.runSyncCycle();
            
            expect(syncService.pushTable).toHaveBeenCalledWith('ACCOUNTLIST_V1');
            expect(syncService.pullTable).not.toHaveBeenCalled();
            expect(mockConfigManager.save).not.toHaveBeenCalled(); // config save only happens post-pull
        });

        test('does not save the config if pull fails (result = false)', async () => {
            syncService.pullTable.mockResolvedValue(false);
            
            await syncService.runSyncCycle();
            
            expect(mockConfigManager.save).not.toHaveBeenCalled();
        });
    });
});
