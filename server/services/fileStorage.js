const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const cloudinaryStorage = require('../config/cloudinary');
const logger = require('../utils/logger');

const gzip = promisify(zlib.gzip);

/**
 * Single entry point for storing, deleting and opening uploaded files
 * (résumés, interview files, offer letters).
 *
 * WHERE NEW FILES GO — decided once, from the environment:
 *   NODE_ENV=production  -> Amazon S3 (private bucket, gzip-compressed)
 *   anything else        -> Cloudinary (staging and local development)
 *   STORAGE_PROVIDER=s3|cloudinary overrides this (mainly for local testing).
 *
 * WHERE EXISTING FILES LIVE — decided by how each file was stored, never by
 * the environment, so reading or deleting an old file keeps working even if
 * the environment changes: an S3 file's id is stored as "s3:<object key>" and
 * its url as "s3://<bucket>/<object key>"; everything else is Cloudinary.
 */

const S3_ID_PREFIX = 's3:';
const SIGNED_URL_SECONDS = 15 * 60; // short-lived: a fresh link is made each time a file is opened

function getProvider() {
  const forced = String(process.env.STORAGE_PROVIDER || '').toLowerCase();
  if (forced === 's3' || forced === 'cloudinary') return forced;
  return process.env.NODE_ENV === 'production' ? 's3' : 'cloudinary';
}

/** True when this stored id/url belongs to an S3 object. */
function isS3Id(publicId) {
  return typeof publicId === 'string' && publicId.startsWith(S3_ID_PREFIX);
}

let s3Cache = null;

/** Lazily builds the S3 client so staging/local never need AWS settings. */
function getS3() {
  const region = process.env.AWS_REGION;
  const bucket = process.env.S3_BUCKET;
  if (!region || !bucket) {
    throw new Error('S3 storage is enabled but AWS_REGION and S3_BUCKET are not both set.');
  }
  if (!s3Cache || s3Cache.region !== region) {
    // eslint-disable-next-line global-require
    const { S3Client } = require('@aws-sdk/client-s3');
    // Credentials come from the standard AWS chain (AWS_ACCESS_KEY_ID /
    // AWS_SECRET_ACCESS_KEY in the environment, or an instance role).
    s3Cache = { region, client: new S3Client({ region }) };
  }
  return { client: s3Cache.client, bucket };
}

/** A file name safe to use inside an object key. */
function safeName(name) {
  const base = String(name || 'file').split(/[\\/]/).pop();
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'file';
}

/** Splits "s3://bucket/key..." into its parts; null if it is not one. */
function parseS3Url(url) {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(url || '');
  return match ? { bucket: match[1], key: match[2] } : null;
}

/**
 * Stores one uploaded file.
 * @param {object} params
 * @param {{buffer: Buffer, originalname: string, size?: number, mimetype?: string}} params.file - multer file.
 * @param {string} params.folder - Folder / key prefix, e.g. "resumes".
 * @param {string} [params.filenamePrefix] - Optional text placed before the name, to keep two copies distinct.
 * @returns {Promise<{provider: string, url: string, publicId: string, name: string, size: number, mimeType: string}>}
 *   `url` + `publicId` are what the database stores; name/size/mimeType are the
 *   file's metadata, to be stored beside them.
 */
async function uploadFile({ file, folder, filenamePrefix = '' }) {
  const provider = getProvider();
  const name = file.originalname;
  const size = file.size ?? file.buffer.length;
  // Only PDFs whose content was verified (assertPdfUpload) reach storage, so
  // record the true type even if the browser declared something else.
  const mimeType = 'application/pdf';

  if (provider === 's3') {
    const { client, bucket } = getS3();
    // eslint-disable-next-line global-require
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const key = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${filenamePrefix}${safeName(name)}`;
    // Gzip before upload. The object is marked Content-Encoding: gzip, so a
    // browser opening it decompresses it automatically and sees a normal PDF.
    const body = await gzip(file.buffer);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ContentEncoding: 'gzip',
      ServerSideEncryption: 'AES256',
      // Metadata saved on the object itself (ASCII only, so the name is URL-encoded).
      Metadata: { originalname: encodeURIComponent(name), originalsize: String(size), mimetype: mimeType },
    }));
    logger.info(`[FileStorage] Stored ${key} on S3 (${size} bytes, gzip ${body.length} bytes).`);
    return { provider, url: `s3://${bucket}/${key}`, publicId: `${S3_ID_PREFIX}${key}`, name, size, mimeType };
  }

  const uploaded = await cloudinaryStorage.uploadBuffer(file.buffer, {
    folder,
    filename: `${Date.now()}-${filenamePrefix}${name}`,
  });
  return { provider, url: uploaded.secureUrl, publicId: uploaded.publicId, name, size, mimeType };
}

/** Deletes a stored file by its id. No-op when the id is empty. */
async function deleteFile(publicId) {
  if (!publicId) return;
  if (isS3Id(publicId)) {
    const { client, bucket } = getS3();
    // eslint-disable-next-line global-require
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: publicId.slice(S3_ID_PREFIX.length) }));
    return;
  }
  await cloudinaryStorage.destroyFile(publicId);
}

/**
 * Returns a link a person can open to view a stored file. Cloudinary files
 * already have one; S3 files are private, so a short-lived signed link is made.
 * @param {{url?: string, publicId?: string, name?: string}} stored
 * @returns {Promise<string|null>}
 */
async function getFileAccessUrl({ url, publicId, name }) {
  if (!isS3Id(publicId)) return url || null;

  const parsed = parseS3Url(url);
  const { client, bucket: configuredBucket } = getS3();
  const bucket = parsed?.bucket || configuredBucket;
  const key = publicId.slice(S3_ID_PREFIX.length);
  // eslint-disable-next-line global-require
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  // eslint-disable-next-line global-require
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const asciiName = safeName(name || key.split('/').pop());
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseContentType: 'application/pdf',
    ResponseContentDisposition: `inline; filename="${asciiName}"`,
  }), { expiresIn: SIGNED_URL_SECONDS });
}

module.exports = { getProvider, isS3Id, uploadFile, deleteFile, getFileAccessUrl, SIGNED_URL_SECONDS };
