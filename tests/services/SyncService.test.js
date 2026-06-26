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
            getDeletedLog: jest.fn().mockReturnValue([]),
            clearDeletedLog: jest.fn(),
            removeDeletedRecordLog: jest.fn(),
            resolveTagLinkConflict: jest.fn(),
            schemas: {
                'ACCOUNTLIST_V1': { pk: 'ACCOUNTID' }
            }
        };

        mockPbService = {
            update: jest.fn(),
            create: jest.fn(),
            getByRowId: jest.fn(),
            getById: jest.fn(),
            getRemoteRecordByUniqueKeys: jest.fn(),
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

        test('handles validation_not_unique error for TAGLINK_V1 by querying remote unique keys and resolving conflict', async () => {
            const record = { rowid: 1, REFTYPE: 'Transaction', REFID: 10, TAGID: 5 };
            mockDbService.getDirtyRecords.mockReturnValue([record]);

            const validationError = { response: { data: { REFTYPE: { code: 'validation_not_unique' } } } };
            mockPbService.create.mockRejectedValueOnce(validationError);

            const remoteRecord = { id: 'pb_taglink_123', TAGLINKID: 123, REFTYPE: 'Transaction', REFID: 10, TAGID: 5 };
            mockPbService.getRemoteRecordByUniqueKeys.mockResolvedValueOnce(remoteRecord);

            await syncService.pushTable('TAGLINK_V1');

            expect(mockPbService.create).toHaveBeenCalled();
            expect(mockPbService.getRemoteRecordByUniqueKeys).toHaveBeenCalledWith('TAGLINK_V1', { REFTYPE: 'Transaction', REFID: 10, TAGID: 5 });
            expect(mockDbService.resolveTagLinkConflict).toHaveBeenCalledWith(1, remoteRecord);
        });

        test('handles 409 conflict during update by fetching remote record via getById and applying changes', async () => {
            mockDbService.getDirtyRecords.mockReturnValue([{ rowid: 1, pb_id: 'pb_999', name: 'Test' }]);
            
            const error409 = new Error('Conflict');
            error409.status = 409;
            mockPbService.update.mockRejectedValueOnce(error409);
            
            const remoteRecord = { id: 'pb_999', name: 'Server Test', updated: '2023-01-01T12:00:00.000Z' };
            mockPbService.getById.mockResolvedValueOnce(remoteRecord);

            await syncService.pushTable('ACCOUNTLIST_V1');

            expect(mockPbService.update).toHaveBeenCalled();
            expect(mockPbService.getById).toHaveBeenCalledWith('ACCOUNTLIST_V1', 'pb_999');
            expect(mockDbService.applyRemoteChanges).toHaveBeenCalledWith('ACCOUNTLIST_V1', remoteRecord);
        });

        test('does not handle 409 conflict during create (no pb_id) and logs critical error', async () => {
            mockDbService.getDirtyRecords.mockReturnValue([{ rowid: 1, name: 'Test' }]);
            
            const error409 = new Error('Conflict');
            error409.status = 409;
            mockPbService.create.mockRejectedValueOnce(error409);

            await syncService.pushTable('ACCOUNTLIST_V1');

            expect(mockPbService.create).toHaveBeenCalled();
            expect(mockPbService.getByRowId).not.toHaveBeenCalled();
            expect(mockDbService.applyRemoteChanges).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('Critical push error on ACCOUNTLIST_V1'),
                'Conflict'
            );
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
            expect(mockPbService.update).not.toHaveBeenCalled();
        });

        test('executes deletes on pb for each record in the log', async () => {
            mockDbService.getDeletedLog.mockReturnValue([
                { TABLE_NAME: 'ACCOUNTLIST_V1', PB_ID: 'pb_1' }
            ]);

            await syncService.syncDeletions();

            expect(mockPbService.update).toHaveBeenCalledWith('ACCOUNTLIST_V1', 'pb_1', { _is_deleted: 1 });
            expect(mockDbService.removeDeletedRecordLog).toHaveBeenCalledWith('ACCOUNTLIST_V1', 'pb_1');
        });

        test('ignores 404 errors (already deleted on server)', async () => {
            mockDbService.getDeletedLog.mockReturnValue([
                { TABLE_NAME: 'ACCOUNTLIST_V1', PB_ID: 'pb_1' }
            ]);
            
            const error404 = new Error('Not found');
            error404.status = 404;
            mockPbService.update.mockRejectedValueOnce(error404);

            await syncService.syncDeletions();

            expect(consoleErrorSpy).not.toHaveBeenCalled(); // 404 error is silenced
            expect(mockDbService.removeDeletedRecordLog).toHaveBeenCalledWith('ACCOUNTLIST_V1', 'pb_1');
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
