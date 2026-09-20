// TypeScript source kept in sync with the canonical CommonJS implementation
// in parser.js. The package runtime and CLI import the .js file directly;
// this module exists for consumers who compile from TypeScript.

const parser = require('./parser.js');

export const KUHULParser = parser.KUHULParser;
export const toKast = parser.toKast;
