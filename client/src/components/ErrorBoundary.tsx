import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background p-4 text-center">
        <svg width="40" height="40" viewBox="0 0 32 32" fill="none" aria-label="Macro logo">
          <rect width="32" height="32" rx="8" fill="hsl(var(--primary))" opacity="0.12" />
          <path
            d="M5 22V11l5.5 7.5L16 11l5.5 7.5L27 11v11"
            stroke="hsl(var(--primary))"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            An unexpected error occurred. Refresh the page to continue.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Refresh page
        </button>
      </div>
    );
  }
}
