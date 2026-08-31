import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createProfileRouter } from './routes/profileRoutes.js';
import { openBrowser } from './openBrowser.js';

/**
 * Resolves the static public assets directory across dev and bundled modes.
 */
function resolvePublicDir() {
    const currentDir = typeof __dirname !== 'undefined'
        ? __dirname
        : path.dirname(fileURLToPath(import.meta.url));

    const candidatePaths = [
        path.join(currentDir, 'public'),
        path.join(currentDir, 'src', 'server', 'public'),
        path.join(process.cwd(), 'src', 'server', 'public'),
        path.join(path.dirname(process.execPath), 'public'),
        path.join(path.dirname(process.execPath), 'assets', 'public')
    ];

    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(currentDir, 'public');
}

/**
 * Creates the Express application with API routes and static asset serving.
 * @param {object} cliArgs - CLI arguments to pass to ConfigManager.
 * @returns {express.Application}
 */
export function createApp(cliArgs = {}, onShutdown = null) {
    const app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // API Routes
    app.use('/api', createProfileRouter(cliArgs, onShutdown));

    // Static Assets
    const publicDir = resolvePublicDir();
    if (fs.existsSync(publicDir)) {
        app.use(express.static(publicDir, {
            etag: false,
            maxAge: 0,
            setHeaders: (res) => {
                res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            }
        }));
        app.get('{*path}', (req, res, next) => {
            if (req.path.startsWith('/api')) return next();
            const indexPath = path.join(publicDir, 'index.html');
            if (fs.existsSync(indexPath)) {
                res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
                res.sendFile(indexPath);
            } else {
                next();
            }
        });
    }

    return app;
}

/**
 * Starts the local Express web server on an available port.
 * Resolves when the server is stopped/shutdown.
 * @param {object} options
 * @param {number} [options.port=3000] - Starting port to attempt.
 * @param {boolean} [options.open=true] - Whether to automatically open the default browser.
 * @param {object} [options.cliArgs={}] - CLI arguments to pass down.
 * @returns {Promise<{ reason: string }>}
 */
export function startServer({ port = 3000, open = true, cliArgs = {} } = {}) {
    return new Promise((resolve, reject) => {
        let currentPort = port;
        let attempts = 0;
        const maxAttempts = 10;
        let activeServer = null;

        const onShutdown = () => {
            if (activeServer) {
                activeServer.close(() => {
                    resolve({ reason: 'shutdown' });
                });
            } else {
                resolve({ reason: 'shutdown' });
            }
        };

        const app = createApp(cliArgs, onShutdown);

        function tryListen() {
            activeServer = app.listen(currentPort, () => {
                const url = `http://localhost:${currentPort}`;
                console.log(`\n🌐 MMEX-Sync Web UI running at: ${url}`);
                if (open) {
                    openBrowser(url);
                }
            });

            activeServer.on('error', (err) => {
                if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
                    attempts += 1;
                    currentPort += 1;
                    console.log(`Port ${currentPort - 1} in use, trying port ${currentPort}...`);
                    tryListen();
                } else {
                    reject(err);
                }
            });
        }

        tryListen();
    });
}

/**
 * Gracefully stops the web server.
 * @param {import('http').Server} server
 * @returns {Promise<void>}
 */
export function stopServer(server) {
    return new Promise((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
    });
}
