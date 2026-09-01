// src/utils/security.js
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const KEY_FILENAME = '.key';
const PAYLOAD_PREFIX = 'v1';

/**
 * Returns the default configuration directory based on the operating system.
 */
export function getDefaultConfigDir() {
    const homeDir = os.homedir();
    if (process.platform === 'win32') {
        return path.join(homeDir, 'AppData', 'Roaming', 'mmex-sync');
    }
    return path.join(homeDir, '.mmex-sync');
}

/**
 * Retrieves or creates a secure 256-bit master key.
 * On Unix-like systems, the keyfile is created with restrictive permissions (0600).
 * 
 * @param {string} [configDir] Directory to store the master key file
 * @returns {Buffer} 32-byte master encryption key
 */
export function getOrCreateMasterKey(configDir) {
    const dir = configDir || getDefaultConfigDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const keyPath = path.join(dir, KEY_FILENAME);
    if (fs.existsSync(keyPath)) {
        const raw = fs.readFileSync(keyPath);
        if (raw.length === 32) {
            return raw;
        }
    }

    const newKey = crypto.randomBytes(32);
    try {
        fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
    } catch (e) {
        fs.writeFileSync(keyPath, newKey);
    }
    return newKey;
}

/**
 * Encrypts a string using AES-256-GCM with a user-scoped master key.
 * 
 * @param {string} text The plaintext to encrypt
 * @param {string} [configDir] Optional custom configuration directory
 * @returns {string} Formatted ciphertext: v1:<iv_b64>:<tag_b64>:<data_b64>
 */
export function protect(text, configDir) {
    if (typeof text !== 'string' || text.length === 0) {
        return '';
    }

    const masterKey = getOrCreateMasterKey(configDir);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);

    const encrypted = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return `${PAYLOAD_PREFIX}:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts a formatted ciphertext string using AES-256-GCM.
 * 
 * @param {string} payload Formatted ciphertext (v1:<iv>:<tag>:<data>)
 * @param {string} [configDir] Optional custom configuration directory
 * @returns {string|null} The decrypted string, or null if decryption fails
 */
export function unprotect(payload, configDir) {
    if (!payload || typeof payload !== 'string') {
        return null;
    }

    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== PAYLOAD_PREFIX) {
        return null;
    }

    try {
        const masterKey = getOrCreateMasterKey(configDir);
        const iv = Buffer.from(parts[1], 'base64');
        const authTag = Buffer.from(parts[2], 'base64');
        const encryptedData = Buffer.from(parts[3], 'base64');

        if (iv.length !== IV_LENGTH || authTag.length !== 16) {
            return null;
        }

        const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
        decipher.setAuthTag(authTag);

        const decrypted = Buffer.concat([
            decipher.update(encryptedData),
            decipher.final()
        ]);

        return decrypted.toString('utf8');
    } catch (e) {
        return null;
    }
}
