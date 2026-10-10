// ════════════════════════════════════════════════════════════
//  ERROR BOUNDARY — A safety net. If something inside throws, we
//  show a small recoverable message instead of a blank screen, and
//  the rest of the app (like the tab bar) keeps working.
//
//  (Error boundaries must be class components — this is the one
//  place in the app that uses a class.)
// ════════════════════════════════════════════════════════════

import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Helpful for debugging in the browser console.
    console.error("Screen error:", error, info);
  }

  // Reset when navigating to a different screen.
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center p-6 bg-white">
          <div className="text-center max-w-xs">
            <p className="font-bold text-lg mb-1">Something went wrong</p>
            <p className="text-neutral-500 text-sm mb-4 break-words">{String(this.state.error?.message || this.state.error)}</p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="px-5 py-2.5 rounded-full text-sm font-semibold bg-black text-white"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
