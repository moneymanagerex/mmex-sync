import { exec } from '@yao-pkg/pkg';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version || '0.0.1';

// Allineamento percorsi e cartelle di build
const entryPoint = path.join('dist', 'app', 'bundle.js');
const binDir = path.resolve('dist', 'bin');
const outDir = path.resolve('dist', 'release');

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

        // 1. Packaging standard multi-piattaforma diretto
        console.log('📦 Avvio del packaging standard con @yao-pkg/pkg...');
        await exec([
            entryPoint,
            '--output', outputBasePattern,
            '--target', 'node24-win-x64,node24-linux-x64,node24-macos-x64'
        ]);

        const srcWin = path.join(binDir, 'mmex-sync-win.exe');
        const srcLinux = path.join(binDir, 'mmex-sync-linux');
        const srcMacos = path.join(binDir, 'mmex-sync-macos');

        // Verifica consistenza output generati
        if (!fs.existsSync(srcWin)) throw new Error(`Impossibile trovare il binario Windows in ${srcWin}`);
        if (!fs.existsSync(srcLinux)) throw new Error(`Impossibile trovare il binario Linux in ${srcLinux}`);
        if (!fs.existsSync(srcMacos)) throw new Error(`Impossibile trovare il binario MacOS in ${srcMacos}`);

        // 2. Preparazione cartelle di destinazione pulite
        const winDir = path.join(binDir, 'win');
        const linuxDir = path.join(binDir, 'linux');
        const macosDir = path.join(binDir, 'macos');

        if (fs.existsSync(winDir)) fs.rmSync(winDir, { recursive: true, force: true });
        if (fs.existsSync(linuxDir)) fs.rmSync(linuxDir, { recursive: true, force: true });
        if (fs.existsSync(macosDir)) fs.rmSync(macosDir, { recursive: true, force: true });

        fs.mkdirSync(winDir, { recursive: true });
        fs.mkdirSync(linuxDir, { recursive: true });
        fs.mkdirSync(macosDir, { recursive: true });

        // 3. Spostamento e standardizzazione dei nomi dei file generati
        fs.renameSync(srcWin, path.join(winDir, 'mmex-sync.exe'));
        fs.renameSync(srcLinux, path.join(linuxDir, 'mmex-sync'));
        fs.renameSync(srcMacos, path.join(macosDir, 'mmex-sync'));

        console.log(`✅ Binari nativi organizzati con successo in: ${binDir}`);

        // 4. Generazione automatica dei pacchetti compressi per la distribuzione
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