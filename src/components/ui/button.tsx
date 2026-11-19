import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "secondary" | "ghost" | "danger";
  size?: "default" | "sm" | "lg" | "icon";
}

/**
 * Кнопка под палец: минимум 44px по высоте у основных размеров,
 * «пружина» при нажатии и без задержки тапа на телефоне.
 */
export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex touch-manipulation select-none items-center justify-center gap-1.5 rounded-xl font-medium transition-[transform,color,background-color,border-color,opacity] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "outline" && "border border-input bg-card hover:bg-secondary",
        variant === "secondary" && "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        variant === "ghost" && "text-muted-foreground hover:bg-secondary hover:text-foreground",
        variant === "danger" && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        size === "default" && "h-11 px-4 text-sm",
        size === "sm" && "h-9 px-3 text-xs",
        size === "lg" && "h-12 px-5 text-base",
        size === "icon" && "size-11",
        className,
      )}
      {...props}
    />
  );
}
