import { JPEG_QUALITY, MAX_DIMENSION, MAX_SOURCE_BYTES, fitWithin } from "./constants";

// Browser only. Shrinks a picked photo to a JPEG no bigger than MAX_DIMENSION on its longer
// side, so a phone photo of several MB becomes a few hundred KB and storage lasts.
export async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't a picture.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That picture is too large.");

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser can't process pictures.");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("We couldn't process that picture.");
    return blob;
  } finally {
    bitmap.close();
  }
}
