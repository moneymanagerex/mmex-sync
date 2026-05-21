import { execSync } from 'child_process';

/**
 * Encrypts a string using Windows DPAPI (CurrentUser scope) via PowerShell.
 * @param {string} text The text to encrypt
 * @returns {string} Base64 encoded encrypted string
 */
export function protect(text) {
    // We pass the text via base64 to avoid quote escaping issues in PowerShell
    const base64Text = Buffer.from(text, 'utf8').toString('base64');
    const script = `
        Add-Type -AssemblyName System.Security
        $base64Text = "${base64Text}"
        $bytes = [Convert]::FromBase64String($base64Text)
        $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Convert]::ToBase64String($encrypted)
    `;
    const result = execSync('powershell -NoProfile -NonInteractive -Command -', { input: script, encoding: 'utf8' });
    return result.trim();
}

/**
 * Decrypts a Base64 string using Windows DPAPI (CurrentUser scope) via PowerShell.
 * @param {string} base64 The Base64 encrypted string
 * @returns {string|null} The decrypted string, or null if it fails
 */
export function unprotect(base64) {
    if (!base64) return null;
    const script = `
        Add-Type -AssemblyName System.Security
        $base64 = "${base64}"
        $bytes = [Convert]::FromBase64String($base64)
        $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $textBytes = [System.Text.Encoding]::UTF8.GetString($decrypted)
        [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($textBytes))
    `;
    try {
        const result = execSync('powershell -NoProfile -NonInteractive -Command -', { input: script, encoding: 'utf8' });
        return Buffer.from(result.trim(), 'base64').toString('utf8');
    } catch(e) {
        return null;
    }
}
