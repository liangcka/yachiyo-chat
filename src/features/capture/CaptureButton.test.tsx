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
  it("opens a menu to select camera or album and triggers respective inputs", async () => {
    const user = userEvent.setup();
    render(
      <CaptureButton copy={copyFor("ja-JP")} onError={vi.fn()} onImage={vi.fn()} />,
    );

    const button = screen.getByRole("button", { name: "撮影" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const cameraInput = screen.getByTestId("capture-camera-input") as HTMLInputElement;
    const albumInput = screen.getByTestId("capture-album-input") as HTMLInputElement;

    expect(cameraInput).toHaveAttribute("type", "file");
    expect(cameraInput).toHaveAttribute("accept", "image/*");
    expect(cameraInput).toHaveAttribute("capture", "environment");
    expect(cameraInput).toHaveAttribute("aria-hidden", "true");
    expect(cameraInput).toHaveAttribute("tabindex", "-1");

    expect(albumInput).toHaveAttribute("type", "file");
    expect(albumInput).toHaveAttribute("accept", "image/*");
    expect(albumInput).not.toHaveAttribute("capture");
    expect(albumInput).toHaveAttribute("aria-hidden", "true");
    expect(albumInput).toHaveAttribute("tabindex", "-1");

    const cameraClick = vi.spyOn(cameraInput, "click").mockImplementation(() => undefined);
    const albumClick = vi.spyOn(albumInput, "click").mockImplementation(() => undefined);

    // 打开菜单
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "撮影" });
    expect(menu).toBeInTheDocument();

    const cameraOption = screen.getByRole("menuitem", { name: "カメラ" });
    const albumOption = screen.getByRole("menuitem", { name: "アルバム" });
    expect(cameraOption).toBeInTheDocument();
    expect(albumOption).toBeInTheDocument();

    // 点击相机选项触发相机 input
    await user.click(cameraOption);
    expect(cameraClick).toHaveBeenCalledOnce();
    expect(albumClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // 重新打开并点击相册选项触发相册 input
    await user.click(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "アルバム" }));
    expect(albumClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu on outside click or escape key", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">外部区域</button>
        <CaptureButton copy={copyFor("zh-CN")} onError={vi.fn()} onImage={vi.fn()} />
      </div>,
    );

    const button = screen.getByRole("button", { name: "拍摄" });

    // 打开后按 Escape 键关闭
    await user.click(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // 打开后点击外部区域关闭
    await user.click(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "外部区域" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
