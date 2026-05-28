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
        <div className="flex items-center justify-center h-screen bg-surface text-text-muted text-sm">
          <div className="text-center space-y-2">
            <p className="text-lg font-semibold text-text-primary">Something went wrong</p>
            <p>{this.state.message}</p>
            <button
              className="mt-4 px-4 py-2 rounded border border-divider bg-white hover:bg-gray-100"
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
