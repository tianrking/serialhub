'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

module.exports = function launch(desktop = false) {
  let binary;
  try {
    const key = `${process.platform}-${process.arch}`;
    const metadata = require('./package.json');
    const filename = require.resolve(`@tianrking/serialhub-${key}/package.json`);
    const platform = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (platform.version !== metadata.version) throw new Error('Native package version differs from the launcher');
    const name = (desktop ? 'serialhub-desktop' : 'serialhub') + (process.platform === 'win32' ? '.exe' : '');
    binary = path.join(path.dirname(filename), 'bin', name);
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(filename), 'native-manifest.json'), 'utf8'));
    const actual = createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
    if (actual !== manifest.files[name].sha256) throw new Error('Native executable checksum mismatch; reinstall the package');
  } catch (error) {
    console.error(`SerialHub: ${error.message}\nInstall with optional dependencies enabled. Supported releases: Windows/macOS/Linux x64 and ARM64 when their native packages are published. Linux needs glibc 2.39+. Portable archives are also available at https://github.com/tianrking/serialhub/releases.`);
    process.exitCode = 1;
    return;
  }
  const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit', windowsHide: desktop });
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      // Console Ctrl+C is delivered to both processes on Windows. Sending a
      // second synthetic signal there force-kills the native child's cleanup.
      if (process.platform === 'win32' && signal === 'SIGINT') return;
      if (!child.killed) child.kill(signal);
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  child.on('error', error => {
    console.error(`SerialHub could not start: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
};
