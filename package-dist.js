import { exec } from '@yao-pkg/pkg';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import { rcedit } from 'rcedit';
import os from 'os';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version || '0.0.1';

const entryPoint = path.join('dist', 'app', 'bundle.cjs');
const binDir = path.resolve('dist', 'bin');       // C:\...\dist\bin
const outDir = path.resolve('dist', 'release');   // C:\...\dist\release

function findCachedBinaries(cacheDir, nodeMajorVersion) {
    const results = [];
    if (!fs.existsSync(cacheDir)) return results;

    const versions = fs.readdirSync(cacheDir);
    for (const v of versions) {
        const vPath = path.join(cacheDir, v);
        if (!fs.statSync(vPath).isDirectory()) continue;

        const files = fs.readdirSync(vPath);
        for (const file of files) {
            if (file.startsWith(`fetched-v${nodeMajorVersion}.`) || file.startsWith(`built-v${nodeMajorVersion}.`)) {
                results.push({
                    cacheVersion: v,
                    filename: file,
                    fullPath: path.join(vPath, file)
                });
            }
        }
    }
    return results;
}

async function createReleaseZipForPlatform(platform, exeFilename, exeSourcePath) {
    const zipName = `mmex-sync-v${version}-${platform}.zip`;
    const zipPath = path.join(outDir, zipName);
    console.log(`🤐 Creazione pacchetto ZIP di release per ${platform}: ${zipPath}...`);

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    if (!fs.existsSync(exeSourcePath)) {
        throw new Error(`File non trovato per l'archiviazione ZIP: ${exeSourcePath}`);
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(zipPath);

    return new Promise((resolve, reject) => {
        stream.on('close', () => resolve());
        archive.on('error', err => reject(err));
        archive.pipe(stream);

        // Aggiunge l'eseguibile direttamente alla radice dello ZIP
        archive.file(exeSourcePath, { name: exeFilename });

        archive.finalize();
    });
}

async function main() {
    try {
        if (!fs.existsSync(entryPoint)) {
            throw new Error(`File di input non trovato: ${entryPoint}. Lancia prima npm run build.`);
        }

        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
        }

        const outputBasePattern = path.join(binDir, 'mmex-sync');

        // 1. Compila direttamente usando la cache standard (senza magheggi temporanei)
        console.log('📦 Avvio del packaging standard con @yao-pkg/pkg...');
        await exec([
            entryPoint,
            '--output', outputBasePattern,
            '--target', 'node24-win-x64,node24-linux-x64,node24-macos-x64'
        ]);

        // I file generati si troveranno in dist/bin/
        const srcWin = path.join(binDir, 'mmex-sync-win.exe');
        const srcLinux = path.join(binDir, 'mmex-sync-linux');
        const srcMacos = path.join(binDir, 'mmex-sync-macos');

        // 2. APPLICA RCEDIT QUI, SULL'ESEGUIBILE FINALE APPENA GENERATO!
        if (fs.existsSync(srcWin)) {
            console.log('🎨 Applicazione dettagli e icona all\'eseguibile Windows finale...');
            await rcedit(srcWin, {
                'version-string': {
                    'CompanyName': 'Wolfsolver',
                    'FileDescription': 'Money Manager Ex Synchronization System',
                    'LegalCopyright': `Copyright (C) ${new Date().getFullYear()} Wolfsolver`,
                    'ProductName': 'mmex-sync',
                    'ProductVersion': version
                },
                'file-version': version,
                'product-version': version,
                'icon': path.resolve('assets/icons/icon.ico')
            });
            console.log('✅ Metadati e icona inseriti con successo nell\'eseguibile.');
        } else {
            throw new Error(`Impossibile trovare il binario Windows per rcedit in ${srcWin}`);
        }

        // 3. Ora procedi pure con la tua logica di spostamento nelle sottocartelle
        const winDir = path.join(binDir, 'win');
        const linuxDir = path.join(binDir, 'linux');
        const macosDir = path.join(binDir, 'macos');

        if (fs.existsSync(winDir)) fs.rmSync(winDir, { recursive: true, force: true });
        if (fs.existsSync(linuxDir)) fs.rmSync(linuxDir, { recursive: true, force: true });
        if (fs.existsSync(macosDir)) fs.rmSync(macosDir, { recursive: true, force: true });

        fs.mkdirSync(winDir, { recursive: true });
        fs.mkdirSync(linuxDir, { recursive: true });
        fs.mkdirSync(macosDir, { recursive: true });

        // Spostamento dei file (l'exe ora ha già l'icona)
        fs.renameSync(srcWin, path.join(winDir, 'mmex-sync.exe'));

        if (fs.existsSync(srcLinux)) {
            fs.renameSync(srcLinux, path.join(linuxDir, 'mmex-sync'));
        } else {
            throw new Error(`Impossibile trovare il binario Linux in ${srcLinux}`);
        }

        if (fs.existsSync(srcMacos)) {
            fs.renameSync(srcMacos, path.join(macosDir, 'mmex-sync'));
        } else {
            throw new Error(`Impossibile trovare il binario MacOS in ${srcMacos}`);
        }

        console.log(`✅ Binari nativi organizzati con successo in: ${binDir}`);

        // Generazione dei file ZIP finali
        await createReleaseZipForPlatform('win', 'mmex-sync.exe', path.join(winDir, 'mmex-sync.exe'));
        await createReleaseZipForPlatform('linux', 'mmex-sync', path.join(linuxDir, 'mmex-sync'));
        await createReleaseZipForPlatform('macos', 'mmex-sync', path.join(macosDir, 'mmex-sync'));

        console.log(`\n🎉 RELEASE PRONTA! ZIP generati in: ${outDir}\n`);

    } catch (error) {
        console.error('❌ Errore durante il processo di distribuzione:', error);
        process.exit(1);
    }
    // Nota: Ho rimosso il blocco 'finally' perché la cache temporanea non serve più!
}

main();