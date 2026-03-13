import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary wrapping the Workspace.
 * Shows a crash screen with restart option on unrecoverable errors.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("LOOM ErrorBoundary caught:", error, info);
  }

  handleRestart = () => {
    // Reset error state, which re-renders children
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <CrashScreen error={this.state.error} onRestart={this.handleRestart} />;
    }
    return this.props.children;
  }
}

function CrashScreen({
  error,
  onRestart,
}: {
  error: Error | null;
  onRestart: () => void;
}) {
  return (
    <div
      className="flex items-center justify-center h-full w-full"
      style={{ backgroundColor: "var(--color-bg-base)" }}
    >
      <div className="flex flex-col items-center gap-5 max-w-md text-center px-6">
        <h1
          style={{
            fontSize: "18px",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            fontSize: "13px",
            color: "var(--color-text-secondary)",
            lineHeight: "1.6",
          }}
        >
          LOOM encountered an unexpected error. Your data is safe — it's stored
          in your encrypted database.
        </p>
        {error && (
          <pre
            className="w-full overflow-auto text-left"
            style={{
              fontSize: "11px",
              color: "var(--color-error)",
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "12px",
              maxHeight: "120px",
              fontFamily: "var(--font-mono)",
            }}
          >
            {error.message}
          </pre>
        )}
        <button
          onClick={onRestart}
          style={{
            backgroundColor: "var(--color-accent)",
            color: "var(--color-text-on-accent)",
            border: "none",
            borderRadius: "6px",
            padding: "10px 24px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
          }}
        >
          Restart
        </button>
      </div>
    </div>
  );
}
