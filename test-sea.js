const { createRequire } = require('node:module');
const path = require('node:path');
const myRequire = createRequire(path.join(process.cwd(), 'index.js'));
try {
    const bsql = myRequire('better-sqlite3');
    console.log("SUCCESS loading better-sqlite3!");
} catch (e) {
    console.log("FAILED loading better-sqlite3:", e.message);
}
