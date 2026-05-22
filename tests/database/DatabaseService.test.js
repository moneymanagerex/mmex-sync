import { jest } from '@jest/globals';

// Mock fs
const mockExistsSync = jest.fn();
const mockUnlinkSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: mockExistsSync,
        unlinkSync: mockUnlinkSync,
        readFileSync: mockReadFileSync
    }
}));

// Mock better-sqlite3
const mockRun = jest.fn();
const mockAll = jest.fn();
const mockGet = jest.fn();
const mockPrepare = jest.fn();
const mockExec = jest.fn();
const mockPragma = jest.fn();
const mockTransaction = jest.fn().mockImplementation((cb) => {
    // Returns a function that executes the callback, mocking better-sqlite3 transaction() behavior
    return (...args) => cb(...args); 
});
const mockClose = jest.fn();

jest.unstable_mockModule('better-sqlite3', () => ({
    default: jest.fn().mockImplementation(() => ({
        prepare: mockPrepare,
        exec: mockExec,
        pragma: mockPragma,
        transaction: mockTransaction,
        close: mockClose
    }))
}));

jest.unstable_mockModule('../../src/config/table_config.js', () => ({
    SYNC_ORDER: ['ACCOUNTLIST_V1']
}));

const fs = (await import('fs')).default;
const Database = (await import('better-sqlite3')).default;
const { DatabaseService } = await import('../../src/database/DatabaseService.js');

describe('DatabaseService', () => {
    let service;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new DatabaseService('/test/db.mmb', false);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => true);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => true);

        // Set the base mock for prepare() to return the run, all, get mocks
        mockPrepare.mockReturnValue({
            run: mockRun,
            all: mockAll,
            get: mockGet
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('connect()', () => {
        test('connects and analyzes schema via PRAGMA', () => {
            mockExistsSync.mockReturnValue(true);
            
            // Specific mock for PRAGMA table_info
            mockPrepare.mockImplementation((query) => {
                return {
                    all: () => {
                        if (query.includes('PRAGMA table_info')) {
                            return [
                                { name: 'ACCOUNTID', pk: 1 },
                                { name: 'ACCOUNTNAME', pk: 0 },
                                { name: 'pb_id', pk: 0 }, // technical field
                            ];
                        }
                        return [];
                    }
                };
            });

            service.connect();

            expect(Database).toHaveBeenCalledWith('/test/db.mmb');
            expect(service.schemas['ACCOUNTLIST_V1']).toBeDefined();
            expect(service.schemas['ACCOUNTLIST_V1'].pk).toBe('ACCOUNTID');
            expect(service.schemas['ACCOUNTLIST_V1'].fields).toContain('ACCOUNTNAME');
            expect(service.schemas['ACCOUNTLIST_V1'].techFields).toContain('pb_id');
        });

        test('creates database if create = true', () => {
            mockExistsSync.mockReturnValue(false); // fails first existsSync on sqlSchemaPath
            // Override createEmptyDatabase for this test
            const spyCreateEmpty = jest.spyOn(service, 'createEmptyDatabase').mockImplementation(() => {});
            
            // Mock for connect() when trying to read PRAGMA
            mockPrepare.mockImplementation(() => ({
                all: () => [{ name: 'ACCOUNTID', pk: 1 }]
            }));
            
            // mock db creation
            service.db = new Database('/test/db.mmb');

            service.connect(true);

            expect(spyCreateEmpty).toHaveBeenCalled();
        });
    });

    describe('Sync Operations', () => {
        beforeEach(() => {
            // Simulate connect without actually calling it, setting up service.db and service.schemas
            service.db = new Database('/test/db.mmb');
            service.schemas = {
                'ACCOUNTLIST_V1': {
                    pk: 'ACCOUNTID',
                    fields: ['ACCOUNTNAME'],
                    techFields: ['pb_id', 'pb_is_dirty', 'pb_updated_at']
                }
            };
            mockPrepare.mockReturnValue({ run: mockRun, all: mockAll, get: mockGet });
        });

        test('getDirtyRecords filters by pb_is_dirty or unassociated records', () => {
            service.getDirtyRecords('ACCOUNTLIST_V1', false);
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE pb_is_dirty = 1 OR pb_id = \'\' OR pb_id IS NULL'));
            expect(mockAll).toHaveBeenCalled();
        });

        test('getDirtyRecords in force mode gets everything', () => {
            service.getDirtyRecords('ACCOUNTLIST_V1', true);
            expect(mockPrepare).toHaveBeenCalledWith('SELECT *, ROWID as rowid FROM ACCOUNTLIST_V1');
            expect(mockAll).toHaveBeenCalled();
        });

        test('setPendingStatus / setSyncedStatus / setDirtyStatus execute the correct UPDATEs', () => {
            service.setPendingStatus('ACCOUNTLIST_V1', 123);
            expect(mockPrepare).toHaveBeenCalledWith('UPDATE ACCOUNTLIST_V1 SET pb_is_dirty = 2 WHERE ROWID = ?');
            expect(mockRun).toHaveBeenCalledWith(123);

            service.setSyncedStatus('ACCOUNTLIST_V1', 123, 'pb_999');
            expect(mockPrepare).toHaveBeenCalledWith('UPDATE ACCOUNTLIST_V1 SET pb_is_dirty = 0, pb_id = ? WHERE ROWID = ?');
            expect(mockRun).toHaveBeenCalledWith('pb_999', 123);

            service.setDirtyStatus('ACCOUNTLIST_V1', 123);
            expect(mockPrepare).toHaveBeenCalledWith('UPDATE ACCOUNTLIST_V1 SET pb_is_dirty = 1 WHERE ROWID = ?');
            expect(mockRun).toHaveBeenCalledWith(123);
        });

        test('applyRemoteChanges (UPDATE) updates the record if already present', () => {
            // Fake remote record
            const remoteRecord = {
                id: 'pb_999',
                _is_deleted: 0,
                _updated_at: '2023-01-01',
                ACCOUNTID: 55,
                ACCOUNTNAME: 'Nuovo Nome'
            };

            // Simulate that it already exists
            mockGet.mockReturnValue({ ROWID: 10 });

            service.applyRemoteChanges('ACCOUNTLIST_V1', remoteRecord);

            // Transaction called
            expect(mockTransaction).toHaveBeenCalled();
            // Check update that should bypass triggers (pb_is_dirty=2)
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE ACCOUNTLIST_V1'));
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('SET ACCOUNTNAME = ?, pb_is_dirty = 2'));
            // reset to 0 executed
            expect(mockPrepare).toHaveBeenCalledWith('UPDATE ACCOUNTLIST_V1 SET pb_is_dirty = 0 WHERE ROWID = ?');
        });

        test('applyRemoteChanges (INSERT) creates record if not present', () => {
            const remoteRecord = {
                id: 'pb_999',
                _is_deleted: 0,
                _updated_at: '2023-01-01',
                ACCOUNTID: 55,
                ACCOUNTNAME: 'Nome Inserito'
            };

            // Simulate NOT present
            mockGet.mockReturnValue(undefined);
            mockRun.mockReturnValue({ lastInsertRowid: 20 }); // return value of insert run

            service.applyRemoteChanges('ACCOUNTLIST_V1', remoteRecord);

            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ACCOUNTLIST_V1'));
            // The reset to 0 must use the lastInsertRowid (20)
            expect(mockRun).toHaveBeenCalledWith(20);
        });
        
        test('applyRemoteChanges (DELETE) deletes the record if marked deleted by the server', () => {
            const remoteRecord = {
                id: 'pb_999',
                _is_deleted: 1
            };
            mockGet.mockReturnValue({ ROWID: 10, rowid: 10 });

            service.applyRemoteChanges('ACCOUNTLIST_V1', remoteRecord);
            
            expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM ACCOUNTLIST_V1 WHERE ROWID = ?');
            expect(mockRun).toHaveBeenCalledWith(10);
        });
    });

    describe('DB Management / init / schema', () => {
        test('close', () => {
            service.db = new Database('/test/db.mmb');
            service.close();
            expect(mockClose).toHaveBeenCalled();
        });

        test('clearTechnicalSchema removes triggers and columns', () => {
            service.db = new Database('/test/db.mmb');
            service.schemas = {
                'ACCOUNTLIST_V1': { techFields: ['pb_id'] }
            };
            mockPrepare.mockReturnValue({ run: mockRun });
            
            service.clearTechnicalSchema();
            
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DROP TRIGGER IF EXISTS TRG_ACCOUNTLIST_V1_INSERT'));
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DROP COLUMN pb_id'));
            expect(mockPrepare).toHaveBeenCalledWith('DROP TABLE IF EXISTS pb_DELETED_RECORDS_LOG');
        });

        test('createEmptyDatabase throws error if SQL files are not found', () => {
            mockExistsSync.mockReturnValue(false); // fails /assets/sql/... and .sql
            expect(() => {
                service.createEmptyDatabase();
            }).toThrow('File schema non trovato'); // keeping the original error message text from the code
        });

        test('createEmptyDatabase deletes old DB, executes SQL script and sets pragmas', () => {
            mockExistsSync
                .mockReturnValueOnce(true) // sqlSchemaPath in root ./assets/sql
                .mockReturnValueOnce(true); // dbPath already exists, so unlink
                
            mockReadFileSync.mockReturnValue('CREATE TABLE TEST;');
            
            const result = service.createEmptyDatabase();
            
            expect(mockUnlinkSync).toHaveBeenCalledWith('/test/db.mmb');
            expect(mockExec).toHaveBeenCalledWith('CREATE TABLE TEST;');
            expect(mockPragma).toHaveBeenCalledWith('user_version = 21');
            expect(result).toBeDefined();
        });
    });
});
