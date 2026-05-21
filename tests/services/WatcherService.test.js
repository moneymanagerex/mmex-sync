import { jest } from '@jest/globals';

const mockWatchOn = jest.fn();
const mockWatchClose = jest.fn();
const mockChokidarWatch = jest.fn().mockReturnValue({
    on: mockWatchOn,
    close: mockWatchClose
});

jest.unstable_mockModule('chokidar', () => ({
    default: {
        watch: mockChokidarWatch
    }
}));

const { WatcherService } = await import('../../src/services/WatcherService.js');

describe('WatcherService', () => {
    let watcher;
    let mockDbService;
    let mockPbService;
    let mockSyncService;
    let mockConfig;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        mockDbService = {};
        mockPbService = {
            subscribe: jest.fn(),
            unsubscribeAll: jest.fn()
        };
        mockSyncService = {
            runSyncCycle: jest.fn().mockResolvedValue(true)
        };
        mockConfig = {
            dbPath: '/test/test.mmb'
        };

        watcher = new WatcherService(mockDbService, mockPbService, mockSyncService, mockConfig);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => true);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => true);
        
        // To be able to manually trigger the callback associated with the 'change' event
        mockWatchOn.mockImplementation((event, cb) => {
            if (event === 'change') {
                watcher._localChangeCallback = cb;
            }
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('start() and listeners', () => {
        test('start initializes chokidar and pb subscribe', async () => {
            await watcher.start();

            expect(mockChokidarWatch).toHaveBeenCalledWith('/test/test.mmb', expect.any(Object));
            expect(mockWatchOn).toHaveBeenCalledWith('change', expect.any(Function));
            expect(mockPbService.subscribe).toHaveBeenCalledWith(null, expect.any(Function));
        });

        test('handles errors during pb subscribe', async () => {
            mockPbService.subscribe.mockRejectedValueOnce(new Error('Network Error'));
            
            await watcher.start();
            
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Realtime error'), 'Network Error');
        });
    });

    describe('stop()', () => {
        test('closes file watcher and unsubscribes from pb', async () => {
            watcher.fileWatcher = { close: mockWatchClose }; // fake init
            
            await watcher.stop();

            expect(mockWatchClose).toHaveBeenCalled();
            expect(mockPbService.unsubscribeAll).toHaveBeenCalled();
        });

        test('handles errors during stop', async () => {
            watcher.fileWatcher = { close: mockWatchClose };
            mockPbService.unsubscribeAll.mockRejectedValueOnce(new Error('Unsubscribe failed'));

            await watcher.stop();

            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error during unsubscribe'), 'Unsubscribe failed');
        });
    });

    describe('Event logic and debounce (_triggerSync)', () => {
        beforeEach(async () => {
            await watcher.start();
        });

        test('local change starts a sync with delay (debounce)', () => {
            // Invoke the fake trigger saved by the mock
            watcher._localChangeCallback();

            expect(mockSyncService.runSyncCycle).not.toHaveBeenCalled(); // Not yet executed due to debounce
            
            // Advance time (default 2000 for local)
            jest.advanceTimersByTime(2000);
            
            expect(mockSyncService.runSyncCycle).toHaveBeenCalledTimes(1);
            expect(watcher.ignoreNextLocalChange).toBe(true);
        });

        test('local change ignored if ignoreNextLocalChange is true', () => {
            watcher.ignoreNextLocalChange = true;
            
            watcher._localChangeCallback();
            
            // Flag is consumed and trigger is not called
            expect(watcher.ignoreNextLocalChange).toBe(false);
            expect(mockSyncService.runSyncCycle).not.toHaveBeenCalled();
            
            // Advance time to be sure
            jest.advanceTimersByTime(5000);
            expect(mockSyncService.runSyncCycle).not.toHaveBeenCalled();
        });

        test('local change ignored if a sync is already in progress', () => {
            watcher.isSyncing = true;
            
            watcher._localChangeCallback();
            
            jest.advanceTimersByTime(5000);
            expect(mockSyncService.runSyncCycle).not.toHaveBeenCalled();
        });

        test('remote change (from pb callback) starts a sync with delay 5000', async () => {
            // Capture the subscribe callback
            const subscribeCallback = mockPbService.subscribe.mock.calls[0][1];
            
            // Execute the fake remote callback
            subscribeCallback({ collection: 'TEST', action: 'update', record: {} });
            
            expect(mockSyncService.runSyncCycle).not.toHaveBeenCalled();
            
            // If we advance by 2000 (local delay) it shouldn't trigger
            jest.advanceTimersByTime(2000);
            expect(mockSyncService.runSyncCycle).not.toHaveBeenCalled();

            // Advance the remaining 3000
            jest.advanceTimersByTime(3000);
            expect(mockSyncService.runSyncCycle).toHaveBeenCalledTimes(1);
        });

        test('rapid calls (debounce) reset the timer and execute runSyncCycle only once', () => {
            watcher._triggerSync('local', 2000); // 1
            jest.advanceTimersByTime(1000);
            
            watcher._triggerSync('local', 2000); // 2, overwrites
            jest.advanceTimersByTime(1000);
            
            // At this point 2 seconds have passed since the first call, but timer was reset, so it hasn't fired yet
            expect(mockSyncService.runSyncCycle).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1000); 
            // 2 seconds since the second call, it fires
            expect(mockSyncService.runSyncCycle).toHaveBeenCalledTimes(1);
        });
        
        test('errors in runSyncCycle handle flags correctly', async () => {
            // Force a synchronous/asynchronous error in runSyncCycle
            mockSyncService.runSyncCycle.mockRejectedValueOnce(new Error('Sync failure'));
            
            watcher._triggerSync('local', 100);
            
            // Resolve pending Promises from timer
            await jest.advanceTimersByTimeAsync(100);
            
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error during automatic sync'), 'Sync failure');
            
            // Finally must ensure isSyncing returns to false
            expect(watcher.isSyncing).toBe(false);
        });
    });
});
