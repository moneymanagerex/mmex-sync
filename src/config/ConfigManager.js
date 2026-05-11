// src/config/ConfigManager.js
import fs from 'fs';
import path from 'path';
import os from 'os';
import enquirer from 'enquirer';
import { protect, unprotect } from '../utils/dpapi.js'; // Supponendo di spostare dpapi in utils

const CONFIG_FILE_EXTENSION = 'mmex-sync.json';

export class ConfigManager {
    constructor(cliArgs) {
        this.cliArgs = cliArgs;
        this.configDir = path.join(os.homedir(), 'AppData', 'Roaming', 'mmex-sync');
        this.profile = cliArgs.profile || 'default';
        this.configPath = path.join(this.configDir, `${this.profile}.${CONFIG_FILE_EXTENSION}`);
        this.config = {};
    }

    /**
     * Il metodo principale: risolve la configurazione seguendo la gerarchia
     */
    async getEffectiveConfig() {
        // 1. Carica da file (se esiste)
        if (!this.cliArgs.ignoreProfile) {
            this.config = this._loadFromFile();
        }

        // Se l'utente passa --setDefaultMode, lo validiamo subito
        if (this.cliArgs.setDefaultMode) {
            const validModes = ['sync', 'run', 'watch'];
            if (!validModes.includes(this.cliArgs.setDefaultMode)) {
                throw new Error(`Modalità non valida. Scegli tra: ${validModes.join(', ')}`);
            }
        }

        // 2. Definisci i parametri richiesti e risolvi l'origine
        const schema = {
            dbPath: this.cliArgs.db || this.config.dbPath,
            pbUrl: this.cliArgs.url || this.config.pbUrl,
            pbUser: this.cliArgs.user || this.config.pbUser,
            pbPass: this.cliArgs.pass || null, // La password non si salva mai in chiaro
            mmexExe: this.cliArgs.exe || this.config.mmexExe || 'C:\\Program Files\\MoneyManagerEx\\bin\\mmex.exe',
            defaultMode: this.cliArgs.setDefaultMode || this.config.defaultMode || 'sync'
        };

        // 3. Se mancano dati, chiedi via Prompt
        const finalConfig = await this._ensureValues(schema);

        // 4. Gestione Token e Password
        if (finalConfig.pbPass) {
            // Se abbiamo una password (da CLI o Prompt), non la salviamo nel JSON
            // ma la useremo per ottenere il token nel PbService.
        } else if (this.config.encryptedToken) {
            finalConfig.token = unprotect(this.config.encryptedToken);
        }

        this.save(finalConfig, finalConfig.token);

        return finalConfig;
    }

    /**
     * Elenca i profili disponibili nella cartella di configurazione
     */
    listProfiles() {
        if (!fs.existsSync(this.configDir)) {
            console.log("Nessun profilo trovato (cartella di configurazione non presente).");
            return;
        }

        const files = fs.readdirSync(this.configDir);
        const suffix = `.${CONFIG_FILE_EXTENSION}`;
        const profiles = files
            .filter(f => f.endsWith(suffix))
            .map(f => f.replace(suffix, ''));

        if (profiles.length === 0) {
            console.log("Nessun profilo trovato.");
        } else {
            console.log("\n=== PROFILI DISPONIBILI ===");
            profiles.forEach(p => console.log(` - ${p}`));
            console.log("===========================\n");
        }
    }

    _loadFromFile() {
        if (fs.existsSync(this.configPath)) {
            try {
                return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            } catch (e) {
                console.error(`⚠️ Errore lettura profilo ${this.profile}:`, e.message);
            }
        }
        return {};
    }

    async _ensureValues(current) {
        const questions = [];

        if (!current.dbPath) questions.push({ type: 'input', name: 'dbPath', message: 'Percorso database .mmb:' });
        if (!current.pbUrl) questions.push({ type: 'input', name: 'pbUrl', message: 'URL PocketBase:', initial: 'http://127.0.0.1:8090' });
        if (!current.pbUser) questions.push({ type: 'input', name: 'pbUser', message: 'Email PocketBase:' });
        if (!current.pbPass && !this.config.encryptedToken) {
            questions.push({ type: 'password', name: 'pbPass', message: 'Password PocketBase:' });
        }
        if (!current.mmexExe && !this.config.mmexExe) {
            questions.push({ type: 'input', name: 'mmexExe', message: 'Percorso eseguibile MoneyManagerEx:', default: 'C:\Program Files\MoneyManagerEx\bin\mmex.exe' });
        }

        if (questions.length > 0) {
            const answers = await enquirer.prompt(questions);
            return { ...current, ...answers };
        }

        return current;
    }

    /**
     * Salva i dati persistenti (escluso password e token in chiaro)
     */
    save(configData, token = null) {
        if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });

        const toSave = {
            dbPath: configData.dbPath,
            pbUrl: configData.pbUrl,
            pbUser: configData.pbUser,
            mmexExe: configData.mmexExe,
            defaultMode: configData.defaultMode,
            encryptedToken: token ? protect(token) : this.config.encryptedToken
        };

        fs.writeFileSync(this.configPath, JSON.stringify(toSave, null, 2));
        console.log(`✅ Configurazione salvata nel profilo: ${this.profile}`);
    }
}