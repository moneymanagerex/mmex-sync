import { exec } from 'child_process';

/**
 * Opens a URL in the default system web browser across platforms.
 * @param {string} url - The URL to open in the browser.
 * @returns {Promise<boolean>}
 */
export function openBrowser(url) {
    return new Promise((resolve) => {
        let command = '';
        switch (process.platform) {
            case 'win32':
                // 'start ""' ensures proper handling of URLs on Windows
                command = `start "" "${url}"`;
                break;
            case 'darwin':
                command = `open "${url}"`;
                break;
            default:
                command = `xdg-open "${url}"`;
                break;
        }

        exec(command, (error) => {
            if (error) {
                console.warn(`⚠️ Could not automatically open browser: ${error.message}`);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}
