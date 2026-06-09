import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProgressBarService } from '../utils/ProgressBarService.js';

const execPromise = promisify(exec);

export class UpdateService {
    constructor(options = {}) {
        this.options = options;
        this.githubRepo = 'moneymanagerex/mmex-sync';
    }

    /**
     * Get the local version of the application.
     * Checks __APP_VERSION__ (defined at build time) or package.json as fallback.
     */
    getLocalVersion() {
        let appVersion = '0.0.0';
        try {
            // __APP_VERSION__ is injected by esbuild
            if (typeof __APP_VERSION__ !== 'undefined') {
                appVersion = __APP_VERSION__;
            }
        } catch (e) {
            // ignore
        }

        if (appVersion === '0.0.0') {
            // Fallback for local development
            try {
                const packageJsonPath = path.resolve('package.json');
                if (fs.existsSync(packageJsonPath)) {
                    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                    appVersion = packageJson.version || '0.0.0';
                }
            } catch (err) {
                // Ignore errors and keep 0.0.0
            }
        }
        return appVersion;
    }

    /**
     * Parses a semver string into major, minor, patch parts.
     */
    parseVersion(versionStr) {
        if (!versionStr || typeof versionStr !== 'string') {
            return { major: 0, minor: 0, patch: 0 };
        }
        const clean = versionStr.replace(/^v/i, '').trim();
        const parts = clean.split('-')[0].split('.').map(x => {
            const val = parseInt(x, 10);
            return isNaN(val) ? 0 : val;
        });
        return {
            major: parts[0] || 0,
            minor: parts[1] || 0,
            patch: parts[2] || 0
        };
    }

    /**
     * Compares two versions.
     * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if v1 === v2.
     */
    compareVersions(v1, v2) {
        const p1 = this.parseVersion(v1);
        const p2 = this.parseVersion(v2);

        if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
        if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
        if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
        return 0;
    }

    /**
     * Fetches the latest release info from GitHub API.
     */
    async fetchLatestRelease() {
        const url = `https://api.github.com/repos/${this.githubRepo}/releases/latest`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'mmex-sync-updater'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch latest release from GitHub: ${response.statusText} (${response.status})`);
        }
        return await response.json();
    }

    /**
     * Checks if there's a newer version on GitHub.
     */
    async checkForUpdate() {
        const localVersion = this.getLocalVersion();
        console.log(`Checking for updates... (Current version: v${localVersion})`);
        
        try {
            const releaseData = await this.fetchLatestRelease();
            const remoteVersion = releaseData.tag_name;
            const comparison = this.compareVersions(remoteVersion, localVersion);

            if (comparison > 0) {
                console.log(`\n🎉 A new version is available: ${remoteVersion}`);
                console.log(`Release Notes & Details: ${releaseData.html_url}`);
                console.log(`Run with --autoDownloadUpdate to automatically download and install it.\n`);
                return { hasUpdate: true, latestVersion: remoteVersion, releaseData };
            } else {
                console.log(`✅ You are running the latest version (v${localVersion}).`);
                return { hasUpdate: false, latestVersion: remoteVersion };
            }
        } catch (err) {
            console.error(`❌ Error checking for updates: ${err.message}`);
            if (this.options.verbose) {
                console.error(err.stack);
            }
            return { error: err.message };
        }
    }

    /**
     * Automatically downloads the update zip and extracts/installs it.
     */
    async autoDownloadUpdate() {
        const localVersion = this.getLocalVersion();
        let releaseData;
        let remoteVersion;

        try {
            console.log(`Checking version compatibility...`);
            const updateCheck = await this.checkForUpdate();
            if (updateCheck.error) {
                return;
            }
            if (!updateCheck.hasUpdate) {
                return;
            }
            releaseData = updateCheck.releaseData;
            remoteVersion = updateCheck.latestVersion;
        } catch (err) {
            console.error(`❌ Error during update verification: ${err.message}`);
            return;
        }

        // Map process.platform to binary name platform suffix
        const platformMap = {
            win32: 'win',
            linux: 'linux',
            darwin: 'macos'
        };
        const platform = platformMap[process.platform];
        if (!platform) {
            console.error(`❌ Unsupported platform: ${process.platform}. Cannot perform auto-download.`);
            return;
        }

        // Search for matching zip asset
        const assetSuffix = `-${platform}.zip`;
        const targetAsset = releaseData.assets.find(asset => asset.name.endsWith(assetSuffix));
        if (!targetAsset) {
            console.error(`❌ No compatible update package found for platform: ${platform} (${assetSuffix})`);
            return;
        }

        const tempZipPath = path.join(process.cwd(), '.update-temp.zip');
        const extractDir = path.join(process.cwd(), '.update-temp-extract');

        try {
            console.log(`Downloading update: ${targetAsset.name}...`);
            const response = await fetch(targetAsset.browser_download_url);
            if (!response.ok) {
                throw new Error(`Failed to download asset: ${response.statusText}`);
            }

            const totalBytes = parseInt(response.headers.get('content-length'), 10) || 0;
            const chunks = [];
            let downloadedBytes = 0;

            const progressBar = new ProgressBarService(totalBytes);

            for await (const chunk of response.body) {
                chunks.push(chunk);
                downloadedBytes += chunk.length;
                progressBar.update(`Downloading`, chunk.length);
            }
            const buffer = Buffer.concat(chunks);
            fs.writeFileSync(tempZipPath, buffer);
            console.log(`\n📦 Update downloaded. Extracting...`);

            // Ensure extraction directory exists and is clean
            if (fs.existsSync(extractDir)) {
                fs.rmSync(extractDir, { recursive: true, force: true });
            }
            fs.mkdirSync(extractDir, { recursive: true });

            // Extract the ZIP archive
            await this.extractZip(tempZipPath, extractDir);

            // Install the extracted executable
            const isPackaged = typeof process.pkg !== 'undefined';
            const binaryName = process.platform === 'win32' ? 'mmex-sync.exe' : 'mmex-sync';
            const extractedBinaryPath = path.join(extractDir, binaryName);

            if (!fs.existsSync(extractedBinaryPath)) {
                throw new Error(`Extracted executable not found at: ${extractedBinaryPath}`);
            }

            const targetPath = isPackaged ? process.execPath : path.join(process.cwd(), binaryName);

            if (process.platform === 'win32') {
                if (fs.existsSync(targetPath)) {
                    const oldPath = targetPath + '.old';
                    try {
                        if (fs.existsSync(oldPath)) {
                            fs.unlinkSync(oldPath);
                        }
                    } catch (e) {
                        // ignore
                    }

                    try {
                        fs.renameSync(targetPath, oldPath);
                    } catch (err) {
                        console.warn(`⚠️ Warning: Could not overwrite current executable directly. Saving as new file.`);
                        const altPath = path.join(path.dirname(targetPath), 'mmex-sync-new.exe');
                        fs.copyFileSync(extractedBinaryPath, altPath);
                        console.log(`ℹ️ Saved the new executable to: ${altPath}`);
                        console.log(`Please rename it to ${binaryName} manually after closing the application.`);
                        return;
                    }
                }
                
                fs.copyFileSync(extractedBinaryPath, targetPath);
                console.log(`\n✅ Update to ${remoteVersion} completed successfully!`);
                if (isPackaged) {
                    console.log(`ℹ️ The old version has been renamed to mmex-sync.exe.old. You can delete it after restarting the program.`);
                } else {
                    console.log(`ℹ️ The executable has been saved to: ${targetPath}`);
                }
            } else {
                // Linux/macOS
                if (fs.existsSync(targetPath)) {
                    try {
                        fs.unlinkSync(targetPath);
                    } catch (err) {
                        const oldPath = targetPath + '.old';
                        try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (e) {}
                        fs.renameSync(targetPath, oldPath);
                    }
                }

                fs.copyFileSync(extractedBinaryPath, targetPath);
                fs.chmodSync(targetPath, 0o755);
                console.log(`\n✅ Update to ${remoteVersion} completed successfully!`);
            }

        } catch (err) {
            console.error(`❌ Error installing update: ${err.message}`);
            if (this.options.verbose) {
                console.error(err.stack);
            }
        } finally {
            // Clean up temp files/dirs
            try {
                if (fs.existsSync(tempZipPath)) {
                    fs.unlinkSync(tempZipPath);
                }
                if (fs.existsSync(extractDir)) {
                    fs.rmSync(extractDir, { recursive: true, force: true });
                }
            } catch (cleanupErr) {
                // ignore cleanup errors
            }
        }
    }

    /**
     * Extracts ZIP archive using system native tools.
     */
    async extractZip(zipPath, extractDir) {
        if (process.platform === 'win32') {
            try {
                const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force"`;
                await execPromise(cmd);
            } catch (err) {
                // Fallback to tar
                const cmd = `tar -xf "${zipPath}" -C "${extractDir}"`;
                await execPromise(cmd);
            }
        } else {
            try {
                const cmd = `unzip -o "${zipPath}" -d "${extractDir}"`;
                await execPromise(cmd);
            } catch (err) {
                // Fallback to tar
                const cmd = `tar -xf "${zipPath}" -C "${extractDir}"`;
                await execPromise(cmd);
            }
        }
    }
}
