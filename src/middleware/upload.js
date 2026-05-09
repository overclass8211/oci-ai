const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|mp3|wav|m4a|webm|ogg|opus|flac/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase()) ||
               (file.mimetype || '').startsWith('audio/');
    cb(null, ok);
  }
});

module.exports = upload;
