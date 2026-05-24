import fs from 'fs';
import path from 'path';
import archiver from 'archiver';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version || '0.0.0';

const args = process.argv.slice(2);
const osArg = args.find(arg => arg.startsWith('--os='));
const targetOS = osArg ? osArg.split('=')[1] : (process.platform === 'win32' ? 'win' : 'linux');

const isTargetWindows = targetOS === 'win';
const outputDir = path.join('dist', 'output');
const srcFolder = path.join('dist', targetOS);

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const archiveName = path.join(outputDir, `mmex-sync.${version}.${targetOS}.zip`);

console.log(`Inizio creazione archivio per ${targetOS.toUpperCase()}: ${archiveName}`);

const filesToPack = [
    path.join(srcFolder, isTargetWindows ? 'mmex-sync.exe' : 'mmex-sync'),
    path.join(srcFolder, 'better_sqlite3.node'),
    path.join(srcFolder, 'tables_v1_for_sync.sql')
];

for (const file of filesToPack) {
    if (!fs.existsSync(file)) {
        console.error(`❌ Errore: File non trovato: ${file}. Esegui prima la build per quel target.`);
        process.exit(1);
    }
}

const output = fs.createWriteStream(archiveName);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
    console.log(`✅ Archivio ${targetOS.toUpperCase()} creato con successo! (${archive.pointer()} bytes)`);
});

archive.on('error', (err) => { throw err; });
archive.pipe(output);

filesToPack.forEach(file => {
    archive.file(file, { name: path.basename(file) });
});

archive.finalize();