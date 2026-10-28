/**
 * Waits for a keypress for a given duration (default 3 seconds).
 * If a key is pressed, returns true (abort headless mode and open UI).
 * If timeout expires without input or stdin is non-interactive, returns false.
 * 
 * @param {number} timeoutMs - Timeout in milliseconds (default 3000ms).
 * @returns {Promise<boolean>}
 */
export function waitForInteractiveKey(timeoutMs = 3000) {
    return new Promise((resolve) => {
        // If stdin is not a TTY (e.g. redirected or non-interactive script), don't block
        if (!process.stdin.isTTY) {
            return resolve(false);
        }

        let isResolved = false;
        let countdown = Math.ceil(timeoutMs / 1000);

        const renderPrompt = (secs) => {
            process.stdout.write(`\r⏳ Press any key within ${secs}s to open Web UI... `);
        };

        renderPrompt(countdown);

        // Interval for countdown display
        const interval = setInterval(() => {
            countdown -= 1;
            if (countdown > 0) {
                renderPrompt(countdown);
            }
        }, 1000);

        const cleanup = () => {
            clearInterval(interval);
            if (process.stdin.isTTY) {
                try {
                    process.stdin.setRawMode(false);
                } catch (e) {
                    // ignore
                }
            }
            process.stdin.removeListener('data', onData);
            process.stdin.pause();
        };

        const onData = (data) => {
            if (isResolved) return;
            isResolved = true;
            cleanup();
            process.stdout.write('\n✨ Opening Web UI...\n');
            // If Ctrl+C (0x03), allow standard exit
            if (data && data.length === 1 && data[0] === 3) {
                process.exit(0);
            }
            resolve(true);
        };

        const timeout = setTimeout(() => {
            if (isResolved) return;
            isResolved = true;
            cleanup();
            process.stdout.write('\n');
            resolve(false);
        }, timeoutMs);

        try {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.once('data', onData);
        } catch (e) {
            clearTimeout(timeout);
            cleanup();
            resolve(false);
        }
    });
}
