import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Надзаголовок: дата, раздел, контекст. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** Правый слот: счётчик, кнопка. */
  action?: React.ReactNode;
  className?: string;
}

/** «Стеклянная» шапка экрана: липнет к верху и пропускает контент под собой. */
export function PageHeader({ eyebrow, title, action, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 -mx-4 -mt-4 mb-4 flex items-center justify-between gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-xl md:-mx-8 md:-mt-7 md:px-8",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          {eyebrow ? <p className="text-xs text-muted-foreground">{eyebrow}</p> : null}
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
