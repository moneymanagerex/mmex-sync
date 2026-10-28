import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { waitForExit } from '../../src/utils/waitForExit.js';
import { EventEmitter } from 'events';

describe('waitForExit', () => {
    let mockStdin;
    let mockStdout;

    beforeEach(() => {
        mockStdin = new EventEmitter();
        mockStdin.isTTY = true;
        mockStdin.setRawMode = jest.fn();
        mockStdin.resume = jest.fn();
        mockStdin.pause = jest.fn();

        mockStdout = {
            write: jest.fn()
        };
    });

    test('should resolve immediately if noWait is true', async () => {
        await waitForExit({ noWait: true, stdin: mockStdin, stdout: mockStdout });
        expect(mockStdout.write).not.toHaveBeenCalled();
    });

    test('should resolve immediately if stdin is not TTY', async () => {
        mockStdin.isTTY = false;
        await waitForExit({ stdin: mockStdin, stdout: mockStdout });
        expect(mockStdout.write).not.toHaveBeenCalled();
    });

    test('should resolve automatically after timeout if no key is pressed', async () => {
        jest.useFakeTimers();
        const promise = waitForExit({ timeoutMs: 3000, stdin: mockStdin, stdout: mockStdout });

        expect(mockStdout.write).toHaveBeenCalledWith('Press any key to wait befor close (3 seconds)\n');
        expect(mockStdin.resume).toHaveBeenCalled();

        jest.advanceTimersByTime(3000);
        await promise;

        expect(mockStdin.pause).toHaveBeenCalled();
        jest.useRealTimers();
    });

    test('should change message on keypress and wait for second keypress to exit', async () => {
        jest.useFakeTimers();
        const promise = waitForExit({ timeoutMs: 3000, stdin: mockStdin, stdout: mockStdout });

        expect(mockStdout.write).toHaveBeenCalledWith('Press any key to wait befor close (3 seconds)\n');

        // First keypress: pauses timeout and changes message
        mockStdin.emit('data', Buffer.from('a'));
        expect(mockStdout.write).toHaveBeenCalledWith('Press any key to exit\n');

        // Advance time past 3s to prove timer was cancelled
        jest.advanceTimersByTime(5000);

        // Second keypress: exits
        mockStdin.emit('data', Buffer.from('b'));

        await promise;
        expect(mockStdin.pause).toHaveBeenCalled();
        jest.useRealTimers();
    });
});
