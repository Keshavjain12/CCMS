














const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "..", "..", "uploads");


const MAX_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES || String(5 * 1024 * 1024), 10);


const EXT_BY_TYPE = {
  photo:    ["jpg", "jpeg", "png", "gif", "webp"],
  video:    ["mp4", "webm", "mov"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"],
};
const ALL_EXT = new Set(Object.values(EXT_BY_TYPE).flat());
const DEFAULT_EXT = { photo: "jpg", video: "mp4", document: "pdf" };

const CONTENT_TYPE = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};


const SAFE_NAME = /^att_[0-9a-f-]+\.[a-z0-9]+$/i;

function ensureDir() { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); }

function extFor(fileName, fileType) {
  const ext = String(path.extname(fileName || "")).replace(".", "").toLowerCase();
  if (ext && ALL_EXT.has(ext)) return ext;
  return DEFAULT_EXT[fileType] || "bin";
}


function newStoredName(fileType, fileName) {
  return `att_${crypto.randomUUID()}.${extFor(fileName, fileType)}`;
}

function write(storedName, buffer) {
  ensureDir();
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
}


function resolveStored(storedName) {
  if (!SAFE_NAME.test(String(storedName || ""))) return null;
  const p = path.join(UPLOAD_DIR, storedName);
  return p.startsWith(UPLOAD_DIR) ? p : null;
}


function remove(storedName) {
  const p = resolveStored(storedName);
  if (p && fs.existsSync(p)) {
    try { fs.unlinkSync(p); return true; } catch (_) {  }
  }
  return false;
}

function contentTypeFor(storedName) {
  const ext = path.extname(String(storedName || "")).replace(".", "").toLowerCase();
  return CONTENT_TYPE[ext] || "application/octet-stream";
}

module.exports = {
  UPLOAD_DIR, MAX_BYTES, EXT_BY_TYPE,
  newStoredName, write, resolveStored, remove, contentTypeFor,
};
