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
    const tempCacheDir = path.resolve('dist', 'pkg-temp-cache');
    try {
        if (!fs.existsSync(entryPoint)) {
            throw new Error(`File di input non trovato: ${entryPoint}. Lancia prima npm run build.`);
        }

        // Assicuriamoci che la cartella dist/bin esista prima di compilarci dentro
        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
        }

        const outputBasePattern = path.join(binDir, 'mmex-sync');
        const homedir = os.homedir();
        const defaultCacheDir = path.join(homedir, '.pkg-cache');

        let cachedBinaries = findCachedBinaries(defaultCacheDir, 24);

        // Fallback se i binari non sono ancora presenti nella cache globale
        if (cachedBinaries.length === 0) {
            console.log('📥 Binari base di Node 24 non trovati nella cache. Download in corso tramite build preliminare...');
            await exec([
                entryPoint,
                '--output', outputBasePattern,
                '--target', 'node24-win-x64,node24-linux-x64,node24-macos-x64'
            ]);
            cachedBinaries = findCachedBinaries(defaultCacheDir, 24);
        }

        if (cachedBinaries.length === 0) {
            throw new Error('Impossibile trovare o scaricare i binari base di Node 24.');
        }

        // Crea una cache locale temporanea e copia i binari originali
        console.log('🔄 Copia dei binari base nella cache locale temporanea...');
        if (fs.existsSync(tempCacheDir)) {
            fs.rmSync(tempCacheDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempCacheDir, { recursive: true });

        for (const bin of cachedBinaries) {
            const destDir = path.join(tempCacheDir, bin.cacheVersion);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(bin.fullPath, path.join(destDir, bin.filename));
        }

        // Applica rcedit al binario base di Windows nella cache temporanea
        const winBin = cachedBinaries.find(b => b.filename.includes('win-x64'));
        if (winBin) {
            const localWinBinPath = path.join(tempCacheDir, winBin.cacheVersion, winBin.filename);
            console.log('🎨 Applicazione dettagli e icona al binario base di Windows...');
            await rcedit(localWinBinPath, {
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
            console.log('✅ Metadati e icona inseriti nel binario base.');
        }

        // Compila l'eseguibile finale usando la cache locale modificata
        console.log('📦 Avvio del packaging con @yao-pkg/pkg usando il binario patchato...');
        process.env.PKG_CACHE_PATH = tempCacheDir;

        await exec([
            entryPoint,
            '--output', outputBasePattern,
            '--target', 'node24-win-x64,node24-linux-x64,node24-macos-x64'
        ]);

        // Sposta i file nelle sottocartelle dedicate rinominandoli
        const srcWin = path.join(binDir, 'mmex-sync-win.exe');
        const srcLinux = path.join(binDir, 'mmex-sync-linux');
        const srcMacos = path.join(binDir, 'mmex-sync-macos');

        const winDir = path.join(binDir, 'win');
        const linuxDir = path.join(binDir, 'linux');
        const macosDir = path.join(binDir, 'macos');

        if (fs.existsSync(winDir)) fs.rmSync(winDir, { recursive: true, force: true });
        if (fs.existsSync(linuxDir)) fs.rmSync(linuxDir, { recursive: true, force: true });
        if (fs.existsSync(macosDir)) fs.rmSync(macosDir, { recursive: true, force: true });

        fs.mkdirSync(winDir, { recursive: true });
        fs.mkdirSync(linuxDir, { recursive: true });
        fs.mkdirSync(macosDir, { recursive: true });

        if (fs.existsSync(srcWin)) {
            fs.renameSync(srcWin, path.join(winDir, 'mmex-sync.exe'));
        } else {
            throw new Error(`Impossibile trovare il binario Windows in ${srcWin}`);
        }

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

        // Generazione dei file ZIP finali (uno per ciascuna piattaforma)
        await createReleaseZipForPlatform('win', 'mmex-sync.exe', path.join(winDir, 'mmex-sync.exe'));
        await createReleaseZipForPlatform('linux', 'mmex-sync', path.join(linuxDir, 'mmex-sync'));
        await createReleaseZipForPlatform('macos', 'mmex-sync', path.join(macosDir, 'mmex-sync'));

        console.log(`\n🎉 RELEASE PRONTA! ZIP generati in: ${outDir}\n`);

    } catch (error) {
        console.error('❌ Errore durante il processo di distribuzione:', error);
        process.exit(1);
    } finally {
        // Pulizia della cache temporanea
        if (fs.existsSync(tempCacheDir)) {
            try {
                fs.rmSync(tempCacheDir, { recursive: true, force: true });
                console.log('🧹 Cache temporanea pulita.');
            } catch (err) {
                console.warn('⚠️ Impossibile rimuovere la cache temporanea:', err.message);
            }
        }
    }
}

main();