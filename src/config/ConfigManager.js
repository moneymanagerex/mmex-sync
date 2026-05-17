// src/config/ConfigManager.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import enquirer from 'enquirer';
import { protect, unprotect } from '../utils/dpapi.js'; // Assuming moving dpapi to utils

const CONFIG_FILE_EXTENSION = 'mmex-sync.json';

export class ConfigManager {
    constructor(cliArgs) {
        this.cliArgs = cliArgs;
        this.configDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mmex-sync');
        this.profile = cliArgs.profile || 'default';
        this.configPath = path.join(this.configDir, `${this.profile}.${CONFIG_FILE_EXTENSION}`);
        this.config = {};
    }

    updateConfig(configData) {
        this.config = configData;
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

        // 2. Define required parameters and resolve the origin
        const schema = {
            dbPath: this.cliArgs.db || this.config.dbPath,
            pbUrl: this.cliArgs.url || this.config.pbUrl,
            pbUser: this.cliArgs.user || this.config.pbUser,
            pbPass: this.cliArgs.pass || null, // The password is never saved in clear text
            mmexExe: this.cliArgs.exe || this.config.mmexExe || 'C:\\Program Files\\MoneyManagerEx\\bin\\mmex.exe',
            defaultMode: this.cliArgs.setDefaultMode || this.config.defaultMode || 'sync',
            lastSync: this.config.lastSync || null
        };

        // 3. If data is missing, ask via Prompt
        const finalConfig = await this._ensureValues(schema);

        // 4. Token and Password Management
        if (finalConfig.pbPass) {
            // If we have a password (from CLI or Prompt), we don't save it in JSON
            // but we will use it to obtain the token in PbService.
        } else if (this.config.encryptedToken) {
            finalConfig.token = unprotect(this.config.encryptedToken);
        }

        this.save(finalConfig, finalConfig.token);

        return finalConfig;
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

        if (profiles.length === 0) {
            console.log("No profiles found.");
        } else {
            console.log("\n=== AVAILABLE PROFILES ===");
            profiles.forEach(p => console.log(` - ${p}`));
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
            
            console.log(`\n=== PROFILE: ${profileToLoad} ===`);
            console.log(`* DB Path = ${parsed.dbPath || ''}`);
            console.log(`* URL = ${parsed.pbUrl || ''}`);
            console.log(`* User = ${parsed.pbUser || ''}`);
            console.log(`* exe = ${parsed.mmexExe || ''}`);
            console.log(`* defaultMode = ${parsed.defaultMode || ''}`);
            console.log(`* lastSync = ${parsed.lastSync || ''}`);
            console.log(`* token = ${tokenStatus}`);
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

        if (!current.dbPath) questions.push({ type: 'input', name: 'dbPath', message: '.mmb database path:' });
        if (!current.pbUrl) questions.push({ type: 'input', name: 'pbUrl', message: 'URL PocketBase:', initial: 'http://127.0.0.1:8090' });
        if (!current.pbUser) questions.push({ type: 'input', name: 'pbUser', message: 'Email PocketBase:' });
        if (!current.pbPass && !this.config.encryptedToken) {
            questions.push({ type: 'password', name: 'pbPass', message: 'Password PocketBase:' });
        }
        if (!current.mmexExe && !this.config.mmexExe) {
            questions.push({ type: 'input', name: 'mmexExe', message: 'MoneyManagerEx executable path:', default: 'C:\Program Files\MoneyManagerEx\bin\mmex.exe' });
        }

        if (questions.length > 0) {
            const answers = await enquirer.prompt(questions);
            return { ...current, ...answers };
        }

        return current;
    }

    /**
     * Saves persistent data (excluding password and clear-text token)
     */
    save(configData, token = null) {
        if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });

        const toSave = {
            dbPath: configData.dbPath,
            pbUrl: configData.pbUrl,
            pbUser: configData.pbUser,
            mmexExe: configData.mmexExe,
            defaultMode: configData.defaultMode,
            lastSync: configData.lastSync,
            encryptedToken: token ? protect(token) : this.config.encryptedToken
        };
        //        console.log("toSave:");
        //        console.log("  Token: " + toSave.token);
        //        console.log("  Encrypted: " + toSave.encryptedToken);

        fs.writeFileSync(this.configPath, JSON.stringify(toSave, null, 2));
        console.log(`✅ Configuration saved in profile: ${this.profile}`);
    }
}