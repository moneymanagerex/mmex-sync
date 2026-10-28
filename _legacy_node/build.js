import * as esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';

const distFolder = path.join('dist');
const appFolder = path.join(distFolder, 'app');

async function main() {
    console.log(`\n📦 Generazione bundle universale con esbuild...`);

    if (!fs.existsSync(appFolder)) {
        fs.mkdirSync(appFolder, { recursive: true });
    }

    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const appVersion = packageJson.version || '0.0.1';

    // 1. Compila generando il file bundle.js
    await esbuild.build({
        entryPoints: ['src/index.js'],
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'esm',
        outfile: path.join(appFolder, 'bundle.js'),
        define: {
            '__APP_VERSION__': JSON.stringify(appVersion)
        },
        logOverride: {
            'empty-import-meta': 'silent'
        }
    });
    console.log("✅ dist/app/bundle.js creato.");
    console.log("➡️ Pronto per la compilazione in eseguibile.");

    // 2. COPIA IL FILE SQL NELLA STESSA CARTELLA DEL BUNDLE
    const sqlSrc = path.join('assets', 'sql', 'tables_v1_for_sync.sql');
    if (!fs.existsSync(sqlSrc)) {
        console.error(`❌ Errore: File SQL obbligatorio non trovato in "${sqlSrc}"`);
        throw new Error(`File SQL obbligatorio non trovato: ${sqlSrc}`);
    }
    fs.copyFileSync(sqlSrc, path.join(appFolder, 'tables_v1_for_sync.sql'));
    console.log("✅ Tabelle SQL copiate in " + appFolder);

    // 3. COPIA GLI ASSET STATICI DELLA WEB UI
    const publicSrc = path.join('src', 'server', 'public');
    const publicDest = path.join(appFolder, 'public');
    if (fs.existsSync(publicSrc)) {
        fs.cpSync(publicSrc, publicDest, { recursive: true });
        console.log("✅ Asset Web UI copiati in " + publicDest);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});