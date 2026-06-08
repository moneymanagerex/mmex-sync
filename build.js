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

    // 1. Compila modificando l'estensione in .cjs per aggirare il "type": "module"
    await esbuild.build({
        entryPoints: ['src/index.js'],
        bundle: true,
        platform: 'node',
        target: 'node24',
        outfile: path.join(appFolder, 'bundle.cjs'), // <-- CAMBIATO IN .cjs
        format: 'cjs',
        define: {
            '__APP_VERSION__': JSON.stringify(appVersion)
        }
    });
    console.log("✅ dist/app/bundle.cjs creato.");

    // 2. Copia il file SQL delle tabelle in dist/app/
    const sqlSrc = path.join('assets', 'sql', 'tables_v1_for_sync.sql');
    if (fs.existsSync(sqlSrc)) {
        fs.copyFileSync(sqlSrc, path.join(appFolder, 'tables_v1_for_sync.sql'));
        console.log("✅ Tabelle SQL copiate in dist/app/");
    }

    // 3. Genera il file di avvio che punta al file .cjs
    const hybridContent =
        `:; exec node app/bundle.cjs "$@"
@echo off
node app/bundle.cjs %*
`;
    fs.writeFileSync(path.join(distFolder, 'mmex-sync.cmd'), hybridContent, { mode: 0o755 });
    console.log("✅ Launcher universale dist/mmex-sync.cmd generato con successo.");
}

main().catch(console.error);