import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
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
  it("uses a real localized button to open an environment camera input", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CaptureButton copy={copyFor("ja-JP")} onError={vi.fn()} onImage={vi.fn()} />,
    );

    const button = screen.getByRole("button", { name: "撮影" });
    expect(button).toBeEnabled();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveAttribute("tabindex", "-1");

    const openFilePicker = vi.spyOn(input!, "click").mockImplementation(() => undefined);
    await user.click(button);
    expect(openFilePicker).toHaveBeenCalledOnce();
  });

  it("processes one selected image and resets the input for same-file reselection", async () => {
    const user = userEvent.setup();
    const onImage = vi.fn();
    const process = vi.fn(async () => processed);
    const { container } = render(
      <CaptureButton
        copy={copyFor("zh-CN")}
        onError={vi.fn()}
        onImage={onImage}
        process={process}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
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
    const { container } = render(
      <CaptureButton
        copy={copyFor("zh-CN")}
        onError={onError}
        onImage={vi.fn()}
        process={process}
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    fireEvent.change(input, {
      target: { files: [new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })] },
    });
    const processingButton = screen.getByRole("button", { name: "正在处理图片…" });
    expect(processingButton).toBeDisabled();
    expect(processingButton).toHaveAttribute("aria-busy", "true");

    rejectProcessing?.(new ImageProcessingError("IMAGE_TOO_LARGE"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("IMAGE_TOO_LARGE"));
    const readyButton = screen.getByRole("button", { name: "拍摄" });
    expect(readyButton).toBeEnabled();
    expect(readyButton).toHaveAttribute("aria-busy", "false");
  });

  it("completes delayed processing when mounted in StrictMode", async () => {
    let resolveProcessing: ((image: ProcessedImage) => void) | undefined;
    const process = vi.fn(
      () =>
        new Promise<ProcessedImage>((resolve) => {
          resolveProcessing = resolve;
        }),
    );
    const onImage = vi.fn();
    const { container } = render(
      <StrictMode>
        <CaptureButton
          copy={copyFor("zh-CN")}
          onError={vi.fn()}
          onImage={onImage}
          process={process}
        />
      </StrictMode>,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    fireEvent.change(input, {
      target: { files: [new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })] },
    });
    resolveProcessing?.(processed);

    await waitFor(() => expect(onImage).toHaveBeenCalledWith(processed));
    expect(screen.getByRole("button", { name: "拍摄" })).toBeEnabled();
  });

  it("respects an externally disabled state", () => {
    const { container } = render(
      <CaptureButton
        copy={copyFor("zh-CN")}
        disabled
        onError={vi.fn()}
        onImage={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "拍摄" })).toBeDisabled();
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')).toBeDisabled();
  });
});
