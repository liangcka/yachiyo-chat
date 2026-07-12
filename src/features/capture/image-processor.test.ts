import { describe, expect, it, vi } from "vitest";
import {
  ImageProcessingError,
  calculateTargetSize,
  processImage,
  type DecodedImage,
  type ImageProcessorRuntime,
} from "./image-processor";

function runtimeWith(
  encode: ImageProcessorRuntime["encode"] = vi.fn(async (_source, _width, _height, mime) =>
    new Blob([new Uint8Array(1_024)], { type: mime }),
  ),
): ImageProcessorRuntime {
  const decoded: DecodedImage = {
    dispose: vi.fn(),
    height: 3000,
    source: {} as CanvasImageSource,
    width: 4000,
  };
  return {
    decode: vi.fn(async () => decoded),
    encode,
    toDataUrl: vi.fn(async (blob) => `data:${blob.type};base64,c2FmZQ==`),
  };
}

describe("calculateTargetSize", () => {
  it("keeps aspect ratio within a 1600px long edge", () => {
    expect(calculateTargetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(calculateTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(calculateTargetSize(600, 1200, 1600)).toEqual({ width: 600, height: 1200 });
  });

  it("rejects invalid source geometry", () => {
    expect(() => calculateTargetSize(0, 100, 1600)).toThrow(ImageProcessingError);
    expect(() => calculateTargetSize(Number.NaN, 100, 1600)).toThrow(ImageProcessingError);
  });
});

describe("processImage", () => {
  it("rejects unsupported media and source files over 15 MiB before decoding", async () => {
    const runtime = runtimeWith();
    await expect(
      processImage(new File(["text"], "note.txt", { type: "text/plain" }), runtime),
    ).rejects.toMatchObject({ code: "IMAGE_INVALID" });
    await expect(
      processImage(
        new File([new Uint8Array(15 * 1024 * 1024 + 1)], "huge.jpg", {
          type: "image/jpeg",
        }),
        runtime,
      ),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    expect(runtime.decode).not.toHaveBeenCalled();
  });

  it("resizes and returns an encoded image with its data URL", async () => {
    const runtime = runtimeWith();

    await expect(
      processImage(new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }), runtime),
    ).resolves.toMatchObject({
      dataUrl: "data:image/jpeg;base64,c2FmZQ==",
      height: 1200,
      mimeType: "image/jpeg",
      width: 1600,
    });
    expect(runtime.encode).toHaveBeenCalledWith(
      expect.anything(),
      1600,
      1200,
      "image/jpeg",
      0.82,
    );
  });

  it("lowers quality before reducing dimensions and never returns over 2 MiB", async () => {
    const encode = vi.fn<ImageProcessorRuntime["encode"]>(
      async (_source, width, _height, mime, quality) => {
        const acceptable = width < 1500 && quality <= 0.66;
        return new Blob([new Uint8Array(acceptable ? 2_000 : 2 * 1024 * 1024 + 1)], {
          type: mime,
        });
      },
    );
    const runtime = runtimeWith(encode);

    const result = await processImage(
      new File(["png"], "transparent.png", { type: "image/png" }),
      runtime,
    );

    expect(result.blob.size).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(result.mimeType).toBe("image/webp");
    expect(result.width).toBe(1360);
    expect(encode.mock.calls.map(([, width, , , quality]) => [width, quality])).toEqual(
      expect.arrayContaining([
        [1600, 0.82],
        [1600, 0.5],
        [1360, 0.82],
        [1360, 0.66],
      ]),
    );
  });

  it("disposes decoded resources when encoding fails", async () => {
    const runtime = runtimeWith(vi.fn(async () => null));

    await expect(
      processImage(new File(["jpeg"], "photo.jpg", { type: "image/jpeg" }), runtime),
    ).rejects.toMatchObject({ code: "IMAGE_DECODE_FAILED" });
    const decoded = await vi.mocked(runtime.decode).mock.results[0]?.value;
    expect(decoded?.dispose).toHaveBeenCalledOnce();
  });

  it("rejects unsafe decoded dimensions before allocating an encoding canvas", async () => {
    const runtime = runtimeWith();
    const dispose = vi.fn();
    runtime.decode = vi.fn(async () => ({
      dispose,
      height: 10_000,
      source: {} as CanvasImageSource,
      width: 10_000,
    }));

    await expect(
      processImage(new File(["jpeg"], "huge-pixels.jpg", { type: "image/jpeg" }), runtime),
    ).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });

    expect(runtime.encode).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
