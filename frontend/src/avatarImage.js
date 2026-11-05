const AVATAR_SIZE = 200;
const JPEG_QUALITY = 0.85;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Crops the picture to a centered square and shrinks it, so phone photos of several
// megabytes become a JPEG small enough to store with the account.
export async function toAvatarImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Vui lòng chọn một tệp ảnh');
  if (file.size > MAX_FILE_BYTES) throw new Error('Ảnh quá lớn, vui lòng chọn ảnh dưới 10 MB');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Không đọc được ảnh này, hãy thử ảnh JPG hoặc PNG');
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; // JPEG has no transparency
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE
  );
  bitmap.close();

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}
