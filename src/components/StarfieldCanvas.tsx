import { useEffect, useRef } from "react";

interface Star {
  alpha: number;
  phase: number;
  radius: number;
  speed: number;
  x: number;
  y: number;
}

export interface StarfieldCanvasProps {
  random?: () => number;
}

export function StarfieldCanvas({ random = Math.random }: StarfieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || canvas === undefined || context === null || context === undefined) {
      return;
    }

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame: number | undefined;
    let stars: Star[] = [];
    let width = 1;
    let height = 1;

    const seedStars = () => {
      const count = Math.max(72, Math.min(220, Math.round((width * height) / 2_500)));
      stars = Array.from({ length: count }, () => ({
        alpha: 0.22 + random() * 0.7,
        phase: random() * Math.PI * 2,
        radius: 0.35 + random() * 1.35,
        speed: 0.00035 + random() * 0.0009,
        x: random() * width,
        y: random() * height,
      }));
    };

    const draw = (time = 0) => {
      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        const shimmer = reducedMotion ? 0 : Math.sin(time * star.speed + star.phase) * 0.16;
        context.globalAlpha = Math.max(0.12, Math.min(1, star.alpha + shimmer));
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fillStyle = star.radius > 1.25 ? "#f6f8ff" : "#bbd5ff";
        context.fill();
      }
      context.globalAlpha = 1;
      if (!reducedMotion && !document.hidden) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width || window.innerWidth));
      height = Math.max(1, Math.round(bounds.height || window.innerHeight));
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      seedStars();
      draw();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
      } else if (!reducedMotion && animationFrame === undefined) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [random]);

  return <canvas ref={canvasRef} aria-hidden="true" className="starfield" />;
}
