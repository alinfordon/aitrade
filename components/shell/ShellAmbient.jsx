"use client";

import { cn } from "@/lib/utils";

/**
 * Fundal grid + glow — dashboard / shell.
 * @param {{ className?: string, fixed?: boolean }} props
 * - fixed: acoperă tot viewport-ul (landing, login); altfel „layer” în container relativ.
 */
export function ShellAmbient({ className, fixed = false }) {
  return (
    <div
      className={cn(
        "pointer-events-none -z-10 overflow-hidden",
        fixed ? "fixed inset-0 min-h-screen rounded-none" : "absolute inset-0 rounded-3xl",
        className
      )}
      aria-hidden
    >
      <div className="absolute -left-1/4 top-0 h-[min(55vh,480px)] w-[min(70vw,720px)] rounded-full bg-primary/[0.12] blur-[100px]" />
      <div className="absolute -right-1/4 bottom-0 h-[min(45vh,400px)] w-[min(65vw,600px)] rounded-full bg-accent/[0.10] blur-[90px]" />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `linear-gradient(hsl(217 19% 22% / 0.22) 1px, transparent 1px),
            linear-gradient(90deg, hsl(217 19% 22% / 0.22) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 0%, black 20%, transparent 70%)",
        }}
      />
    </div>
  );
}
