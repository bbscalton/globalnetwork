import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from '@desk/lib/authContext'
import './index.css'

class BootError extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(err: unknown) {
    return { err: err instanceof Error ? err.message : 'POS failed to open' }
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error('POS crashed', err, info.componentStack)
  }
  render() {
    if (this.state.err) {
      return (
        <div className="gate">
          <div className="panel">
            <h1>Field POS</h1>
            <p className="muted">The cashier app hit a runtime error.</p>
            <p className="fail">{this.state.err}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BootError>
        <AuthProvider>
          <HashRouter>
            <App />
          </HashRouter>
        </AuthProvider>
      </BootError>
    </StrictMode>,
  )
}
