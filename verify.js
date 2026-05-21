import Database from 'better-sqlite3';
import { SYNC_CONFIG, SYNC_ORDER } from './src/config/table_config.js';



// ==========================================
// CONFIGURATION & ARGUMENTS
// ==========================================
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    const cleanKey = key.replace('--', '');
    acc[cleanKey] = value !== undefined ? value : true;
    return acc;
}, {});

if (args.help || !args.db1 || !args.db2) {
    console.log(`
Usage: node verify.js --db1=<path_to_db1> --db2=<path_to_db2> [--verbose]

Description:
  Compares two MMEX databases to find differences in synchronized tables.
  Checks for:
  - Missing records (based on pb_id)
  - Differences in field values
  Options:
    --verbose  - Show all tables, even if they match
    --help     - Show this help message
    `);
    process.exit(0);
}


function verify() {
    if (args.verbose) console.log(`\nComparing DB1: ${args.db1} | DB2: ${args.db2}`);

    let db1, db2;
    try {
        db1 = new Database(args.db1, { fileMustExist: true });
        db2 = new Database(args.db2, { fileMustExist: true });
    } catch (error) {
        console.error(`❌ Error opening databases: ${error.message}\n`);
        process.exit(1);
    }

    let tableTotals = 0;
    let tableFailures = 0;

    for (const [tableName, config] of Object.entries(SYNC_CONFIG)) {

        // 1. Carichiamo tutti i record usando pb_id come chiave universale
        const records1 = db1.prepare(`SELECT * FROM ${tableName} WHERE pb_id IS NOT NULL`).all();
        const records2 = db2.prepare(`SELECT * FROM ${tableName} WHERE pb_id IS NOT NULL`).all();

        const map2 = new Map(records2.map(r => [r.pb_id, r]));
        let tableIssues = 0;

        // 2. Verifica da DB1 a DB2
        records1.forEach(row1 => {
            const row2 = map2.get(row1.pb_id);

            if (!row2) {
                if (args.verbose) console.warn(`Table: ${tableName}: ❌ Missing in DB2: pb_id ${row1.pb_id} (${config.pk}: ${row1[config.pk]})`);
                tableIssues++;
                return;
            }

            // Confronto campi
            config.fields.forEach(field => {
                let val1 = row1[field];
                let val2 = row2[field];

                // Normalizzazione per confronto (es. date o null)
                if (val1 !== val2) {
                    if (args.verbose) console.warn(`Table: ${tableName}: ⚠️  Difference in pb_id ${row1.pb_id}: Field [${field}] | DB1: '${val1}' vs DB2: '${val2}'`);
                    tableIssues++;
                }
            });
        });

        // 3. Verifica record extra in DB2
        const map1 = new Map(records1.map(r => [r.pb_id, r]));
        records2.forEach(row2 => {
            if (!map1.has(row2.pb_id)) {
                if (args.verbose) console.warn(`Table: ${tableName}: ❌ Extra in DB2: pb_id ${row2.pb_id} (${config.pk}: ${row2[config.pk]})`);
                tableIssues++;
            }
        });

        if (tableIssues === 0) {
            tableTotals++;
            if (args.verbose) console.log(`Table: ${tableName}: OK: All records match.`);
        } else {
            tableFailures++;
            console.log(`Table: ${tableName}: Summary: Found ${tableIssues} issues.`);
        }
    }

    db1.close();
    db2.close();

    console.log(`\nSummary: ${tableTotals} tables OK, ${tableFailures} tables with issues.`);

    if (tableFailures === 0) {
        console.log('✅ Databases are identical.');
        process.exit(0);
    } else {
        console.log('❌ Databases have differences.');
        process.exit(1);
    }
}

verify();
