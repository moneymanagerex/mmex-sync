/**
 * Utility to pause execution before exiting the application.
 * Shows a wait message for 3 seconds. If a key is pressed during the timeout,
 * it pauses and asks the user to press any key to exit.
 *
 * @param {Object} options
 * @param {number} [options.timeoutMs=3000] - Timeout in milliseconds before automatic exit
 * @param {boolean} [options.noWait=false] - If true, bypasses the wait prompt
 * @param {Stream} [options.stdin=process.stdin] - Input stream
 * @param {Stream} [options.stdout=process.stdout] - Output stream
 * @returns {Promise<void>}
 */
export async function waitForExit(options = {}) {
    const {
        timeoutMs = 3000,
        noWait = options.nowait || false,
        stdin = process.stdin,
        stdout = process.stdout
    } = options;

    const isTTY = Boolean(stdin && stdin.isTTY);

    if (noWait || !isTTY) {
        return;
    }

    return new Promise((resolve) => {
        let timer = null;
        let waitingForExitKey = false;

        const isRawSupported = typeof stdin.setRawMode === 'function';

        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (isRawSupported) {
                try {
                    stdin.setRawMode(false);
                } catch (_) {}
            }
            stdin.removeListener('data', onData);
            if (typeof stdin.pause === 'function') {
                stdin.pause();
            }
        };

        const onData = (chunk) => {
            const str = chunk ? chunk.toString() : '';
            // Handle Ctrl+C (SIGINT)
            if (str === '\u0003') {
                cleanup();
                process.exit(0);
                return;
            }

            if (!waitingForExitKey) {
                waitingForExitKey = true;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
                stdout.write("Press any key to exit\n");
            } else {
                cleanup();
                resolve();
            }
        };

        if (isRawSupported) {
            try {
                stdin.setRawMode(true);
            } catch (_) {}
        }

        if (typeof stdin.resume === 'function') {
            stdin.resume();
        }

        stdin.on('data', onData);

        stdout.write(`Press any key to wait befor close (${Math.round(timeoutMs / 1000)} seconds)\n`);

        timer = setTimeout(() => {
            cleanup();
            resolve();
        }, timeoutMs);
    });
}
