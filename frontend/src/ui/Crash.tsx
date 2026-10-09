import { Component, type ReactNode } from 'react'
import { isOnline } from '../offline/net'

/** If a screen fails to load or crashes, say what happened instead of leaving a blank window. Offline, the usual cause is a part of the app that wasn't saved on this device yet. */
export class Crash extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { console.error(err) }
  render() {
    const e = this.state.err
    if (!e) return this.props.children
    const file = /(\/assets\/[\w.-]+)/.exec(String(e.message))?.[1]
    return (
      <div className="auth-wrap"><div className="auth-card" style={{ textAlign: 'center' }}>
        <h2>{isOnline() ? 'Something went wrong' : 'This isn’t saved on this device yet'}</h2>
        <p className="muted">{isOnline() ? 'Reloading usually fixes it.' : 'Connect once and open this page so it can be saved, then it will work offline.'}</p>
        <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>{file ?? e.message}</p>
        <button className="btn btn-primary btn-pill" onClick={() => location.reload()}>Reload</button>
      </div></div>
    )
  }
}
