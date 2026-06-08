import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version || '0.0.1';
const zipName = `mmex-sync-v${version}.zip`;

const sourceDir = path.join('dist');
// Lo ZIP finale viene salvato dentro dist/release/
const outDir = path.join('dist', 'release');

async function createReleaseZip() {
    console.log(`\n🤐 Creazione pacchetto ZIP universale: dist/release/${zipName}...`);

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(path.join(outDir, zipName));

    return new Promise((resolve, reject) => {
        stream.on('close', () => resolve());
        archive.on('error', err => reject(err));
        archive.pipe(stream);

        // Include l'intera struttura di dist/ (il launcher e la cartella app/)
        // ma ignora la cartella di output 'release' per evitare di inserire ricorsivamente lo zip dentro se stesso
        archive.glob('**/*', {
            cwd: sourceDir,
            ignore: ['release/**']
        });

        archive.finalize();
    });
}

if (!fs.existsSync(sourceDir)) {
    console.error(`❌ Errore: la cartella ${sourceDir} non esiste. Lancia prima npm run build.`);
    process.exit(1);
}

createReleaseZip()
    .then(() => console.log(`\n🎉 RELEASE PRONTA! Generato: dist/release/${zipName}\n`))
    .catch(console.error);