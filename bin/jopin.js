#!/usr/bin/env node

// >>> Launch node.js with parameters --import jopijs/loader --loader jopijs/loader/loader.mjs --no-warnings

import { spawn } from 'child_process';

const args = [
    '--import', 'jopijs/loader',
    '--loader', 'jopijs/loader/loader.mjs',
    '--no-warnings',
    ...process.argv.slice(2)
];

const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    env: process.env
});

child.on('close', (code) => {
    process.exit(code);
});