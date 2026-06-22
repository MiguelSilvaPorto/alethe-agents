import { Component, type ErrorInfo, type ReactNode } from 'react'

import { getLocale, type MessageKey, translate } from '../../lib/i18n'
import { recordFrontendError } from '../../lib/tauri'
import styles from './ErrorBoundary.module.css'

type Props = {
  children: ReactNode
  /** Rótulo opcional pro log (ex.: "view", "modals"). */
  label?: string
}

type State = {
  error: Error | null
}

/**
 * Boundary de render. Sem isso, um throw em qualquer view/modal derruba o app
 * inteiro (tela branca). Aqui o erro vira um fallback temático local + log
 * persistido (via `record_frontend_error`), sem matar o resto da árvore.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const kind = this.props.label ? `react:${this.props.label}` : 'react'
    void recordFrontendError(
      error.message || String(error),
      error.stack ?? info.componentStack ?? null,
      kind,
    )
  }

  private reset = () => this.setState({ error: null })
  private reload = () => window.location.reload()

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    // Class component não usa o hook useT — translate() puro lê o locale do store.
    const locale = getLocale()
    const tr = (key: MessageKey) => translate(locale, key)

    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.card}>
          <h2 className={styles.title}>{tr('errorBoundary.title')}</h2>
          <p className={styles.body}>{tr('errorBoundary.body')}</p>
          {error.message ? <pre className={styles.detail}>{error.message}</pre> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={this.reset}>
              {tr('errorBoundary.retry')}
            </button>
            <button type="button" className={styles.btnPrimary} onClick={this.reload}>
              {tr('errorBoundary.reload')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
