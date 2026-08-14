import { useEffect, useRef } from "react";

interface Star {
  alpha: number;
  phase: number;
  radius: number;
  speed: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
}

export interface StarfieldCanvasProps {
  random?: () => number;
}

// 参考帧时长（60fps），用于把速度从「每帧」归一化为「每 16.7ms」
const FRAME_MS = 16.667;
// 单帧最大步长钳制：长时间不可见后恢复时，最多推进 3 帧，避免画面「跳帧飞跃」
const MAX_FRAME_STEPS = 3;
// resize 防抖窗口
const RESIZE_DEBOUNCE_MS = 100;

export function StarfieldCanvas({ random = Math.random }: StarfieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || canvas === undefined || context === null || context === undefined) {
      return;
    }

    const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = motionPreference.matches;
    // 整体流向常量：缓慢向右下漂移，营造"星河"感（量级 0.02~0.05 px/frame）
    const driftX = 0.035;
    const driftY = 0.025;
    // 单星基础速度量级，配合深度因子后整体速度约 0.02~0.15 px/frame
    const baseSpeed = 0.08;
    let animationFrame: number | undefined;
    let stars: Star[] = [];
    let width = 1;
    let height = 1;
    // 本地累计时间：闪烁相位基于 elapsed 推进，避免全局时间戳在暂停/恢复后跳变
    let elapsed = 0;
    // 上一帧时间戳（rAF 全局时间），用于计算 deltaTime
    let lastTime = 0;
    let resizeTimer: number | undefined;

    const seedStars = () => {
      const count = Math.max(72, Math.min(220, Math.round((width * height) / 2_500)));
      stars = Array.from({ length: count }, () => {
        // 深度：0=远景，1=近景
        const z = random();
        // 深度因子：近景快、远景慢
        const depthFactor = 0.3 + z * 0.9;
        // 单星速度分量（向右下为正，叠加随机变化）
        const perStarVx = baseSpeed * (0.5 + random() * 0.5);
        const perStarVy = baseSpeed * (0.4 + random() * 0.6);
        return {
          // 亮度随深度提升：近景更亮
          alpha: 0.18 + random() * 0.5 + z * 0.22,
          phase: random() * Math.PI * 2,
          radius: 0.35 + random() * 1.35,
          speed: 0.00035 + random() * 0.0009,
          x: random() * width,
          y: random() * height,
          z,
          vx: driftX + perStarVx * depthFactor,
          vy: driftY + perStarVy * depthFactor,
        };
      });
    };

    const draw = (time: number) => {
      // deltaTime 归一化：速度与帧率无关；首帧按 1 帧推进，长暂停后按 MAX_FRAME_STEPS 钳制
      const rawSteps = lastTime === 0 ? 1 : (time - lastTime) / FRAME_MS;
      lastTime = time;
      const steps = reducedMotion ? 0 : Math.min(Math.max(rawSteps, 0), MAX_FRAME_STEPS);
      if (steps > 0) elapsed += steps;

      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        // reduced-motion 时跳过位置更新，保持静态
        if (steps > 0) {
          star.x += star.vx * steps;
          star.y += star.vy * steps;
          // 边界回绕：从对侧重入画布，保持密度恒定
          if (star.x < 0) star.x += width;
          else if (star.x > width) star.x -= width;
          if (star.y < 0) star.y += height;
          else if (star.y > height) star.y -= height;
        }
        // alpha 闪烁叠加（reduced-motion 时不应用）
        const shimmer = reducedMotion ? 0 : Math.sin(elapsed * star.speed + star.phase) * 0.16;
        context.globalAlpha = Math.max(0.12, Math.min(1, star.alpha + shimmer));
        // 绘制半径随深度放大：近景更大
        const drawRadius = star.radius * (0.6 + star.z * 0.7);
        context.beginPath();
        context.arc(star.x, star.y, drawRadius, 0, Math.PI * 2);
        context.fillStyle = star.radius > 1.25 ? "#f6f8ff" : "#bbd5ff";
        context.fill();
      }
      context.globalAlpha = 1;
      if (!reducedMotion && !document.hidden) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const resize = () => {
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
      }
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(bounds.width || window.innerWidth));
      const nextHeight = Math.max(1, Math.round(bounds.height || window.innerHeight));
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(nextWidth * ratio);
      canvas.height = Math.round(nextHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (stars.length === 0) {
        // 首次布局：直接播种
        width = nextWidth;
        height = nextHeight;
        seedStars();
      } else {
        // 已有星星：按比例重映射位置（不重新随机），避免窗口拉伸时画面跳变
        const scaleX = nextWidth / width;
        const scaleY = nextHeight / height;
        width = nextWidth;
        height = nextHeight;
        for (const star of stars) {
          star.x = (star.x * scaleX) % width;
          star.y = (star.y * scaleY) % height;
          if (star.x < 0) star.x += width;
          if (star.y < 0) star.y += height;
        }
      }
      draw(0);
    };

    // resize 防抖：窗口拉伸时高频触发，合并为一次重建
    const scheduleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = undefined;
        resize();
      }, RESIZE_DEBOUNCE_MS);
    };

    const pause = () => {
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
      }
    };

    const resume = () => {
      if (!reducedMotion && !document.hidden && animationFrame === undefined) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const handleVisibility = () => {
      if (document.hidden) pause();
      else resume();
    };

    const handleMotionPreference = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        pause();
        draw(0);
      } else {
        resume();
      }
    };

    resize();
    window.addEventListener("resize", scheduleResize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    motionPreference.addEventListener("change", handleMotionPreference);
    return () => {
      pause();
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", scheduleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      motionPreference.removeEventListener("change", handleMotionPreference);
    };
  }, [random]);

  return <canvas ref={canvasRef} aria-hidden="true" className="starfield" />;
}
