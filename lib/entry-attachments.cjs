'use strict';

const fs = require('fs');
const path = require('path');

const MAX_ATTACHMENT_BYTES = Number(process.env.CHORELOG_ATTACHMENT_MAX_BYTES) || 2 * 1024 * 1024;
const MAX_HOUSEHOLD_ATTACHMENT_TOTAL_BYTES =
  Number(process.env.CHORELOG_ATTACHMENT_QUOTA_BYTES) || 50 * 1024 * 1024;

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extForMime(mime) {
  const m = String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  return MIME_TO_EXT[m] || null;
}

function householdAttachmentsDir(dataDir, householdId) {
  return path.join(dataDir, 'households', String(householdId || '').trim(), 'attachments');
}

function entryAttachmentPath(dataDir, householdId, entryId, mime) {
  const ext = extForMime(mime);
  if (!ext) return null;
  return path.join(householdAttachmentsDir(dataDir, householdId), `${String(entryId).trim()}.${ext}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function validateImageMagic(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const m = String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (m === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (m === 'image/png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (m === 'image/gif') {
    return (
      buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38
    );
  }
  if (m === 'image/webp') {
    return (
      buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}

/**
 * @returns {{ buffer: Buffer, mime: string }}
 */
function decodeAttachmentPayload(rawBase64, mimeHint) {
  const s = String(rawBase64 == null ? '' : rawBase64).trim();
  if (!s) {
    const err = new Error('Empty attachment');
    err.code = 'EMPTY';
    throw err;
  }
  if (s.startsWith('data:')) {
    const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(s);
    if (!match || !match[3]) {
      const err = new Error('Invalid attachment data URL');
      err.code = 'INVALID';
      throw err;
    }
    const mime = String(match[1] || '')
      .trim()
      .toLowerCase()
      .split(';')[0];
    const buf = Buffer.from(match[3], 'base64');
    return { buffer: buf, mime };
  }
  const mime = String(mimeHint || '')
    .trim()
    .toLowerCase()
    .split(';')[0];
  if (!mime || !extForMime(mime)) {
    const err = new Error('attachmentMime must be a supported image type');
    err.code = 'INVALID';
    throw err;
  }
  const buf = Buffer.from(s, 'base64');
  return { buffer: buf, mime };
}

function assertAttachmentSize(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    const err = new Error('Invalid attachment');
    err.code = 'INVALID';
    throw err;
  }
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    const err = new Error(`Image too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB)`);
    err.code = 'TOO_LARGE';
    throw err;
  }
  if (buffer.length === 0) {
    const err = new Error('Empty attachment');
    err.code = 'EMPTY';
    throw err;
  }
}

function getAttachmentsDirTotalBytes(dir) {
  try {
    if (!fs.existsSync(dir)) return 0;
    let sum = 0;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) sum += st.size;
      } catch {
        /* ignore */
      }
    }
    return sum;
  } catch {
    return 0;
  }
}

function assertHouseholdQuota(dataDir, householdId, additionalBytes) {
  const dir = householdAttachmentsDir(dataDir, householdId);
  const cur = getAttachmentsDirTotalBytes(dir);
  if (cur + additionalBytes > MAX_HOUSEHOLD_ATTACHMENT_TOTAL_BYTES) {
    const err = new Error('Household photo storage limit reached');
    err.code = 'QUOTA';
    throw err;
  }
}

function writeEntryAttachment(dataDir, householdId, entryId, buffer, mime) {
  assertAttachmentSize(buffer);
  if (!extForMime(mime) || !validateImageMagic(buffer, mime)) {
    const err = new Error('Unsupported or corrupted image');
    err.code = 'INVALID';
    throw err;
  }
  deleteAnyEntryAttachmentFiles(dataDir, householdId, entryId);
  const dir = householdAttachmentsDir(dataDir, householdId);
  ensureDir(dir);
  assertHouseholdQuota(dataDir, householdId, buffer.length);
  const dest = entryAttachmentPath(dataDir, householdId, entryId, mime);
  if (!dest) {
    const err = new Error('Unsupported image type');
    err.code = 'INVALID';
    throw err;
  }
  fs.writeFileSync(dest, buffer);
  return { mime: String(mime).toLowerCase().split(';')[0].trim(), bytes: buffer.length };
}

function deleteEntryAttachmentFile(dataDir, householdId, entryId, mime) {
  if (!mime || !extForMime(mime)) return;
  const p = entryAttachmentPath(dataDir, householdId, entryId, mime);
  safeUnlink(p);
}

/** Removes any stored image for this entry (all known extensions). */
function deleteAnyEntryAttachmentFiles(dataDir, householdId, entryId) {
  const dir = householdAttachmentsDir(dataDir, householdId);
  if (!fs.existsSync(dir)) return;
  const base = String(entryId || '').trim();
  if (!base) return;
  for (const ext of new Set(Object.values(MIME_TO_EXT))) {
    safeUnlink(path.join(dir, `${base}.${ext}`));
  }
}

function readEntryAttachmentFile(dataDir, householdId, entryId, mime) {
  const p = entryAttachmentPath(dataDir, householdId, entryId, mime);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  MAX_HOUSEHOLD_ATTACHMENT_TOTAL_BYTES,
  MIME_TO_EXT,
  extForMime,
  householdAttachmentsDir,
  entryAttachmentPath,
  decodeAttachmentPayload,
  assertAttachmentSize,
  validateImageMagic,
  writeEntryAttachment,
  deleteEntryAttachmentFile,
  deleteAnyEntryAttachmentFiles,
  readEntryAttachmentFile,
  getAttachmentsDirTotalBytes,
  assertHouseholdQuota,
};
