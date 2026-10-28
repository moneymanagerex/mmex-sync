// tests/utils/security.test.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    getDefaultConfigDir,
    getOrCreateMasterKey,
    protect,
    unprotect
} from '../../src/utils/security.js';

describe('security utility (cross-platform AES-256-GCM)', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmex-sec-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('getDefaultConfigDir', () => {
        test('returns string path', () => {
            const configDir = getDefaultConfigDir();
            expect(typeof configDir).toBe('string');
            expect(configDir.length).toBeGreaterThan(0);
        });
    });

    describe('getOrCreateMasterKey', () => {
        test('generates a 32-byte key file and reuses it', () => {
            const key1 = getOrCreateMasterKey(tempDir);
            expect(Buffer.isBuffer(key1)).toBe(true);
            expect(key1.length).toBe(32);

            const keyPath = path.join(tempDir, '.key');
            expect(fs.existsSync(keyPath)).toBe(true);

            // Second call should return the exact same key
            const key2 = getOrCreateMasterKey(tempDir);
            expect(key2.equals(key1)).toBe(true);
        });

        test('regenerates key if existing keyfile is corrupted/invalid size', () => {
            const keyPath = path.join(tempDir, '.key');
            fs.writeFileSync(keyPath, Buffer.from('too-short'));

            const key = getOrCreateMasterKey(tempDir);
            expect(key.length).toBe(32);
            expect(key.toString('utf8')).not.toBe('too-short');
        });
    });

    describe('protect and unprotect', () => {
        test('encrypts and decrypts plaintext successfully', () => {
            const secret = 'my-super-secret-token-12345!@#$%^&*()_+';
            const encrypted = protect(secret, tempDir);

            expect(typeof encrypted).toBe('string');
            expect(encrypted.startsWith('v1:')).toBe(true);

            const decrypted = unprotect(encrypted, tempDir);
            expect(decrypted).toBe(secret);
        });

        test('handles UTF-8 and multilingual strings', () => {
            const secret = 'Password 🔐 with accents: àéîôù and CJK: 财务同步';
            const encrypted = protect(secret, tempDir);
            const decrypted = unprotect(encrypted, tempDir);
            expect(decrypted).toBe(secret);
        });

        test('generates unique ciphertexts (different IVs) for identical plaintext', () => {
            const secret = 'same-token-value';
            const enc1 = protect(secret, tempDir);
            const enc2 = protect(secret, tempDir);

            expect(enc1).not.toBe(enc2);
            expect(unprotect(enc1, tempDir)).toBe(secret);
            expect(unprotect(enc2, tempDir)).toBe(secret);
        });

        test('handles empty or non-string inputs gracefully', () => {
            expect(protect('', tempDir)).toBe('');
            expect(protect(null, tempDir)).toBe('');
            expect(protect(undefined, tempDir)).toBe('');

            expect(unprotect('', tempDir)).toBeNull();
            expect(unprotect(null, tempDir)).toBeNull();
            expect(unprotect(undefined, tempDir)).toBeNull();
            expect(unprotect('invalid-format', tempDir)).toBeNull();
        });

        test('fails to decrypt if ciphertext is tampered with (AEAD integrity protection)', () => {
            const secret = 'tamper-test-secret';
            const encrypted = protect(secret, tempDir);
            const parts = encrypted.split(':');

            // Tamper with encrypted data payload
            const corruptedData = Buffer.from(parts[3], 'base64');
            corruptedData[0] = corruptedData[0] ^ 0xFF;
            const tamperedPayload = `${parts[0]}:${parts[1]}:${parts[2]}:${corruptedData.toString('base64')}`;

            expect(unprotect(tamperedPayload, tempDir)).toBeNull();
        });

        test('fails to decrypt if auth tag is tampered with', () => {
            const secret = 'tamper-tag-test';
            const encrypted = protect(secret, tempDir);
            const parts = encrypted.split(':');

            // Tamper with auth tag
            const corruptedTag = Buffer.from(parts[2], 'base64');
            corruptedTag[0] = corruptedTag[0] ^ 0xFF;
            const tamperedPayload = `${parts[0]}:${parts[1]}:${corruptedTag.toString('base64')}:${parts[3]}`;

            expect(unprotect(tamperedPayload, tempDir)).toBeNull();
        });

        test('fails to decrypt with a different master key from another directory', () => {
            const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmex-sec-other-'));
            try {
                const secret = 'isolated-key-test';
                const encrypted = protect(secret, tempDir);

                expect(unprotect(encrypted, otherDir)).toBeNull();
            } finally {
                if (fs.existsSync(otherDir)) {
                    fs.rmSync(otherDir, { recursive: true, force: true });
                }
            }
        });
    });
});
