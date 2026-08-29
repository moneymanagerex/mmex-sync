// src/config/ConfigManager.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import enquirer from 'enquirer';
import { protect, unprotect } from '../utils/dpapi.js'; // Assuming moving dpapi to utils

const CONFIG_FILE_EXTENSION = 'mmex-sync.json';
const GLOBAL_CONFIG_FILENAME = 'mmex-sync.config.json';
const DEFAULT_SERVER_TYPE = 'pocketbase';

export class ConfigManager {
    constructor(cliArgs) {
        this.cliArgs = cliArgs;
        this.configDir = this._getConfigDir();
        this.globalConfigPath = path.join(this.configDir, GLOBAL_CONFIG_FILENAME);
        this.profile = cliArgs.profile || this._getOrInitDefaultProfile();
        this.configPath = path.join(this.configDir, `${this.profile}.${CONFIG_FILE_EXTENSION}`);
        this.config = {};
        this.serverType = typeof cliArgs.serverType === 'string'
            ? cliArgs.serverType.toLowerCase()
            : cliArgs.serverType === true
                ? DEFAULT_SERVER_TYPE
                : undefined;
    }

    _getConfigDir() {
        const homeDir = os.homedir();
        if (process.platform === 'win32') {
            return path.join(homeDir, 'AppData', 'Roaming', 'mmex-sync');
        } else {
            // Linux, macOS, and other Unix-like systems
            return path.join(homeDir, '.mmex-sync');
        }
    }

    updateConfig(configData) {
        this.config = { ...this.config, ...configData };
        if (this.config.token) {
            this.config.encryptedToken = protect(this.config.token);
        }
        this.save(this.config);
    }

    /**
     * The main method: resolves the configuration following the hierarchy
     */
    async getEffectiveConfig() {
        // 1. Load from file (if it exists)
        if (!this.cliArgs.ignoreProfile) {
            this.config = this._loadFromFile();
        }

        const cliFilePassword = this.cliArgs.filePassword || this.cliArgs['file-password'] || null;
        let saveFilePassword = undefined;
        if (this.cliArgs.saveFilePassword !== undefined) {
            const val = String(this.cliArgs.saveFilePassword).toLowerCase();
            saveFilePassword = (val === 'no' || val === 'false' || val === 'n') ? 'no' : 'yes';
        }

        // 2. Define required parameters and resolve the origin
        const schema = {
            dbPath: this.cliArgs.db || this.config.dbPath,
            serverType: this.serverType || this.config.serverType || DEFAULT_SERVER_TYPE,
            pbUrl: this.cliArgs.url || this.config.pbUrl,
            pbAuthCollection: this.config.pbAuthCollection || null,
            pbUser: this.cliArgs.user || this.config.pbUser,
            pbPass: this.cliArgs.pass || null, // The password is never saved in clear text
            mmexExe: this.cliArgs.exe || this.config.mmexExe || 'C:\\Program Files\\Money Manager Ex\\bin\\mmex.exe',
            defaultMode: this.cliArgs.setDefaultMode || this.config.defaultMode || 'run',
            lastSync: this.config.lastSync || null,
            isRunning: this.config.isRunning || false,
            filePassword: cliFilePassword,
            savePassword: saveFilePassword || this.config.savePassword || null
        };

        if (cliFilePassword) {
            schema.filePassword = cliFilePassword;
        } else if (schema.savePassword !== 'no' && this.config.encryptedFilePassword) {
            schema.filePassword = unprotect(this.config.encryptedFilePassword);
        }

        // 3. If data is missing, ask via Prompt
        const finalConfig = await this._ensureValues(schema);

        // 4. Token and Password Management
        if (finalConfig.pbPass) {
            // If we have a password (from CLI or Prompt), we don't save it in JSON
            // but we will use it to obtain the token in PbService.
        } else if (this.config.encryptedToken) {
            finalConfig.token = unprotect(this.config.encryptedToken);
        }

        this.config = finalConfig;
        this.save(finalConfig, finalConfig.token);

        return finalConfig;
    }

    _getOrInitDefaultProfile() {
        if (!fs.existsSync(this.configDir)) {
            try {
                fs.mkdirSync(this.configDir, { recursive: true });
            } catch (e) {
                // ignore
            }
        }
        if (fs.existsSync(this.globalConfigPath)) {
            try {
                const content = fs.readFileSync(this.globalConfigPath, 'utf8');
                if (content && typeof content === 'string') {
                    const parsed = JSON.parse(content);
                    if (parsed && typeof parsed.defaultProfile === 'string' && parsed.defaultProfile.trim()) {
                        return parsed.defaultProfile.trim();
                    }
                }
            } catch (e) {
                // Ignore parsing issues when fallback is available
            }
        }
        const defaultProfile = 'default';
        try {
            fs.writeFileSync(this.globalConfigPath, JSON.stringify({ defaultProfile }, null, 2));
        } catch (e) {
            console.error(`⚠️ Could not save default profile to ${GLOBAL_CONFIG_FILENAME}: ${e.message}`);
        }
        return defaultProfile;
    }

    getDefaultProfile() {
        if (fs.existsSync(this.globalConfigPath)) {
            try {
                const content = fs.readFileSync(this.globalConfigPath, 'utf8');
                if (content && typeof content === 'string') {
                    const parsed = JSON.parse(content);
                    if (parsed && typeof parsed.defaultProfile === 'string' && parsed.defaultProfile.trim()) {
                        return parsed.defaultProfile.trim();
                    }
                }
            } catch (e) {
                // fallback
            }
        }
        return 'default';
    }

    /**
     * Sets the specified profile as defaultProfile in mmex-sync.config.json
     */
    setDefaultProfile(newDefault) {
        if (typeof newDefault !== 'string' || !newDefault.trim()) {
            console.error(`❌ Please specify a profile name, e.g. --setDefaultProfile=work`);
            return false;
        }
        const profileName = newDefault.trim();
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }

        let globalConfig = {};
        if (fs.existsSync(this.globalConfigPath)) {
            try {
                globalConfig = JSON.parse(fs.readFileSync(this.globalConfigPath, 'utf8'));
            } catch (e) {
                // overwritten below
            }
        }

        globalConfig.defaultProfile = profileName;
        fs.writeFileSync(this.globalConfigPath, JSON.stringify(globalConfig, null, 2));
        console.log(`✅ Default profile set to '${profileName}' in ${GLOBAL_CONFIG_FILENAME}`);
        return true;
    }

    /**
     * Renames the current profile to newName and updates defaultProfile if needed
     */
    renameProfile(newName) {
        if (typeof newName !== 'string' || !newName.trim()) {
            console.error(`❌ Please specify a new profile name, e.g. --renameProfileTo=work`);
            return false;
        }
        const targetName = newName.trim();
        const currentProfile = this.profile;

        if (currentProfile === targetName) {
            console.error(`❌ New profile name is identical to current profile name '${currentProfile}'.`);
            return false;
        }

        const currentPath = path.join(this.configDir, `${currentProfile}.${CONFIG_FILE_EXTENSION}`);
        const newPath = path.join(this.configDir, `${targetName}.${CONFIG_FILE_EXTENSION}`);

        if (!fs.existsSync(currentPath)) {
            console.error(`❌ Profile '${currentProfile}' does not exist (${currentPath}). Cannot rename.`);
            return false;
        }

        if (fs.existsSync(newPath)) {
            console.error(`❌ Target profile '${targetName}' already exists (${newPath}). Cannot rename.`);
            return false;
        }

        fs.renameSync(currentPath, newPath);
        console.log(`✅ Profile '${currentProfile}' renamed to '${targetName}'`);

        if (fs.existsSync(this.globalConfigPath)) {
            try {
                const globalConfig = JSON.parse(fs.readFileSync(this.globalConfigPath, 'utf8'));
                if (globalConfig.defaultProfile === currentProfile) {
                    globalConfig.defaultProfile = targetName;
                    fs.writeFileSync(this.globalConfigPath, JSON.stringify(globalConfig, null, 2));
                    console.log(`✅ Default profile updated to '${targetName}' in ${GLOBAL_CONFIG_FILENAME}`);
                }
            } catch (e) {
                console.error(`⚠️ Error updating default profile in ${GLOBAL_CONFIG_FILENAME}: ${e.message}`);
            }
        }

        return true;
    }

    listProfiles() {
        if (!fs.existsSync(this.configDir)) {
            console.log("No profiles found (configuration folder not present).");
            return;
        }

        const files = fs.readdirSync(this.configDir);
        const suffix = `.${CONFIG_FILE_EXTENSION}`;
        const profiles = files
            .filter(f => f.endsWith(suffix))
            .map(f => f.replace(suffix, ''));

        const defaultProfile = this.getDefaultProfile();

        console.log("Profile Directory: " + this.configDir);
        if (profiles.length === 0) {
            console.log("No profiles found.");
        } else {
            console.log("\n=== AVAILABLE PROFILES ===");
            profiles.forEach(p => {
                const isDefault = (p === defaultProfile) ? ' (default)' : '';
                console.log(` - ${p}${isDefault}`);
            });
            console.log("===========================\n");
        }
    }

    /**
     * Shows the content of the specified profile or the current profile
     */
    showProfile(targetProfile) {
        const profileToLoad = (typeof targetProfile === 'string' && targetProfile.length > 0) ? targetProfile : this.profile;
        const configPath = path.join(this.configDir, `${profileToLoad}.${CONFIG_FILE_EXTENSION}`);
        if (!fs.existsSync(configPath)) {
            console.log(`Profile '${profileToLoad}' not found.`);
            return;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON.parse(content);
            const tokenStatus = parsed.encryptedToken ? 'present' : 'not present';
            const savePasswordStatus = parsed.savePassword || 'not set';
            const filePasswordStatus = parsed.encryptedFilePassword
                ? 'present (encrypted)'
                : (parsed.savePassword === 'no' ? 'ask every time' : 'not present');

            console.log(`\n=== PROFILE: ${profileToLoad} ===`);
            console.log(`* DB Path = ${parsed.dbPath || ''}`);
            console.log(`* Server Type = ${parsed.serverType || DEFAULT_SERVER_TYPE}`);
            console.log(`* URL = ${parsed.pbUrl || ''}`);
            console.log(`* Auth Collection = ${parsed.pbAuthCollection || 'unknown'}`);
            console.log(`* User = ${parsed.pbUser || ''}`);
            console.log(`* exe = ${parsed.mmexExe || ''}`);
            console.log(`* defaultMode = ${parsed.defaultMode || ''}`);
            console.log(`* lastSync = ${parsed.lastSync || ''}`);
            console.log(`* isRunning = ${parsed.isRunning || false}`);
            console.log(`* token = ${tokenStatus}`);
            console.log(`* savePassword = ${savePasswordStatus}`);
            console.log(`* filePassword = ${filePasswordStatus}`);
            console.log("===========================\n");
        } catch (e) {
            console.error(`⚠️ Error reading profile ${profileToLoad}:`, e.message);
        }
    }

    /**
     * Updates the default mode in the profile and saves it
     */
    setDefaultMode(mode) {
        if (typeof mode !== 'string') {
            console.error(`❌ Please specify a mode, e.g. --setDefaultMode=watch`);
            return false;
        }

        const validModes = ['sync', 'run', 'watch'];
        if (!validModes.includes(mode)) {
            console.error(`❌ Invalid mode '${mode}'. Choose from: ${validModes.join(', ')}`);
            return false;
        }

        this.config = this._loadFromFile();
        if (Object.keys(this.config).length === 0) {
            console.error(`❌ Profile '${this.profile}' not found or empty. Cannot set default mode.`);
            return false;
        }

        this.config.defaultMode = mode;
        this.save(this.config);
        return true;
    }

    _loadFromFile() {
        if (fs.existsSync(this.configPath)) {
            try {
                return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            } catch (e) {
                console.error(`⚠️ Error reading profile ${this.profile}:`, e.message);
            }
        }
        return {};
    }

    async _ensureValues(current) {
        const questions = [];

        if (!current.dbPath) questions.push({ type: 'input', name: 'dbPath', message: '.mmb or .emb database path:' });
        if (!current.pbUrl) questions.push({ type: 'input', name: 'pbUrl', message: 'URL PocketBase:', initial: 'http://127.0.0.1:8090' });
        if (!current.pbUser) questions.push({ type: 'input', name: 'pbUser', message: 'Email PocketBase:' });
        if (!current.pbPass && !this.config.encryptedToken) {
            questions.push({ type: 'password', name: 'pbPass', message: 'Password PocketBase:' });
        }
        if (!current.mmexExe && !this.config.mmexExe) {
            const foundPaths = this._searchMMEXExecutable();

            if (foundPaths.length > 0) {
                const choices = foundPaths.map(p => ({ name: p, value: p }));
                choices.push({ name: 'Enter path manually...', value: 'MANUAL' });

                questions.push({
                    type: 'select',
                    name: 'mmexExe',
                    message: 'Select MoneyManagerEx executable:',
                    choices: choices
                });
            } else {
                questions.push({ type: 'input', name: 'mmexExe', message: 'MoneyManagerEx executable path:', default: 'C:\\Program Files\\Money Manager Ex\\bin\\mmex.exe' });
            }
        }

        let answers = {};
        if (questions.length > 0) {
            answers = await enquirer.prompt(questions);

            // If user selected "Enter path manually", prompt for manual input
            if (answers.mmexExe === 'MANUAL') {
                const { manualPath } = await enquirer.prompt({
                    type: 'input',
                    name: 'manualPath',
                    message: 'Enter MoneyManagerEx executable path:',
                    default: 'C:\\Program Files\\Money Manager Ex\\bin\\mmex.exe'
                });
                answers.mmexExe = manualPath;
            }
        }

        const merged = { ...current, ...answers };

        // Check if database file is encrypted (.emb)
        const isEmb = merged.dbPath ? merged.dbPath.toLowerCase().endsWith('.emb') : false;
        if (isEmb) {
            const embQuestions = [];
            if (!merged.filePassword) {
                embQuestions.push({ type: 'password', name: 'filePassword', message: 'File Password (.emb database):' });
            }
            if (!merged.savePassword) {
                embQuestions.push({
                    type: 'select',
                    name: 'savePasswordChoice',
                    message: 'Do you want to save the database password in profile?',
                    choices: [
                        { name: 'No, ask every time', value: 'no' },
                        { name: 'Yes, save securely', value: 'yes' }
                    ]
                });
            }

            if (embQuestions.length > 0) {
                const embAnswers = await enquirer.prompt(embQuestions);
                if (embAnswers.savePasswordChoice) {
                    embAnswers.savePassword = embAnswers.savePasswordChoice;
                    delete embAnswers.savePasswordChoice;
                }
                Object.assign(merged, embAnswers);
            }
        }

        return merged;
    }

    _searchMMEXExecutable() {
        const commonPaths = [
            'C:\\Program Files\\Money Manager Ex\\bin\\mmex.exe',
            'C:\\Program Files (x86)\\Money Manager Ex\\bin\\mmex.exe',
            'C:\\Program Files\\MoneyManagerEx\\bin\\mmex.exe',
            'C:\\Program Files (x86)\\MoneyManagerEx\\bin\\mmex.exe'
        ];

        return commonPaths.filter(p => {
            try {
                return fs.existsSync(p);
            } catch (e) {
                return false;
            }
        });
    }

    /**
     * Saves persistent data (excluding password and clear-text token)
     */
    save(configData, token = null) {
        if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });

        const savePasswordChoice = configData.savePassword || this.config.savePassword;
        let encryptedFilePassword = undefined;
        if (savePasswordChoice === 'no') {
            encryptedFilePassword = undefined;
        } else if (savePasswordChoice === 'yes' && configData.filePassword) {
            encryptedFilePassword = protect(configData.filePassword);
        } else {
            encryptedFilePassword = configData.encryptedFilePassword || this.config.encryptedFilePassword;
        }

        const toSave = {
            dbPath: configData.dbPath,
            serverType: configData.serverType,
            pbUrl: configData.pbUrl,
            pbAuthCollection: configData.pbAuthCollection,
            pbUser: configData.pbUser,
            mmexExe: configData.mmexExe,
            defaultMode: configData.defaultMode,
            lastSync: configData.lastSync,
            isRunning: configData.isRunning ?? false,
            encryptedToken: token ? protect(token) : (configData.encryptedToken || this.config.encryptedToken),
            savePassword: savePasswordChoice || undefined,
            encryptedFilePassword: encryptedFilePassword
        };

        this.config = {
            ...this.config,
            ...configData,
            ...toSave
        };

        fs.writeFileSync(this.configPath, JSON.stringify(toSave, null, 2));
        console.log(`✅ Configuration saved in profile: ${this.profile}`);
    }
}
