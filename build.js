import * as esbuild from 'esbuild';
import path from 'path';

await esbuild.build({
    entryPoints: ['src/index.js'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/bundle.js',
    format: 'cjs',
    plugins: [{
        name: 'alias-bindings',
        setup(build) {
            build.onResolve({ filter: /^bindings$/ }, args => {
                return { path: args.path, namespace: 'bindings-alias' }
            });
            build.onLoad({ filter: /.*/, namespace: 'bindings-alias' }, args => {
                return {
                    contents: `
                        const { createRequire } = require('node:module');
                        const path = require('node:path');
                        module.exports = function(name) {
                            const execDir = path.dirname(process.execPath);
                            const req = createRequire(path.join(execDir, 'dummy.js'));
                            const nodeFile = name.endsWith('.node') ? name : name + '.node';
                            return req(path.join(execDir, nodeFile));
                        };
                    `
                };
            });
        }
    }]
}).catch(() => process.exit(1));
