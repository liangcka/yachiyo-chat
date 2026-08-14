import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StarfieldCanvas } from "./StarfieldCanvas";

// 读取 mock context 的 arc 调用坐标列表（arc 签名为 x, y, radius, startAngle, endAngle）
type ArcCalls = Array<[number, number, number, number, number]>;
function arcCallsOf(context: CanvasRenderingContext2D): ArcCalls {
  return (context.arc as unknown as { mock: { calls: ArcCalls } }).mock.calls;
}

describe("StarfieldCanvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  // 构造统一的 canvas mock 环境，返回 context 与 RAF 回调句柄
  function setupCanvas(options: {
    width?: number;
    height?: number;
    reducedMotion?: boolean;
  } = {}) {
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
    const width = options.width ?? 400;
    const height = options.height ?? 800;
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    let motionChangeListener: ((event: MediaQueryListEvent) => void) | undefined;
    const motionQuery = {
      matches: options.reducedMotion ?? false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === "change") motionChangeListener = listener;
      }),
      removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === "change" && motionChangeListener === listener) motionChangeListener = undefined;
      }),
      dispatchEvent: vi.fn(() => false),
    };
    const matchMedia = vi.fn().mockReturnValue(motionQuery);
    vi.stubGlobal("matchMedia", matchMedia);

    let rafCallback: ((time: number) => void) | null = null;
    const requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 17;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    return {
      context,
      width,
      height,
      getRafCallback: () => rafCallback,
      requestAnimationFrame,
      cancelAnimationFrame,
      motionQuery,
      setReducedMotion: (matches: boolean) => {
        motionQuery.matches = matches;
        motionChangeListener?.({ matches } as MediaQueryListEvent);
      },
    };
  }

  it("moves stars across animation frames (flow)", () => {
    const { context, getRafCallback } = setupCanvas();

    render(<StarfieldCanvas random={() => 0.5} />);

    // 第一帧已在 resize 中绘制完成
    const calls = arcCallsOf(context);
    const firstFrameCount = calls.length;
    expect(firstFrameCount).toBeGreaterThan(0);
    const firstX = calls[0][0];

    // 手动推进一帧（requestAnimationFrame 被 mock，需手动触发回调）
    const cb = getRafCallback();
    expect(cb).not.toBeNull();
    cb!(16);

    // 第二帧起始 arc 调用的 x 坐标应不同于第一帧，验证流动生效
    const secondX = calls[firstFrameCount][0];
    expect(secondX).not.toBe(firstX);
  });

  it("replaces the scheduled animation frame when the canvas resizes", async () => {
    vi.useFakeTimers();
    try {
      const { cancelAnimationFrame, requestAnimationFrame } = setupCanvas();

      render(<StarfieldCanvas random={() => 0.5} />);
      window.dispatchEvent(new Event("resize"));
      // resize 已防抖：推进防抖窗口后触发重建
      await vi.advanceTimersByTimeAsync(100);

      expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
      expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stars static under prefers-reduced-motion", () => {
    const { context, requestAnimationFrame } = setupCanvas({ reducedMotion: true });

    render(<StarfieldCanvas random={() => 0.5} />);

    // reduced-motion：不进入 RAF 循环
    expect(requestAnimationFrame).not.toHaveBeenCalled();

    // 位置不更新：坐标即初始 random*width / random*height = 0.5 * 400 / 0.5 * 800
    const calls = arcCallsOf(context);
    expect(calls[0][0]).toBe(200); // x = 0.5 * 400
    expect(calls[0][1]).toBe(400); // y = 0.5 * 800
  });

  it("responds when the reduced-motion preference changes at runtime", () => {
    const {
      cancelAnimationFrame,
      motionQuery,
      requestAnimationFrame,
      setReducedMotion,
    } = setupCanvas();
    const { unmount } = render(<StarfieldCanvas random={() => 0.5} />);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    setReducedMotion(true);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    setReducedMotion(false);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

    unmount();
    expect(motionQuery.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("wraps stars back within canvas bounds after crossing edges", () => {
    const { context, getRafCallback } = setupCanvas({ width: 10, height: 10 });

    render(<StarfieldCanvas random={() => 0.99} />);

    // 推进多帧，让星星越界并触发回绕
    const cb = getRafCallback();
    expect(cb).not.toBeNull();
    for (let i = 0; i < 20; i++) {
      cb!(i * 16);
    }

    // 所有绘制坐标必须落在画布范围内 [0, width] / [0, height]
    const calls = arcCallsOf(context);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const x = call[0];
      const y = call[1];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(10);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(10);
    }
  });
});
