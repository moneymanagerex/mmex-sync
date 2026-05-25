import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

// 1. Configurazione Iniziale e Target OS
const args = process.argv.slice(2);
const osArg = args.find(arg => arg.startsWith('--os='));
// Rileva l'OS di destinazione ('linux', 'win' o 'mac')
const targetOS = osArg ? osArg.split('=')[1] : (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux');

const isTargetWindows = targetOS === 'win';
const exeExtension = isTargetWindows ? '.exe' : '';
const binaryName = `mmex-sync${exeExtension}`;
const distFolder = path.join('dist', targetOS);

async function main() {
    console.log(`\n🚀 AVVIO BUILD CROSS-PLATFORM CON PKG -> Target: ${targetOS.toUpperCase()}`);

    // Crea la cartella di destinazione (es. dist/linux/ o dist/win/)
    if (!fs.existsSync(distFolder)) {
        fs.mkdirSync(distFolder, { recursive: true });
    }

    // --------------------------------------------------------------------------
    // PASSO 1: BUNDLING CON ESBUILD (Uniamo tutto il tuo JS in un unico file)
    // --------------------------------------------------------------------------
    console.log("\n📦 Passo 1: Compilazione del codice sorgente con esbuild...");
    const bundlePath = path.join(distFolder, 'bundle.js');

    await esbuild.build({
        entryPoints: ['src/index.js'],
        bundle: true,
        platform: 'node',
        target: 'node18', // Scegliamo un target stabile supportato da pkg
        outfile: bundlePath,
        format: 'cjs',
        plugins: [{
            name: 'alias-bindings',
            setup(build) {
                // Configurazione per fare in modo che il modulo nativo SQLite cerchi il file .node ACCANTO all'eseguibile finalizzato
                build.onResolve({ filter: /^bindings$/ }, args => {
                    return { path: args.path, namespace: 'bindings-alias' }
                });
                build.onLoad({ filter: /.*/, namespace: 'bindings-alias' }, args => {
                    return {
                        contents: `
                            const { createRequire } = require('node:module');
                            const path = require('node:path');
                            module.exports = function(name) {
                                const execDir = path.dirname(process.execPath);
                                const req = createRequire(path.join(execDir, 'dummy.js'));
                                const nodeFile = name.endsWith('.node') ? name : name + '.node';
                                return req(path.join(execDir, nodeFile));
                            };
                        `
                    };
                });
            }
        }]
    });

    // --------------------------------------------------------------------------
    // PASSO 2: COMPILAZIONE CON PKG (Creazione dell'eseguibile autonomo)
    // --------------------------------------------------------------------------
    console.log("\n🛠️ Passo 2: Compilazione del binario nativo con PKG...");

    // Mappiamo i target di pkg: node18-linux, node18-win, node18-macos
    const pkgTarget = targetOS === 'win' ? 'node18-win-x64' : targetOS === 'mac' ? 'node18-macos-x64' : 'node18-linux-x64';
    const outputPath = path.join(distFolder, binaryName);

    try {
        // Lanciamo pkg passandogli il bundle creato da esbuild
        execSync(`npx pkg "${bundlePath}" --target ${pkgTarget} --output "${outputPath}"`, { stdio: 'inherit' });
        console.log(`✅ Binario nativo autoinstallante creato con successo da pkg!`);
    } catch (err) {
        console.error("❌ Errore durante la compilazione con pkg:", err.message);
        throw err;
    }

    // --------------------------------------------------------------------------
    // PASSO 3: GESTIONE ICONA (Solo Windows)
    // --------------------------------------------------------------------------
    if (isTargetWindows && process.platform === 'win32') {
        console.log("\n🎨 Passo 3: [SALTATO] Evito l'uso di rcedit per non corrompere il binario pkg...");
        /* const iconPath = path.join('assets', 'icons', 'icon.ico');
        const rceditPath = path.join('node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
        if (fs.existsSync(iconPath) && fs.existsSync(rceditPath)) {
            execSync(`"${rceditPath}" "${outputPath}" --set-icon "${iconPath}"`, { stdio: 'inherit' });
        }
        */
    }

    // --------------------------------------------------------------------------
    // PASSO 4 & 5: COPIA DEL MODULO NATIVO SQLITE E FILE ASSETS
    // --------------------------------------------------------------------------
    console.log("\n📂 Passo 4: Copia del modulo nativo SQLITE (.node) accanto all'eseguibile...");
    const sqliteNodeSrc = path.join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    const sqliteNodeDest = path.join(distFolder, 'better_sqlite3.node');
    if (fs.existsSync(sqliteNodeSrc)) {
        fs.copyFileSync(sqliteNodeSrc, sqliteNodeDest);
        console.log("✅ better_sqlite3.node pronto.");
    } else {
        console.warn(`⚠️ ATTENZIONE: better_sqlite3.node non trovato in ${sqliteNodeSrc}!`);
    }

    console.log("📋 Passo 5: Copia dei file SQL di configurazione iniziale...");
    const sqlSrc = path.join('assets', 'sql', 'tables_v1_for_sync.sql');
    const sqlDest = path.join(distFolder, 'tables_v1_for_sync.sql');
    if (fs.existsSync(sqlSrc)) {
        fs.copyFileSync(sqlSrc, sqlDest);
        console.log("✅ File SQL pronto.");
    }

    // Pulizia file temporaneo del bundle (opzionale, ma lascia la cartella pulita)
    try {
        if (fs.existsSync(bundlePath)) fs.unlinkSync(bundlePath);
    } catch (e) { }

    console.log(`\n🎉 PROCESSO COMPLETATO! L'applicazione è pronta in: ${outputPath}\n`);
}

main().catch(err => {
    console.error("❌ Errore bloccante durante la build:", err);
    process.exit(1);
});