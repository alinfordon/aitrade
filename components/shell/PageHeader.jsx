"use client";

import { cn } from "@/lib/utils";

export function PageHeader({ title, description, className, children }) {
  return (
    <header className={cn("relative space-y-3 pb-1", className)}>
      <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>
      {description ? (
        <p className="max-w-12xl text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>
      ) : null}
      {children}
    </header>
  );
}
