import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { copyFor } from "../../i18n/messages";
import { CaptureButton } from "./CaptureButton";
import { ImageProcessingError, type ProcessedImage } from "./image-processor";

const processed: ProcessedImage = {
  blob: new Blob(["safe"], { type: "image/jpeg" }),
  dataUrl: "data:image/jpeg;base64,c2FmZQ==",
  height: 240,
  mimeType: "image/jpeg",
  width: 320,
};

describe("CaptureButton", () => {
  it("uses a real localized button and an environment camera input", () => {
    render(
      <CaptureButton copy={copyFor("ja-JP")} onError={vi.fn()} onImage={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "撮影" })).toBeEnabled();
    const input = screen.getByLabelText("撮影");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
  });

  it("processes one selected image and resets the input for same-file reselection", async () => {
    const user = userEvent.setup();
    const onImage = vi.fn();
    const process = vi.fn(async () => processed);
    render(
      <CaptureButton
        copy={copyFor("zh-CN")}
        onError={vi.fn()}
        onImage={onImage}
        process={process}
      />,
    );
    const input = screen.getByLabelText("拍摄") as HTMLInputElement;
    const file = new File(["jpeg"], "photo.jpg", { type: "image/jpeg" });

    await user.upload(input, file);

    await waitFor(() => expect(onImage).toHaveBeenCalledWith(processed));
    expect(process).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });

  it("disables controls while processing and announces a stable failure code", async () => {
    let rejectProcessing: ((reason: unknown) => void) | undefined;
    const process = vi.fn(
      () =>
        new Promise<ProcessedImage>((_resolve, reject) => {
          rejectProcessing = reject;
        }),
    );
    const onError = vi.fn();
    render(
      <CaptureButton
        copy={copyFor("zh-CN")}
        onError={onError}
        onImage={vi.fn()}
        process={process}
      />,
    );
    const input = screen.getByLabelText("拍摄") as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })] },
    });
    expect(screen.getByRole("button", { name: "正在处理图片…" })).toBeDisabled();

    rejectProcessing?.(new ImageProcessingError("IMAGE_TOO_LARGE"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("IMAGE_TOO_LARGE"));
    expect(screen.getByRole("button", { name: "拍摄" })).toBeEnabled();
  });

  it("respects an externally disabled state", () => {
    render(
      <CaptureButton
        copy={copyFor("zh-CN")}
        disabled
        onError={vi.fn()}
        onImage={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "拍摄" })).toBeDisabled();
    expect(screen.getByLabelText("拍摄")).toBeDisabled();
  });
});
