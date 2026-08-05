const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Uploads an in-memory file buffer (from multer's memoryStorage) to
 * Cloudinary as a 'raw' resource — used for résumés and interview
 * artifacts (pdf/docx/txt/md), none of which need image transformations.
 * @param {Buffer} buffer
 * @param {{ folder: string, filename: string }} options
 * @returns {Promise<{ secureUrl: string, publicId: string }>}
 */
function uploadBuffer(buffer, { folder, filename }) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', folder, public_id: filename, use_filename: true, unique_filename: false },
      (err, result) => {
        if (err) return reject(err);
        resolve({ secureUrl: result.secure_url, publicId: result.public_id });
      },
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

/** Deletes a previously-uploaded 'raw' resource by public_id. No-op if publicId is falsy. */
async function destroyFile(publicId) {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
}

module.exports = { cloudinary, uploadBuffer, destroyFile };
