import { jest } from '@jest/globals';
import { ProgressBarService } from '../../src/utils/ProgressBarService.js';

describe('ProgressBarService', () => {
    let processStdoutSpy;
    let consoleLogSpy;

    beforeEach(() => {
        // Intercept process.stdout.write and console.log to avoid polluting the test log
        // and to verify they are called correctly.
        processStdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('initializes default values correctly', () => {
        const bar = new ProgressBarService(100);
        expect(bar.total).toBe(100);
        expect(bar.size).toBe(20);
        expect(bar.current).toBe(0);
    });

    test('initializes correctly with custom size', () => {
        const bar = new ProgressBarService(50, 40);
        expect(bar.total).toBe(50);
        expect(bar.size).toBe(40);
    });

    test('setTotal updates the total and resets lastPercent', () => {
        const bar = new ProgressBarService(100);
        bar.lastPercent = 50; // simulate a previous update
        bar.setTotal(200);
        expect(bar.total).toBe(200);
        expect(bar.lastPercent).toBe(-1);
    });

    test('update does nothing if the total is 0', () => {
        const bar = new ProgressBarService(0);
        bar.update('Test', 1);
        expect(processStdoutSpy).not.toHaveBeenCalled();
    });

    test('update writes progress to stdout and adds newline when complete', () => {
        const bar = new ProgressBarService(2);
        
        // First step
        bar.update('Step 1', 1);
        expect(processStdoutSpy).toHaveBeenCalled();
        expect(bar.current).toBe(1);

        // Second step (completion)
        processStdoutSpy.mockClear();
        bar.update('Step 2', 1);
        
        // Should have called stdout.write for the bar and then for the newline '\n'
        expect(processStdoutSpy).toHaveBeenCalledTimes(2);
        expect(processStdoutSpy).toHaveBeenLastCalledWith('\n');
    });

    test('complete writes the end message to console.log', () => {
        const bar = new ProgressBarService(10);
        bar.complete('Done!');
        expect(consoleLogSpy).toHaveBeenCalledWith('✅ Done!');
    });
});
