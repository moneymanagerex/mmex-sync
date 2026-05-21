const { createRequire } = require('node:module');
const path = require('node:path');

const execDir = path.dirname(process.execPath);
const execRequire = createRequire(path.join(execDir, 'dummy.js'));

// We override the global require and __non_webpack_require__ to intercept better_sqlite3.node
global.__non_webpack_require__ = function(id) {
    if (id.endsWith('better_sqlite3.node')) {
        return execRequire(path.join(execDir, 'better_sqlite3.node'));
    }
    return execRequire(id);
};

// Also patch Module.prototype.require for extra safety
const Module = require('node:module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (typeof id === 'string' && id.endsWith('better_sqlite3.node')) {
        return execRequire(path.join(execDir, 'better_sqlite3.node'));
    }
    try {
        return originalRequire.apply(this, arguments);
    } catch (e) {
        if (e.code === 'ERR_UNKNOWN_BUILTIN_MODULE') {
            return execRequire(id);
        }
        throw e;
    }
};
