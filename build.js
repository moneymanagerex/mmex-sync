import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const osArg = args.find(arg => arg.startsWith('--os='));
const targetOS = osArg ? osArg.split('=')[1] : (process.platform === 'win32' ? 'win' : 'linux');

const isTargetWindows = targetOS === 'win';
const exeExtension = isTargetWindows ? '.exe' : '';
const binaryName = `mmex-sync${exeExtension}`;
const distFolder = path.join('dist', targetOS);

async function main() {
    console.log(`\n🚀 Avvio build per target: ${targetOS.toUpperCase()}`);

    if (!fs.existsSync(distFolder)) {
        fs.mkdirSync(distFolder, { recursive: true });
    }

    console.log("1. Bundling con esbuild...");
    await esbuild.build({
        entryPoints: ['src/index.js'],
        bundle: true,
        platform: 'node',
        target: 'node20',
        outfile: path.join(distFolder, 'bundle.js'),
        format: 'cjs',
        plugins: [{
            name: 'alias-bindings',
            setup(build) {
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

    console.log("2. Generazione SEA blob...");
    execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

    console.log(`3. Copia del binario base di Node.js...`);
    const destExecutable = path.join(distFolder, binaryName);
    fs.copyFileSync(process.execPath, destExecutable);

    // Gestione Icona (Solo se il target è Windows e siamo fisicamente su Windows)
    if (isTargetWindows && process.platform === 'win32') {
        const iconPath = path.join('assets', 'icons', 'icon.ico');
        const rceditPath = path.join('node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
        if (fs.existsSync(iconPath) && fs.existsSync(rceditPath)) {
            console.log("4. Applicazione icona personalizzata (Windows)...");
            execSync(`"${rceditPath}" "${destExecutable}" --set-icon "${iconPath}"`, { stdio: 'inherit' });
        }
    }

    console.log("5. Injection del blob con postject...");
    const buffer = fs.readFileSync(destExecutable);
    const match = buffer.toString('utf8').match(/NODE_SEA_FUSE_[a-f0-9]+/);
    const sentinel = match ? match[0] : "NODE_SEA_FUSE_f1422af715635223";
    
    execSync(`npx postject "${destExecutable}" NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse ${sentinel}`, { stdio: 'inherit' });

    console.log("6. Copia del modulo nativo better_sqlite3.node...");
    const sqliteNodeSrc = path.join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    const sqliteNodeDest = path.join(distFolder, 'better_sqlite3.node');
    if (fs.existsSync(sqliteNodeSrc)) {
        fs.copyFileSync(sqliteNodeSrc, sqliteNodeDest);
    } else {
        console.warn(`⚠️ ATTENZIONE: better_sqlite3.node non trovato in ${sqliteNodeSrc}!`);
    }

    console.log("7. Copia file SQL...");
    const sqlSrc = path.join('assets', 'sql', 'tables_v1_for_sync.sql');
    const sqlDest = path.join(distFolder, 'tables_v1_for_sync.sql');
    if (fs.existsSync(sqlSrc)) {
        fs.copyFileSync(sqlSrc, sqlDest);
    }

    console.log(`🎉 Build ${targetOS.toUpperCase()} completata con successo!\n`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});