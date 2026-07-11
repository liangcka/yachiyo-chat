import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StarfieldCanvas } from "./StarfieldCanvas";

describe("StarfieldCanvas", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("draws a deterministic non-interactive field and cancels animation on unmount", () => {
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fill: vi.fn(),
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      arc: vi.fn(),
      fillStyle: "",
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const requestAnimationFrame = vi.fn(() => 17);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const { container, unmount } = render(<StarfieldCanvas random={() => 0.5} />);

    const canvas = container.querySelector("canvas");
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveClass("starfield");
    expect(context.clearRect).toHaveBeenCalled();
    expect(context.arc).toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalled();

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
  });
});
