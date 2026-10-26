import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('VIAPP render failure', error, info.componentStack);
  }
  render() {
    return this.state.failed ? (
      <main className="fatal-error">
        <h1>页面遇到了问题</h1>
        <p>已保存到本地库的方案仍会保留。刷新页面后重新连接设备。</p>
        <button onClick={() => window.location.reload()}>重新打开工作台</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
