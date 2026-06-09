import { jest } from '@jest/globals';

// 1. Mock del modulo nativo 'fs'
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

// 2. NUOVI MOCK: Mock per il modulo nativo 'node:sqlite'
const mockRun = jest.fn();
const mockAll = jest.fn();
const mockPrepare = jest.fn();
const mockExec = jest.fn();
const mockClose = jest.fn();

// Creiamo una funzione spy per tracciare il costruttore della classe
const mockDatabaseConstructor = jest.fn();

// Classe mock che imita DatabaseSync e notifica la spy quando viene istanziata
class MockDatabaseSync {
    constructor(path) {
        mockDatabaseConstructor(path);
        this.path = path;
    }
    prepare(query) { return mockPrepare(query); }
    exec(query) { return mockExec(query); }
    close() { return mockClose(); }
}

// Istruiamo Jest a intercettare l'import di 'node:sqlite'
jest.unstable_mockModule('node:sqlite', () => ({
    DatabaseSync: MockDatabaseSync
}));

// Mock della configurazione tabelle
jest.unstable_mockModule('../../src/config/table_config.js', () => ({
    SYNC_ORDER: ['ACCOUNTLIST_V1']
}));

// 3. Import dinamici dei moduli mockati
const fs = (await import('fs')).default;
const { DatabaseSync } = await import('node:sqlite');
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

        // Comportamento di default per il metodo prepare
        mockPrepare.mockReturnValue({
            run: mockRun,
            all: mockAll
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('connect()', () => {
        test('connects and analyzes schema via PRAGMA', () => {
            mockExistsSync.mockReturnValue(true);

            // Mock specifico per catturare la lettura dello schema tramite PRAGMA info
            mockPrepare.mockImplementation((query) => {
                return {
                    all: () => {
                        if (query.includes('PRAGMA table_info')) {
                            return [
                                { name: 'ACCOUNTID', pk: 1 },
                                { name: 'ACCOUNTNAME', pk: 0 },
                                { name: 'pb_id', pk: 0 },
                            ];
                        }
                        return [];
                    }
                };
            });

            service.connect();

            // CORRETTO: Adesso verifichiamo la spy legata all'istanziazione della classe
            expect(mockDatabaseConstructor).toHaveBeenCalledWith('/test/db.mmb');
            expect(service.schemas['ACCOUNTLIST_V1']).toBeDefined();
            expect(service.schemas['ACCOUNTLIST_V1'].pk).toBe('ACCOUNTID');
            expect(service.schemas['ACCOUNTLIST_V1'].fields).toContain('ACCOUNTNAME');
            expect(service.schemas['ACCOUNTLIST_V1'].techFields).toContain('pb_id');
        });

        test('creates database if create = true', () => {
            mockExistsSync.mockReturnValue(false);
            const spyCreateEmpty = jest.spyOn(service, 'createEmptyDatabase').mockImplementation(() => { });

            mockPrepare.mockImplementation(() => ({
                all: () => [{ name: 'ACCOUNTID', pk: 1 }]
            }));

            service.db = new DatabaseSync('/test/db.mmb');
            service.connect(true);

            expect(spyCreateEmpty).toHaveBeenCalled();
        });
    });

    describe('Sync Operations', () => {
        beforeEach(() => {
            service.db = new DatabaseSync('/test/db.mmb');
            service.schemas = {
                'ACCOUNTLIST_V1': {
                    pk: 'ACCOUNTID',
                    fields: ['ACCOUNTNAME'],
                    techFields: ['pb_id', 'pb_is_dirty', 'pb_updated_at']
                }
            };
            // CORRETTO: Rimosso "get: mockGet" che causava il ReferenceError
            mockPrepare.mockReturnValue({ run: mockRun, all: mockAll });
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
            const remoteRecord = {
                id: 'pb_999',
                _is_deleted: 0,
                _updated_at: '2023-01-01',
                ACCOUNTID: 55,
                ACCOUNTNAME: 'Nuovo Nome'
            };

            // CORRETTO: node:sqlite usa .all() estraendo il primo elemento. Simuliamo che esista restituendo l'array.
            mockAll.mockReturnValue([{ ROWID: 10 }]);

            service.applyRemoteChanges('ACCOUNTLIST_V1', remoteRecord);

            expect(mockExec).toHaveBeenCalledWith('BEGIN TRANSACTION');
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE ACCOUNTLIST_V1'));
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('SET ACCOUNTNAME = ?, pb_is_dirty = 2'));
            expect(mockPrepare).toHaveBeenCalledWith('UPDATE ACCOUNTLIST_V1 SET pb_is_dirty = 0 WHERE ROWID = ?');
            expect(mockExec).toHaveBeenCalledWith('COMMIT');
        });

        test('applyRemoteChanges (INSERT) creates record if not present', () => {
            const remoteRecord = {
                id: 'pb_999',
                _is_deleted: 0,
                _updated_at: '2023-01-01',
                ACCOUNTID: 55,
                ACCOUNTNAME: 'Nome Inserito'
            };

            // CORRETTO: Simuliamo che NON esista restituendo un array vuoto
            mockAll.mockReturnValue([]);
            mockRun.mockReturnValue({ lastInsertRowid: 20 });

            service.applyRemoteChanges('ACCOUNTLIST_V1', remoteRecord);

            expect(mockExec).toHaveBeenCalledWith('BEGIN TRANSACTION');
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO ACCOUNTLIST_V1'));
            expect(mockRun).toHaveBeenCalledWith(20);
            expect(mockExec).toHaveBeenCalledWith('COMMIT');
        });

        test('applyRemoteChanges (DELETE) deletes the record if marked deleted by the server', () => {
            const remoteRecord = {
                id: 'pb_999',
                _is_deleted: 1
            };

            // CORRETTO: Forniamo l'elemento dentro l'array per rispecchiare l'uso di .all()[0]
            mockAll.mockReturnValue([{ ROWID: 10, rowid: 10 }]);

            service.applyRemoteChanges('ACCOUNTLIST_V1', remoteRecord);

            expect(mockExec).toHaveBeenCalledWith('BEGIN TRANSACTION');
            expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM ACCOUNTLIST_V1 WHERE ROWID = ?');
            expect(mockRun).toHaveBeenCalledWith(10);
            expect(mockExec).toHaveBeenCalledWith('COMMIT');
        });

        test('resolveTagLinkConflict deletes old record and inserts new synchronized record', () => {
            service.schemas = {
                ...service.schemas,
                'TAGLINK_V1': {
                    pk: 'TAGLINKID',
                    fields: ['REFTYPE', 'REFID', 'TAGID'],
                    techFields: ['pb_id', 'pb_is_dirty', 'pb_updated_at']
                }
            };

            const remoteRecord = {
                id: 'pb_taglink_123',
                TAGLINKID: 123,
                REFTYPE: 'Transaction',
                REFID: 10,
                TAGID: 5,
                _updated_at: '2023-01-01T12:00:00Z'
            };

            mockRun.mockReturnValue({ lastInsertRowid: 50 });

            service.resolveTagLinkConflict(45, remoteRecord);

            expect(mockExec).toHaveBeenCalledWith('BEGIN TRANSACTION');
            // Delete old record
            expect(mockPrepare).toHaveBeenCalledWith('DELETE FROM TAGLINK_V1 WHERE ROWID = ?');
            expect(mockRun).toHaveBeenCalledWith(45);

            // Insert new record
            expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO TAGLINK_V1'));
            // Check mark synced
            expect(mockPrepare).toHaveBeenCalledWith('UPDATE TAGLINK_V1 SET pb_is_dirty = 0 WHERE ROWID = ?');
            expect(mockRun).toHaveBeenCalledWith(50);
            expect(mockExec).toHaveBeenCalledWith('COMMIT');
        });
    });

    describe('DB Management / init / schema', () => {
        test('close', () => {
            service.db = new DatabaseSync('/test/db.mmb');
            service.close();
            expect(mockClose).toHaveBeenCalled();
        });

        test('clearTechnicalSchema removes triggers and columns', () => {
            service.db = new DatabaseSync('/test/db.mmb');
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
            mockExistsSync.mockReturnValue(false);
            expect(() => {
                service.createEmptyDatabase();
            }).toThrow('File schema non trovato');
        });

        test('createEmptyDatabase deletes old DB, executes SQL script and sets pragmas', () => {
            mockExistsSync
                .mockReturnValueOnce(true) // sqlSchemaPath
                .mockReturnValueOnce(true); // dbPath

            mockReadFileSync.mockReturnValue('CREATE TABLE TEST;');

            const result = service.createEmptyDatabase();

            expect(mockUnlinkSync).toHaveBeenCalledWith('/test/db.mmb');
            expect(mockExec).toHaveBeenCalledWith('CREATE TABLE TEST;');

            // CORRETTO: Verifica che il pragma venga impostato via exec() e non più via pragma()
            expect(mockExec).toHaveBeenCalledWith('PRAGMA user_version = 21');
            expect(result).toBeDefined();
        });
    });
});