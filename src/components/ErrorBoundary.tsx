import { Component, type ReactNode } from 'react'

interface State { hasError: boolean; message: string }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-neutral-900 text-white/60 text-sm">
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-white/80">Something went wrong</p>
            <p>{this.state.message}</p>
            <button
              className="mt-4 px-4 py-2 rounded bg-white/10 hover:bg-white/20"
              onClick={() => this.setState({ hasError: false, message: '' })}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
