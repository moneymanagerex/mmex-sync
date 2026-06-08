import { exec } from '@yao-pkg/pkg';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 💡 Il modo ufficiale in Node.js ESM per importare librerie con export non standard
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const resedit = require('resedit');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version || '0.0.1';

// 💡 Controlla se la build di esbuild genera bundle.js o bundle.js e allinea l'estensione qui:
const entryPoint = path.join('dist', 'app', 'bundle.js');
const binDir = path.resolve('dist', 'bin');
const outDir = path.resolve('dist', 'release');

/**
 * Helper per iniettare l'icona e i metadati senza corrompere l'eseguibile
 */
function patchExecutableResources(exePath, iconPath) {
    const nodeExeBuffer = fs.readFileSync(exePath);

    const NtExecutable = resedit.NtExecutable;
    const Resource = resedit.Resource;
    const Data = resedit.Data;

    // Convertiamo il Buffer di Node.js in un Uint8Array nativo
    const exeUint8Array = new Uint8Array(nodeExeBuffer.buffer, nodeExeBuffer.byteOffset, nodeExeBuffer.byteLength);

    // 1. Caricamento dell'eseguibile
    const exe = NtExecutable.fromBinary
        ? NtExecutable.fromBinary(exeUint8Array)
        : NtExecutable.from
            ? NtExecutable.from(exeUint8Array)
            : new NtExecutable(exeUint8Array);

    // 2. Estrazione delle risorse
    const NtResClass = resedit.NtExecutableResource || Resource.NtExecutableResource;
    if (!NtResClass) {
        throw new Error("Impossibile trovare la classe NtExecutableResource nel modulo resedit.");
    }

    const res = NtResClass.fromExecutable ? NtResClass.fromExecutable(exe) : new NtResClass(exe);

    // Recuperiamo l'array reale delle risorse
    const entriesArray = res.entries || [];

    // 3. Configurazione delle informazioni sui metadati (Version Info)
    const versionEntries = Resource.VersionInfo.fromEntries(entriesArray);
    const vi = versionEntries.length > 0 ? versionEntries[0] : new Resource.VersionInfo();

    vi.removeStringValue({ lang: 1033, codepage: 1200 }, 'OriginalFilename');

    vi.setStringValue({ lang: 1033, codepage: 1200 }, 'CompanyName', 'Wolfsolver');
    vi.setStringValue({ lang: 1033, codepage: 1200 }, 'FileDescription', 'Money Manager Ex Synchronization System');
    vi.setStringValue({ lang: 1033, codepage: 1200 }, 'LegalCopyright', `Copyright (C) ${new Date().getFullYear()} Wolfsolver`);
    vi.setStringValue({ lang: 1033, codepage: 1200 }, 'ProductName', 'mmex-sync');
    vi.setStringValue({ lang: 1033, codepage: 1200 }, 'ProductVersion', version);
    vi.setStringValue({ lang: 1033, codepage: 1200 }, 'FileVersion', version);
    vi.setStringValue({ lang: 1033, codepage: 1200 }, 'OriginalFilename', 'mmex-sync.exe');

    const versionArray = version.split('.').map(Number).concat([0, 0, 0, 0]).slice(0, 4);
    vi.productVersion = versionArray;
    vi.fileVersion = versionArray;

    if (typeof vi.outputTo === 'function') {
        vi.outputTo(res);
    } else if (typeof vi.outputToResource === 'function') {
        vi.outputToResource(res);
    }

    // 4. Configurazione dell'Icona (.ico)
    if (fs.existsSync(iconPath)) {
        const nodeIconBuffer = fs.readFileSync(iconPath);
        const iconUint8Array = new Uint8Array(nodeIconBuffer.buffer, nodeIconBuffer.byteOffset, nodeIconBuffer.byteLength);

        const iconFile = Data.IconFile.fromBinary
            ? Data.IconFile.fromBinary(iconUint8Array)
            : Data.IconFile.from
                ? Data.IconFile.from(iconUint8Array)
                : new Data.IconFile(iconUint8Array);

        // Estrariamo l'array delle icone interne con tolleranza per le diverse versioni della libreria
        const iconsItems = iconFile.icons || iconFile.iconEntries || (typeof iconFile.getIcons === 'function' ? iconFile.getIcons() : []);

        if (iconsItems && iconsItems.length > 0) {
            // Mappiamo i pixel-data estratti
            const mappedIcons = iconsItems.map(item => item.data || item);

            // 💡 FIRMA AGGIORNATA PER RESEDIT STABILE:
            // replaceIconsForResource(destEntries, iconGroupID, langID, iconsArray)
            Resource.IconGroupEntry.replaceIconsForResource(
                entriesArray,
                1,       // ID del gruppo di icone (1 = Icona principale dell'eseguibile)
                1033,    // Lingua (1033 = Inglese, default in Windows PE per massima compatibilità)
                mappedIcons
            );
        } else {
            console.warn("⚠️ Attenzione: Impossibile leggere i pixel-data del file .ico, l'icona potrebbe essere saltata.");
        }
    }

    // 5. Riscrittura ed esportazione dell'eseguibile
    if (typeof res.outputTo === 'function') {
        res.outputTo(exe);
    } else if (typeof res.outputToExecutable === 'function') {
        res.outputToExecutable(exe);
    }

    // Generiamo il file finale salvando il buffer sovrascritto
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

async function createReleaseZipForPlatform(platform, exeFilename, exeSourcePath) {
    const zipName = `mmex-sync-v${version}-${platform}.zip`;
    const zipPath = path.join(outDir, zipName);
    console.log(`🤐 Creazione pacchetto ZIP di release per ${platform}: ${zipPath}...`);

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(zipPath);

    return new Promise((resolve, reject) => {
        stream.on('close', () => resolve());
        archive.on('error', err => reject(err));
        archive.pipe(stream);
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

        console.log('📦 Avvio del packaging standard con @yao-pkg/pkg...');
        await exec([
            entryPoint,
            '--output', outputBasePattern,
            '--target', 'node24-win-x64,node24-linux-x64,node24-macos-x64'
        ]);

        const srcWin = path.join(binDir, 'mmex-sync-win.exe');
        const srcLinux = path.join(binDir, 'mmex-sync-linux');
        const srcMacos = path.join(binDir, 'mmex-sync-macos');

        if (fs.existsSync(srcWin)) {
            console.log('🎨 Applicazione dettagli e icona all\'eseguibile Windows finale...');
            patchExecutableResources(srcWin, path.resolve('assets/icons/icon.ico'));
            console.log('✅ Metadati e icona inseriti con successo.');
        } else {
            throw new Error(`Impossibile trovare il binario Windows in ${srcWin}`);
        }

        const winDir = path.join(binDir, 'win');
        const linuxDir = path.join(binDir, 'linux');
        const macosDir = path.join(binDir, 'macos');

        if (fs.existsSync(winDir)) fs.rmSync(winDir, { recursive: true, force: true });
        if (fs.existsSync(linuxDir)) fs.rmSync(linuxDir, { recursive: true, force: true });
        if (fs.existsSync(macosDir)) fs.rmSync(macosDir, { recursive: true, force: true });

        fs.mkdirSync(winDir, { recursive: true });
        fs.mkdirSync(linuxDir, { recursive: true });
        fs.mkdirSync(macosDir, { recursive: true });

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

        await createReleaseZipForPlatform('win', 'mmex-sync.exe', path.join(winDir, 'mmex-sync.exe'));
        await createReleaseZipForPlatform('linux', 'mmex-sync', path.join(linuxDir, 'mmex-sync'));
        await createReleaseZipForPlatform('macos', 'mmex-sync', path.join(macosDir, 'mmex-sync'));

        console.log(`\n🎉 RELEASE PRONTA! ZIP generati in: ${outDir}\n`);

    } catch (error) {
        console.error('❌ Errore durante il processo di distribuzione:', error);
        process.exit(1);
    }
}

main();