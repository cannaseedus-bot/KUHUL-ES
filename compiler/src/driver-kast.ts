// TypeScript source kept in sync with the canonical CommonJS implementation
// in driver-kast.js. The package runtime and CLI import the .js file directly;
// this module exists for consumers who compile from TypeScript.

const driver = require('./driver-kast.js');

export const toDriverOnly = driver.toDriverOnly;
export const verifyDriverOnly = driver.verifyDriverOnly;
export const DriverRegistry = driver.DriverRegistry;
export const generateProviderKeypair = driver.generateProviderKeypair;
export const signDriver = driver.signDriver;
export const auditEntry = driver.auditEntry;
export const canonicalJson = driver.canonicalJson;
