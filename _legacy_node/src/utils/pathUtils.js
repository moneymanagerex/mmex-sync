import path from 'path';
import os from 'os';

/**
 * Expands tilde (~) in file paths to the user's home directory
 * @param {string} filePath - The file path potentially containing tilde
 * @returns {string} The expanded file path
 */
export function expandTildePath(filePath) {
    if (!filePath) return filePath;
    if (filePath.startsWith('~')) {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
}
