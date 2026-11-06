import { maxBackgroundLength } from '../../../domain/liquid-glass';

export async function prepareBackground(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > 12 * 1024 * 1024) throw new Error('图片超过 12MB，请选择较小的图片。');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('无法读取这张图片，请换一张有效的 JPG、PNG 或 WebP 图片。');
  }
  try {
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理图片，请更换浏览器后重试。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.72, 0.55]) {
      const image = canvas.toDataURL('image/jpeg', quality);
      if (image.length <= maxBackgroundLength && image.startsWith('data:image/jpeg;base64,'))
        return image;
    }
    throw new Error('图片压缩后仍然过大，请选择尺寸更小的图片。');
  } finally {
    bitmap.close();
  }
}
