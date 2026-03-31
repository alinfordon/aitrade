import { cn } from "@/lib/utils";

export function Badge({ className, variant = "default", ...props }) {
  const v =
    variant === "outline"
      ? "border border-border text-foreground"
      : "bg-secondary text-secondary-foreground";
  return <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", v, className)} {...props} />;
}
