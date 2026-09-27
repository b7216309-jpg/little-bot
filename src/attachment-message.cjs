'use strict';

// Persist references, not file bytes, thumbnails or private storage paths.
function attachmentDescriptors(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).filter(item => item && typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.id)
    && typeof item.name === 'string' && item.name.length <= 240 && ['image', 'file'].includes(item.kind))
    .map(item => ({ id: item.id, name: item.name, kind: item.kind,
      mime: typeof item.mime === 'string' ? item.mime.slice(0, 100) : 'application/octet-stream',
      size: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : 0,
      ...(Number.isSafeInteger(item.width) && item.width > 0 ? { width: item.width } : {}),
      ...(Number.isSafeInteger(item.height) && item.height > 0 ? { height: item.height } : {}),
    }));
}
module.exports = { attachmentDescriptors };
