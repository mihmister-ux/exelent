import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Последний рубеж вокруг экранов: ошибка в рендере не должна оставлять
 * кладовщика с белым экраном и без объяснений.
 *
 * Границы ошибок в React работают только классами. Ловим ровно то, что
 * ловится — сбой рендера и жизненного цикла; асинхронные отказы (запись
 * в базу, чтение файла) приходят сюда через `unhandledrejection` в main.tsx.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Без этого в консоли не осталось бы следа: экран уже заменён заглушкой.
    console.error("[shelf] экран не отрисовался:", error, info.componentStack);
  }

  private handleReload = () => {
    // Данные лежат в IndexedDB и перезагрузку переживают — терять нечего.
    window.location.reload();
  };

  private handleHome = () => {
    window.location.hash = "#/";
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="w-full max-w-sm space-y-3 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-lg bg-destructive text-destructive-foreground">
            <TriangleAlert className="size-5" />
          </div>
          <p className="text-lg font-semibold">Экран не открылся</p>
          <p className="text-sm text-muted-foreground">
            Журнал сохранён на этом устройстве и никуда не делся. Попробуйте вернуться к «Срокам»
            или перезагрузить приложение.
          </p>
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-left font-mono text-[11px] break-words text-muted-foreground">
            {error.message || String(error)}
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={this.handleHome}>
              К срокам
            </Button>
            <Button variant="outline" className="flex-1" onClick={this.handleReload}>
              Перезагрузить
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
