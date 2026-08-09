// kuhul-es/runtime/src/node.js
//
// Node.js adapter around the isomorphic KUHUL runtime core.
// Adds file-system helpers (save/load to disk) and a process stdout output stream.

'use strict';

const fs = require('fs');
const path = require('path');
const { KUHULRuntimeCore } = require('./core');

class KUHULRuntimeNode extends KUHULRuntimeCore {
  constructor() {
    super({
      outputStream: process.stdout,
      delayMs: 10,
    });
  }

  async executeFile(filename) {
    const source = fs.readFileSync(filename, 'utf-8');
    return await this.execute(source);
  }

  saveStateToDisk(filename) {
    const state = this.saveState();
    fs.writeFileSync(filename, JSON.stringify(state, null, 2));
    this._log(`State saved to ${filename}`);
  }

  loadStateFromDisk(filename) {
    const state = JSON.parse(fs.readFileSync(filename, 'utf-8'));
    this.loadState(state);
    this._log(`State loaded from ${filename}. Frame: ${this.frame}`);
  }
}

module.exports = { KUHULRuntimeNode };
