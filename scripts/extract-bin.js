#!/usr/bin/env node
'use strict';
// Extract bin/bin.zip into the bin/ directory so local GPU/D3D12 backends are
// available. The raw .exe/.dll files are excluded from the npm tarball to keep
// it small; this script restores them from the bundled archive.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const binDir = path.join(__dirname, '..', 'bin');
const zipPath = path.join(binDir, 'bin.zip');
const targetDir = binDir;

function readUInt32LE(buf, off) {
  return buf.readUInt32LE(off);
}

function readUInt16LE(buf, off) {
  return buf.readUInt16LE(off);
}

function extractZip(zipFile, outDir) {
  const data = fs.readFileSync(zipFile);
  if (data.length < 22) throw new Error('Invalid zip file');

  // Find end-of-central-directory record
  let eocd = data.length - 22;
  while (eocd >= 0) {
    if (data.readUInt32LE(eocd) === 0x06054b50) break;
    eocd -= 1;
  }
  if (eocd < 0) throw new Error('Cannot find end of central directory');

  const cdCount = readUInt16LE(data, eocd + 10);
  const cdSize = readUInt32LE(data, eocd + 12);
  const cdOffset = readUInt32LE(data, eocd + 16);

  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (data.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory signature');
    const comp = readUInt16LE(data, p + 10);
    const size = readUInt32LE(data, p + 20);
    const nameLen = readUInt16LE(data, p + 28);
    const extraLen = readUInt16LE(data, p + 30);
    const commentLen = readUInt16LE(data, p + 32);
    const locOffset = readUInt32LE(data, p + 42);
    const name = data.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;

    const outPath = path.join(outDir, name);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    let q = locOffset;
    if (data.readUInt32LE(q) !== 0x04034b50) throw new Error('Bad local file header');
    const locNameLen = readUInt16LE(data, q + 26);
    const locExtraLen = readUInt16LE(data, q + 28);
    const bodyOff = q + 30 + locNameLen + locExtraLen;
    const body = data.subarray(bodyOff, bodyOff + size);

    let outBuf;
    if (comp === 0) {
      outBuf = body;
    } else if (comp === 8) {
      outBuf = zlib.inflateRawSync(body);
    } else {
      throw new Error(`Unsupported compression ${comp} for ${name}`);
    }

    fs.writeFileSync(outPath, outBuf);
    console.log(`extracted: ${name}`);
  }
}

if (!fs.existsSync(zipPath)) {
  console.error(`bin.zip not found at ${zipPath}`);
  process.exit(1);
}

extractZip(zipPath, targetDir);
console.log(`\nNative binaries extracted to ${targetDir}`);
