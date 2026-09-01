import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { expandTildePath } from '../../src/utils/pathUtils.js';
import os from 'os';
import path from 'path';

describe('pathUtils', () => {
    describe('expandTildePath', () => {
        let homeDir;

        beforeEach(() => {
            homeDir = os.homedir();
        });

        test('should expand tilde to home directory', () => {
            const result = expandTildePath('~/documents/file.txt');
            const expected = path.join(homeDir, 'documents/file.txt');
            expect(result).toBe(expected);
        });

        test('should expand tilde with multiple path segments', () => {
            const result = expandTildePath('~/mmex-sync/new.mmb');
            const expected = path.join(homeDir, 'mmex-sync/new.mmb');
            expect(result).toBe(expected);
        });

        test('should expand tilde in database file path', () => {
            const result = expandTildePath('~/db/myfinances.mmb');
            const expected = path.join(homeDir, 'db/myfinances.mmb');
            expect(result).toBe(expected);
        });

        test('should expand tilde in executable path', () => {
            const result = expandTildePath('~/path/to/mmex.exe');
            const expected = path.join(homeDir, 'path/to/mmex.exe');
            expect(result).toBe(expected);
        });

        test('should not modify absolute paths without tilde', () => {
            const absolutePath = '/home/user/documents/file.txt';
            const result = expandTildePath(absolutePath);
            expect(result).toBe(absolutePath);
        });

        test('should not modify relative paths without tilde', () => {
            const relativePath = './documents/file.txt';
            const result = expandTildePath(relativePath);
            expect(result).toBe(relativePath);
        });

        test('should not modify relative paths with ..', () => {
            const relativePath = '../documents/file.txt';
            const result = expandTildePath(relativePath);
            expect(result).toBe(relativePath);
        });

        test('should handle null value', () => {
            const result = expandTildePath(null);
            expect(result).toBeNull();
        });

        test('should handle undefined value', () => {
            const result = expandTildePath(undefined);
            expect(result).toBeUndefined();
        });

        test('should handle empty string', () => {
            const result = expandTildePath('');
            expect(result).toBe('');
        });

        test('should only expand tilde at start of path', () => {
            const result = expandTildePath('file~name/documents/file.txt');
            expect(result).toBe('file~name/documents/file.txt');
        });
    });
});
