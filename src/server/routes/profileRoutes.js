import { Router } from 'express';
import { ConfigManager } from '../../config/ConfigManager.js';
import { RemoteServiceFactory } from '../../api/RemoteServiceFactory.js';
import { expandTildePath } from '../../utils/pathUtils.js';
import { openNativeFileDialog } from '../../utils/fileDialog.js';

export function createProfileRouter(baseCliArgs = {}, onShutdown = null) {
    const router = Router();

    // Helper to instantiate ConfigManager
    const getConfigManager = (profile) => new ConfigManager({ ...baseCliArgs, profile });

    /**
     * GET /api/profiles
     * Returns list of all profiles with isDefault flag and configuration summary.
     */
    router.get('/profiles', (req, res) => {
        try {
            const configMgr = getConfigManager();
            const profiles = configMgr.getProfiles();
            const defaultProfile = configMgr.getDefaultProfile();
            res.json({
                success: true,
                defaultProfile,
                profiles
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /api/profile/:name
     * Retrieves configuration details for a specific profile (supports 'default').
     */
    router.get('/profile/:name', (req, res) => {
        try {
            const configMgr = getConfigManager();
            const targetName = req.params.name;
            const profileData = configMgr.getProfileData(targetName);
            if (!profileData) {
                return res.status(404).json({ success: false, error: `Profile '${targetName}' not found.` });
            }
            res.json({ success: true, profile: profileData });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /api/profile
     * Creates a new profile or updates an existing one.
     */
    router.post('/profile', async (req, res) => {
        try {
            const {
                name,
                dbPath,
                filePassword,
                savePassword,
                serverType = 'pocketbase',
                pbUrl,
                pbUser,
                pbPass,
                mmexExe,
                defaultMode = 'run',
                isDefault = false
            } = req.body;

            if (!name || typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({ success: false, error: 'Profile name is required.' });
            }

            const cleanName = name.trim();
            const configMgr = getConfigManager(cleanName);

            let token = null;
            let pbAuthCollection = null;

            // Optional: authenticate with remote server if pbPass is supplied
            if (pbUrl && pbUser && pbPass) {
                try {
                    const remoteService = RemoteServiceFactory.create(serverType || 'pocketbase', pbUrl);
                    await remoteService.authenticate(pbUser, pbPass);
                    token = remoteService.getToken();
                    pbAuthCollection = remoteService.authCollection;
                } catch (authErr) {
                    return res.status(400).json({
                        success: false,
                        error: `Remote authentication failed: ${authErr.message}`
                    });
                }
            }

            const saved = configMgr.saveProfileData(cleanName, {
                dbPath: dbPath ? expandTildePath(dbPath.trim()) : '',
                filePassword,
                savePassword,
                serverType,
                pbUrl: pbUrl ? pbUrl.trim() : '',
                pbUser: pbUser ? pbUser.trim() : '',
                pbAuthCollection,
                token,
                mmexExe: mmexExe ? expandTildePath(mmexExe.trim()) : undefined,
                defaultMode,
                isDefault: Boolean(isDefault)
            });

            res.json({ success: true, profile: saved });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /api/profile/:name/default
     * Sets the specified profile as active default.
     */
    router.post('/profile/:name/default', (req, res) => {
        try {
            const configMgr = getConfigManager();
            const targetName = req.params.name;
            const profileData = configMgr.getProfileData(targetName);
            if (!profileData) {
                return res.status(404).json({ success: false, error: `Profile '${targetName}' not found.` });
            }

            const success = configMgr.setDefaultProfile(profileData.name);
            if (success) {
                res.json({ success: true, message: `Default profile set to '${profileData.name}'.` });
            } else {
                res.status(400).json({ success: false, error: 'Failed to set default profile.' });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * PUT /api/profile/:name/rename
     * Renames an existing profile.
     */
    router.put('/profile/:name/rename', (req, res) => {
        try {
            const targetName = req.params.name;
            const { newName } = req.body;
            if (!newName || typeof newName !== 'string' || !newName.trim()) {
                return res.status(400).json({ success: false, error: 'New profile name is required.' });
            }

            const configMgr = getConfigManager(targetName);
            const success = configMgr.renameProfile(newName.trim());
            if (success) {
                res.json({ success: true, message: `Profile '${targetName}' renamed to '${newName.trim()}'.` });
            } else {
                res.status(400).json({ success: false, error: 'Failed to rename profile.' });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /api/profile/:name
     * Deletes the specified profile.
     */
    router.delete('/profile/:name', (req, res) => {
        try {
            const targetName = req.params.name;
            const configMgr = getConfigManager(targetName);
            const success = configMgr.deleteProfile(targetName);
            if (success) {
                res.json({ success: true, message: `Profile '${targetName}' deleted.` });
            } else {
                res.status(404).json({ success: false, error: `Profile '${targetName}' not found or could not be deleted.` });
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /api/system/detect-mmex
     * Auto-detects MMEX executable path on the current system.
     */
    router.get('/system/detect-mmex', (req, res) => {
        try {
            const configMgr = getConfigManager();
            const detected = configMgr._resolveMMEXPath();
            res.json({ success: true, mmexPath: detected });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /api/system/browse-file
     * Opens native OS file picker and returns the selected absolute file path.
     */
    router.post('/system/browse-file', async (req, res) => {
        try {
            const { type = 'database', title = 'Select Money Manager Ex Database' } = req.body || {};
            const selectedPath = await openNativeFileDialog({ type, title });
            res.json({ success: true, path: selectedPath });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /api/system/shutdown
     * Gracefully shuts down the local web server and proceeds with execution.
     */
    router.post('/system/shutdown', (req, res) => {
        try {
            res.json({ success: true, message: 'Server is shutting down. Starting synchronization...' });
            console.log('\n👋 Closing Web UI and proceeding with execution...');
            if (typeof onShutdown === 'function') {
                setTimeout(() => {
                    onShutdown();
                }, 200);
            } else {
                setTimeout(() => {
                    process.exit(0);
                }, 200);
            }
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
}
