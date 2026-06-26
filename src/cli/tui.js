// src/cli/tui.js
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { ConfigManager } from '../config/ConfigManager.js';
import {
    intro,
    outro,
    text,
    password,
    select,
    confirm,
    log,
    spinner,
    isCancel
} from '@clack/prompts';

export class TUI {
    constructor(cliArgs) {
        this.cliArgs = cliArgs;
        this.configMgr = new ConfigManager(cliArgs);
        this.profile = this.configMgr.profile;
        // Make sure configuration directory exists
        if (!fs.existsSync(this.configMgr.configDir)) {
            fs.mkdirSync(this.configMgr.configDir, { recursive: true });
        }
        // Load configurations
        this.configMgr.config = this.configMgr._loadFromFile();
    }

    async run() {
        readline.emitKeypressEvents(process.stdin);
        
        const options = [
            { key: 'r', action: 'run' },
            { key: 's', action: 'sync' },
            { key: 'w', action: 'watch' },
            { key: 'p', action: 'profile' },
            { key: 'c', action: 'config' },
            { key: 'u', action: 'updates' },
            { key: 'a', action: 'autoupdate' },
            { key: 'k', action: 'cleardb' },
            { key: 'v', action: 'clearserver' },
            { key: 'x', action: 'exit' }
        ];

        let selectedIndex = 0;

        while (true) {
            this.drawMainMenu(selectedIndex);
            const input = await this.getKeyPress();
            
            let action = null;
            
            if (input.type === 'nav') {
                if (input.value === 'up') {
                    selectedIndex = (selectedIndex - 1 + options.length) % options.length;
                } else if (input.value === 'down') {
                    selectedIndex = (selectedIndex + 1) % options.length;
                } else if (input.value === 'return' || input.value === 'enter') {
                    action = options[selectedIndex].action;
                }
            } else if (input.type === 'key') {
                const pressedKey = input.value;
                const matchedOption = options.find(o => o.key === pressedKey);
                if (matchedOption) {
                    action = matchedOption.action;
                }
            }
            
            if (action) {
                if (action === 'run') {
                    if (await this.validateAndSaveConfig('run')) {
                        return { action: 'run', profile: this.profile };
                    }
                } else if (action === 'sync') {
                    if (await this.validateAndSaveConfig('sync')) {
                        return { action: 'sync', profile: this.profile };
                    }
                } else if (action === 'watch') {
                    if (await this.validateAndSaveConfig('watch')) {
                        return { action: 'watch', profile: this.profile };
                    }
                } else if (action === 'profile') {
                    await this.handleProfileMenu();
                } else if (action === 'config') {
                    await this.handleConfigMenu();
                } else if (action === 'updates') {
                    await this.checkForUpdates();
                } else if (action === 'autoupdate') {
                    await this.runAutoUpdate();
                } else if (action === 'cleardb') {
                    await this.clearLocalDb();
                } else if (action === 'clearserver') {
                    await this.clearRemoteServer();
                } else if (action === 'exit') {
                    return null;
                }
            }
        }
    }

    drawMainMenu(selectedIndex) {
        console.clear();
        const conf = this.configMgr.config || {};
        
        console.log(`\n  \x1b[1m\x1b[36m┌── MMEX-Sync Terminal User Interface (TUI) ─────────────────\x1b[39m\x1b[22m`);
        console.log(`  \x1b[36m│\x1b[39m  \x1b[1mActive Profile:\x1b[22m \x1b[33m${this.profile}\x1b[39m`);
        console.log(`  \x1b[36m│\x1b[39m  \x1b[1mDB Path:\x1b[22m        ${conf.dbPath || '\x1b[31mNot configured\x1b[39m'}`);
        console.log(`  \x1b[36m│\x1b[39m  \x1b[1mServer URL:\x1b[22m     ${conf.pbUrl || '\x1b[31mNot configured\x1b[39m'}`);
        console.log(`  \x1b[36m│\x1b[39m  \x1b[1mUser:\x1b[22m           ${conf.pbUser || '\x1b[31mNot configured\x1b[39m'}`);
        console.log(`  \x1b[36m│\x1b[39m  \x1b[1mMMEX Exe:\x1b[22m       ${conf.mmexExe || '\x1b[31mNot configured\x1b[39m'}`);
        console.log(`  \x1b[36m│\x1b[39m  \x1b[1mDefault Mode:\x1b[22m   \x1b[35m${conf.defaultMode || 'run'}\x1b[39m`);
        console.log(`  \x1b[36m├── Options ─────────────────────────────────────────────────\x1b[39m`);

        const options = [
            { key: 'r', label: '[R] Run mode      (Initial Sync + Launch MMEX + Final Sync)', category: 'action' },
            { key: 's', label: '[S] Sync mode     (Sync now without starting MMEX)', category: 'action' },
            { key: 'w', label: '[W] Watch mode    (Initial Sync + Watch changes + MMEX)', category: 'action' },
            { key: 'p', label: '[P] Profile Settings (Switch/Create/Delete profiles)', category: 'config' },
            { key: 'c', label: '[C] Configure Profile Parameters', category: 'config' },
            { key: 'u', label: '[U] Check for Updates', category: 'update' },
            { key: 'a', label: '[A] Auto Download/Install Update', category: 'update' },
            { key: 'k', label: '[K] Clear DB      (Remove local technical tables)', category: 'danger' },
            { key: 'v', label: '[V] Clear Server  (Remove remote data collections)', category: 'danger' },
            { key: 'x', label: '[X] Exit', category: 'exit' }
        ];

        options.forEach((opt, idx) => {
            const isSelected = idx === selectedIndex;
            const marker = isSelected ? '\x1b[36m›\x1b[39m ' : '  ';
            
            let colorCode = '\x1b[39m'; // default
            if (opt.category === 'action') colorCode = '\x1b[32m'; // green
            if (opt.category === 'config') colorCode = '\x1b[34m'; // blue
            if (opt.category === 'update') colorCode = '\x1b[34m'; // blue
            if (opt.category === 'danger') colorCode = '\x1b[31m'; // red
            if (opt.category === 'exit') colorCode = '\x1b[33m'; // yellow

            let text = opt.label;
            if (isSelected) {
                text = `\x1b[36m\x1b[1m${opt.label}\x1b[22m\x1b[39m`;
            } else {
                const prefixMatch = opt.label.match(/^(\[[A-Z]\])(.*)$/);
                if (prefixMatch) {
                    text = `${colorCode}${prefixMatch[1]}\x1b[39m${prefixMatch[2]}`;
                }
            }

            console.log(`  \x1b[36m│\x1b[39m ${marker}${text}`);
        });

        console.log(`  \x1b[36m└────────────────────────────────────────────────────────────┘\x1b[39m`);
        process.stdout.write('  Use arrows (↑/↓) or hotkeys (R/S/W/etc.) > ');
    }

    async getKeyPress() {
        return new Promise((resolve) => {
            const wasRaw = process.stdin.isRaw;
            process.stdin.setRawMode(true);
            process.stdin.resume();

            const onKey = (str, key) => {
                if (key && key.ctrl && key.name === 'c') {
                    process.stdin.off('keypress', onKey);
                    if (!wasRaw) process.stdin.setRawMode(false);
                    process.exit(0);
                }
                
                process.stdin.off('keypress', onKey);
                if (!wasRaw) process.stdin.setRawMode(false);
                
                if (key && (key.name === 'up' || key.name === 'down' || key.name === 'return' || key.name === 'enter')) {
                    resolve({ type: 'nav', value: key.name });
                } else {
                    let char = str;
                    if (!char && key && key.name) {
                        char = key.name;
                    }
                    resolve({ type: 'key', value: char ? char.toLowerCase() : '' });
                }
            };

            process.stdin.on('keypress', onKey);
        });
    }

    async pressEnterToContinue() {
        return new Promise((resolve) => {
            console.log('\n  Press Enter to return to main menu...');
            const wasRaw = process.stdin.isRaw;
            process.stdin.setRawMode(true);
            process.stdin.resume();
            
            const onKey = (str, key) => {
                if (key.name === 'return' || key.name === 'enter') {
                    process.stdin.off('keypress', onKey);
                    if (!wasRaw) process.stdin.setRawMode(false);
                    resolve();
                }
            };
            process.stdin.on('keypress', onKey);
        });
    }

    async validateAndSaveConfig(action) {
        const conf = this.configMgr.config;
        if (!conf.dbPath) {
            log.error('❌ DB Path is missing. Please configure it in Profile Parameters.');
            await this.pressEnterToContinue();
            return false;
        }
        if (!conf.pbUrl) {
            log.error('❌ Server URL is missing. Please configure it in Profile Parameters.');
            await this.pressEnterToContinue();
            return false;
        }
        if (!conf.pbUser) {
            log.error('❌ Username/Email is missing. Please configure it in Profile Parameters.');
            await this.pressEnterToContinue();
            return false;
        }
        if (!conf.encryptedToken && !this.cliArgs.pass) {
            log.error('❌ No active session. Please set password in Profile Parameters to log in.');
            await this.pressEnterToContinue();
            return false;
        }
        if ((action === 'run' || action === 'watch') && !conf.mmexExe) {
            log.error('❌ MoneyManagerEx executable path is missing. Please configure it.');
            await this.pressEnterToContinue();
            return false;
        }
        
        // Save current configurations
        this.configMgr.save(conf);
        return true;
    }

    async handleProfileMenu() {
        console.clear();
        intro('Profile Management');
        
        const option = await select({
            message: 'Choose profile action:',
            options: [
                { value: 'switch', label: '📁 Switch Active Profile' },
                { value: 'create', label: '✨ Create New Profile' },
                { value: 'delete', label: '❌ Delete Profile' },
                { value: 'back', label: '👈 Back to Main Menu' }
            ]
        });

        if (isCancel(option) || option === 'back') return;

        if (option === 'switch') {
            const profiles = this.configMgr.getProfiles();
            if (profiles.length === 0) {
                log.warn('No profiles found.');
                await this.pressEnterToContinue();
                return;
            }
            const chosen = await select({
                message: 'Select profile:',
                options: profiles.map(p => ({ value: p, label: p === this.profile ? `* ${p} (active)` : p }))
            });
            if (isCancel(chosen)) return;
            
            this.configMgr.switchProfile(chosen);
            this.profile = chosen;
            log.success(`Switched to profile: ${chosen}`);
            await this.pressEnterToContinue();
        } else if (option === 'create') {
            const name = await text({
                message: 'Enter new profile name:',
                placeholder: 'e.g., family, work',
                validate(val) {
                    if (!val || val.trim().length === 0) return 'Name cannot be empty.';
                    if (/[^a-zA-Z0-9_\-]/.test(val)) return 'Only alphanumeric characters, dashes, and underscores allowed.';
                }
            });
            if (isCancel(name)) return;
            
            const cleanName = name.trim();
            this.configMgr.switchProfile(cleanName);
            this.profile = cleanName;
            this.configMgr.config = {
                serverType: 'pocketbase',
                pbUrl: 'http://127.0.0.1:8090',
                defaultMode: 'run'
            };
            this.configMgr.save(this.configMgr.config);
            log.success(`Created and switched to profile: ${cleanName}`);
            await this.pressEnterToContinue();
        } else if (option === 'delete') {
            const profiles = this.configMgr.getProfiles();
            if (profiles.length === 0) {
                log.warn('No profiles to delete.');
                await this.pressEnterToContinue();
                return;
            }
            const chosen = await select({
                message: 'Select profile to delete:',
                options: profiles.map(p => ({ value: p, label: p }))
            });
            if (isCancel(chosen)) return;
            
            const confirmed = await confirm({
                message: `Are you sure you want to delete profile "${chosen}"? This cannot be undone.`
            });
            if (isCancel(confirmed) || !confirmed) return;
            
            this.configMgr.deleteProfile(chosen);
            log.success(`Deleted profile: ${chosen}`);
            
            if (this.profile === chosen) {
                this.configMgr.switchProfile('default');
                this.profile = 'default';
                log.info('Switched active profile back to "default".');
            }
            await this.pressEnterToContinue();
        }
    }

    async handleConfigMenu() {
        while (true) {
            console.clear();
            const conf = this.configMgr.config || {};
            intro(`Configure Parameters [Profile: ${this.profile}]`);

            const option = await select({
                message: 'Select field to edit:',
                options: [
                    { value: 'dbPath', label: `Database Path: ${conf.dbPath || '(Not set)'}` },
                    { value: 'serverType', label: `Server Type: ${conf.serverType || 'pocketbase'}` },
                    { value: 'pbUrl', label: `PocketBase URL: ${conf.pbUrl || '(Not set)'}` },
                    { value: 'pbUser', label: `PocketBase Username/Email: ${conf.pbUser || '(Not set)'}` },
                    { value: 'pbPass', label: `PocketBase Password: ${conf.encryptedToken ? '***** (Session token active)' : '(Not set)'}` },
                    { value: 'mmexExe', label: `MMEX Executable Path: ${conf.mmexExe || '(Not set)'}` },
                    { value: 'defaultMode', label: `Default Execution Mode: ${conf.defaultMode || 'run'}` },
                    { value: 'back', label: '👈 Back to Main Menu' }
                ]
            });

            if (isCancel(option) || option === 'back') break;

            if (option === 'dbPath') {
                const val = await text({
                    message: 'Enter database path (.mmb):',
                    initialValue: conf.dbPath,
                    validate(input) {
                        if (!input || input.trim().length === 0) return 'Path cannot be empty.';
                    }
                });
                if (!isCancel(val)) {
                    conf.dbPath = val.trim();
                    this.configMgr.save(conf);
                }
            } else if (option === 'serverType') {
                const val = await select({
                    message: 'Select remote server type:',
                    options: [
                        { value: 'pocketbase', label: 'PocketBase' }
                    ]
                });
                if (!isCancel(val)) {
                    conf.serverType = val;
                    this.configMgr.save(conf);
                }
            } else if (option === 'pbUrl') {
                const val = await text({
                    message: 'Enter PocketBase instance URL:',
                    initialValue: conf.pbUrl || 'http://127.0.0.1:8090',
                    validate(input) {
                        if (!input || input.trim().length === 0) return 'URL cannot be empty.';
                    }
                });
                if (!isCancel(val)) {
                    conf.pbUrl = val.trim();
                    this.configMgr.save(conf);
                }
            } else if (option === 'pbUser') {
                const val = await text({
                    message: 'Enter PocketBase email/username:',
                    initialValue: conf.pbUser,
                    validate(input) {
                        if (!input || input.trim().length === 0) return 'Username/email cannot be empty.';
                    }
                });
                if (!isCancel(val)) {
                    conf.pbUser = val.trim();
                    this.configMgr.save(conf);
                }
            } else if (option === 'pbPass') {
                const passVal = await password({
                    message: 'Enter PocketBase password (we will authenticate and save a token):'
                });
                if (!isCancel(passVal) && passVal.length > 0) {
                    const s = spinner();
                    s.start('Authenticating on PocketBase and caching token...');
                    try {
                        const { RemoteServiceFactory } = await import('../api/RemoteServiceFactory.js');
                        const remoteService = RemoteServiceFactory.create(conf.serverType || 'pocketbase', conf.pbUrl);
                        remoteService.invalidateToken();
                        await remoteService.authenticate(conf.pbUser, passVal);
                        conf.token = remoteService.getToken();
                        conf.pbAuthCollection = remoteService.authCollection;
                        this.configMgr.updateConfig(conf);
                        s.stop('✅ Connected and authenticated! Token saved successfully.');
                    } catch (err) {
                        s.stop('❌ Authentication failed. Please verify credentials/URL.');
                        log.error(`Details: ${err.message}`);
                    }
                    await this.pressEnterToContinue();
                }
            } else if (option === 'mmexExe') {
                const foundPaths = this.configMgr._searchMMEXExecutable();
                const choices = foundPaths.map(p => ({ value: p, label: p }));
                choices.push({ value: 'MANUAL', label: 'Enter path manually...' });
                
                let val = await select({
                    message: 'Select or input MoneyManagerEx executable path:',
                    options: choices
                });
                
                if (!isCancel(val)) {
                    if (val === 'MANUAL') {
                        val = await text({
                            message: 'Enter MMEX exe path manually:',
                            initialValue: conf.mmexExe || 'C:\\Program Files\\Money Manager Ex\\bin\\mmex.exe',
                            validate(input) {
                                if (!input || input.trim().length === 0) return 'Path cannot be empty.';
                            }
                        });
                    }
                    if (!isCancel(val)) {
                        conf.mmexExe = val.trim();
                        this.configMgr.save(conf);
                    }
                }
            } else if (option === 'defaultMode') {
                const val = await select({
                    message: 'Select default execution mode:',
                    options: [
                        { value: 'run', label: 'Run mode' },
                        { value: 'sync', label: 'Sync mode' },
                        { value: 'watch', label: 'Watch mode' }
                    ]
                });
                if (!isCancel(val)) {
                    conf.defaultMode = val;
                    this.configMgr.save(conf);
                }
            }
        }
    }

    async checkForUpdates() {
        console.clear();
        intro('Checking for Updates');
        const s = spinner();
        s.start('Connecting to GitHub...');
        try {
            const { UpdateService } = await import('../services/UpdateService.js');
            const updateService = new UpdateService(this.cliArgs);
            s.stop('Check completed');
            await updateService.checkForUpdate();
        } catch (err) {
            s.stop('Check failed');
            log.error(`Error: ${err.message}`);
        }
        await this.pressEnterToContinue();
    }

    async runAutoUpdate() {
        console.clear();
        intro('Auto Update');
        const s = spinner();
        s.start('Downloading and installing latest version...');
        try {
            const { UpdateService } = await import('../services/UpdateService.js');
            const updateService = new UpdateService(this.cliArgs);
            s.stop('Download completed');
            await updateService.autoDownloadUpdate();
        } catch (err) {
            s.stop('Update failed');
            log.error(`Error: ${err.message}`);
        }
        await this.pressEnterToContinue();
    }

    async clearLocalDb() {
        console.clear();
        intro('Clear Database Tables');
        const conf = this.configMgr.config;
        if (!conf.dbPath) {
            log.error('Database path not configured.');
            await this.pressEnterToContinue();
            return;
        }

        const confirmed = await confirm({
            message: 'Are you sure you want to remove ALL technical tables on the local database?',
            initialValue: false
        });

        if (isCancel(confirmed) || !confirmed) return;

        const s = spinner();
        s.start('Clearing database technical tables...');
        try {
            const { DatabaseService } = await import('../database/DatabaseService.js');
            const db = new DatabaseService(conf.dbPath, this.cliArgs.verbose);
            db.connect(false);
            db.clearTechnicalSchema();
            s.stop('Local database cleared successfully.');
        } catch (err) {
            s.stop('Database clearance failed.');
            log.error(`Error: ${err.message}`);
        }
        await this.pressEnterToContinue();
    }

    async clearRemoteServer() {
        console.clear();
        intro('Clear Remote Server Data');
        const conf = this.configMgr.config;
        if (!conf.pbUrl || !conf.pbUser) {
            log.error('Remote server URL or User not configured.');
            await this.pressEnterToContinue();
            return;
        }

        const confirmed = await confirm({
            message: 'Are you sure you want to clear ALL data on the remote server?',
            initialValue: false
        });

        if (isCancel(confirmed) || !confirmed) return;

        const s = spinner();
        s.start('Connecting and authenticating...');
        try {
            const { RemoteServiceFactory } = await import('../api/RemoteServiceFactory.js');
            const remoteService = RemoteServiceFactory.create(conf.serverType || 'pocketbase', conf.pbUrl);
            
            // Authentication
            if (conf.pbPass) {
                remoteService.invalidateToken();
                await remoteService.authenticate(conf.pbUser, conf.pbPass);
                conf.token = remoteService.getToken();
                conf.pbAuthCollection = remoteService.authCollection;
                this.configMgr.updateConfig(conf);
            } else if (conf.token) {
                remoteService.setToken(conf.token);
                remoteService.authCollection = conf.pbAuthCollection;
                await remoteService.refreshToken();
                conf.token = remoteService.getToken();
                this.configMgr.updateConfig(conf);
            } else {
                const passwordVal = await password({
                    message: 'Enter PocketBase password to authenticate:'
                });
                if (isCancel(passwordVal) || passwordVal.length === 0) {
                    s.stop('Cancelled');
                    return;
                }
                remoteService.invalidateToken();
                await remoteService.authenticate(conf.pbUser, passwordVal);
                conf.token = remoteService.getToken();
                conf.pbAuthCollection = remoteService.authCollection;
                this.configMgr.updateConfig(conf);
            }
            
            s.message('Clearing remote collections...');
            await remoteService.clearRemoteServer();
            s.stop('Remote server data cleared successfully.');
        } catch (err) {
            s.stop('Clearance failed');
            log.error(`Error: ${err.message}`);
        }
        await this.pressEnterToContinue();
    }
}
