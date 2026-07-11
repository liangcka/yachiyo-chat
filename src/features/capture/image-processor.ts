import type { StoredImageMimeType } from "../../domain/chat";

export type ImageProcessingErrorCode =
  | "IMAGE_INVALID"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_DECODE_FAILED";

export class ImageProcessingError extends Error {
  constructor(readonly code: ImageProcessingErrorCode) {
    super(code);
    this.name = "ImageProcessingError";
  }
}

export interface ProcessedImage {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  mimeType: StoredImageMimeType;
}

export interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
}

export interface ImageProcessorRuntime {
  decode(file: File): Promise<DecodedImage>;
  encode(
    source: CanvasImageSource,
    width: number,
    height: number,
    mimeType: StoredImageMimeType,
    quality: number,
  ): Promise<Blob | null>;
  toDataUrl(blob: Blob): Promise<string>;
}

const allowedTypes = new Set<StoredImageMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maximumSourceBytes = 15 * 1024 * 1024;
const maximumOutputBytes = 2 * 1024 * 1024;
const maximumLongEdge = 1600;
const qualities = [0.82, 0.74, 0.66, 0.58, 0.5] as const;
const maximumDimensionPasses = 12;

function isAllowedMime(value: string): value is StoredImageMimeType {
  return allowedTypes.has(value as StoredImageMimeType);
}

export function calculateTargetSize(
  sourceWidth: number,
  sourceHeight: number,
  maximumEdge = maximumLongEdge,
): { width: number; height: number } {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(maximumEdge) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    maximumEdge <= 0
  ) {
    throw new ImageProcessingError("IMAGE_DECODE_FAILED");
  }
  const scale = Math.min(1, maximumEdge / Math.max(sourceWidth, sourceHeight));
  return {
    height: Math.max(1, Math.round(sourceHeight * scale)),
    width: Math.max(1, Math.round(sourceWidth * scale)),
  };
}

async function decodeInBrowser(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        dispose: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width,
      };
    } catch {
      // Some Safari releases reject imageOrientation and need the element fallback.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new TypeError("Image decode failed.")), {
        once: true,
      });
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return {
    dispose: () => {
      image.src = "";
    },
    height: image.naturalHeight,
    source: image,
    width: image.naturalWidth,
  };
}

function encodeInBrowser(
  source: CanvasImageSource,
  width: number,
  height: number,
  mimeType: StoredImageMimeType,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: mimeType !== "image/jpeg" });
  if (context === null) return Promise.resolve(null);
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

function dataUrlInBrowser(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new TypeError("Image encoding failed."));
    });
    reader.addEventListener("error", () => reject(new TypeError("Image encoding failed.")));
    reader.readAsDataURL(blob);
  });
}

const browserRuntime: ImageProcessorRuntime = {
  decode: decodeInBrowser,
  encode: encodeInBrowser,
  toDataUrl: dataUrlInBrowser,
};

function outputMime(blob: Blob, requested: StoredImageMimeType): StoredImageMimeType {
  return isAllowedMime(blob.type) ? blob.type : requested;
}

export async function processImage(
  file: File,
  runtime: ImageProcessorRuntime = browserRuntime,
): Promise<ProcessedImage> {
  if (!isAllowedMime(file.type) || file.size === 0) {
    throw new ImageProcessingError("IMAGE_INVALID");
  }
  if (file.size > maximumSourceBytes) {
    throw new ImageProcessingError("IMAGE_TOO_LARGE");
  }

  let decoded: DecodedImage;
  try {
    decoded = await runtime.decode(file);
  } catch {
    throw new ImageProcessingError("IMAGE_DECODE_FAILED");
  }

  try {
    let { width, height } = calculateTargetSize(decoded.width, decoded.height);
    const requestedMime: StoredImageMimeType =
      file.type === "image/jpeg" ? "image/jpeg" : "image/webp";

    for (let dimensionPass = 0; dimensionPass < maximumDimensionPasses; dimensionPass += 1) {
      for (const quality of qualities) {
        const blob = await runtime.encode(
          decoded.source,
          width,
          height,
          requestedMime,
          quality,
        );
        if (blob === null) throw new ImageProcessingError("IMAGE_DECODE_FAILED");
        if (blob.size <= maximumOutputBytes) {
          return {
            blob,
            dataUrl: await runtime.toDataUrl(blob),
            height,
            mimeType: outputMime(blob, requestedMime),
            width,
          };
        }
      }

      const nextWidth = Math.max(1, Math.round(width * 0.85));
      const nextHeight = Math.max(1, Math.round(height * 0.85));
      if (nextWidth === width && nextHeight === height) break;
      width = nextWidth;
      height = nextHeight;
    }
    throw new ImageProcessingError("IMAGE_TOO_LARGE");
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError("IMAGE_DECODE_FAILED");
  } finally {
    decoded.dispose();
  }
}
