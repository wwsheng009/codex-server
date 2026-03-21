import { createPortal } from 'react-dom'

import { useUIStore } from '../../stores/ui-store'

export function ToastHost() {
  const toasts = useUIStore((state) => state.toasts)
  const dismissToast = useUIStore((state) => state.dismissToast)

  if (!toasts.length || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="ui-toast-stack">
      {toasts.map((toast) => (
        <div className={`ui-toast ui-toast--${toast.tone}`} key={toast.id} role="status">
          <div className="ui-toast__content">
            <strong>{toast.title}</strong>
            <span>{toast.message}</span>
            {toast.actionLabel && toast.onAction ? (
              <div className="ui-toast__actions">
                <button
                  className="notice__tool"
                  onClick={() => {
                    toast.onAction?.()
                    dismissToast(toast.id)
                  }}
                  type="button"
                >
                  {toast.actionLabel}
                </button>
              </div>
            ) : null}
          </div>
          <button
            aria-label="Dismiss notification"
            className="ui-toast__close"
            onClick={() => dismissToast(toast.id)}
            type="button"
          >
            ×
          </button>
          <div
            aria-hidden="true"
            className="ui-toast__progress"
            style={{ animationDuration: `${toast.durationMs}ms` }}
          />
        </div>
      ))}
    </div>,
    document.body,
  )
}
