import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const rcedit = require('rcedit');
import path from 'path';

const exePath = path.join(process.cwd(), 'dist', 'mmex-sync.exe');
const iconPath = path.join(process.cwd(), 'assets', 'icons', 'icon.ico');

async function main() {
    try {
        await rcedit.rcedit(exePath, { icon: iconPath });
        console.log(`✅ Icona ${iconPath} applicata con successo a ${exePath}`);
    } catch (err) {
        console.error("❌ Errore durante l'applicazione dell'icona:", err.message);
        process.exit(1);
    }
}

main();
