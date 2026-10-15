import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Unhandled UI error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boundary">
          <h2>Something went wrong</h2>
          <p>{this.state.error.message}</p>
          <button className="btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
