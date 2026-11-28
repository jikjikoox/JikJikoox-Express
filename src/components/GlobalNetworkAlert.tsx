import { AlertTriangle, RefreshCw, WifiOff, X } from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';

function formatAlertTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('fr-SN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function GlobalNetworkAlert() {
  const {
    criticalNetworkError,
    isOnline,
    retryingNetworkSync,
    retryCriticalNetworkSync,
    dismissCriticalNetworkError,
  } = useCourierApp();

  if (!criticalNetworkError) {
    return null;
  }

  const timeLabel = formatAlertTime(criticalNetworkError.occurredAtIso);
  const title = !isOnline
    ? 'Connexion perdue — chargement Supabase interrompu'
    : criticalNetworkError.afterConnectionLoss
      ? 'Erreur réseau critique après perte de connexion'
      : 'Échec critique du chargement des données Supabase';

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`fixed inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[calc(100%-2rem)] sm:max-w-2xl z-[95] transition-transform duration-200 ${
        !isOnline ? 'top-12 sm:top-11' : 'top-3 sm:top-4'
      }`}
    >
      <div className="overflow-hidden rounded-2xl bg-white border border-[#C6241B]/30 shadow-xl">
        <div className="h-[3px] w-full bg-[#C6241B]" aria-hidden="true" />

        <div className="p-4 flex flex-col sm:flex-row sm:items-start gap-3.5">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-xl bg-[#FDF0EE] text-[#C6241B] flex items-center justify-center shrink-0">
              {!isOnline ? (
                <WifiOff className="w-5 h-5" aria-hidden="true" />
              ) : (
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-bold text-[#141413] leading-snug">{title}</p>
              <p className="text-xs sm:text-sm text-[#5A5851] leading-relaxed">
                {criticalNetworkError.message}
              </p>

              {criticalNetworkError.hasCachedSnapshot && (
                <p className="text-xs font-medium text-[#8A5600] leading-snug">
                  Les dernières données chargées restent affichées en lecture seule jusqu’au rétablissement complet.
                </p>
              )}

              <div className="pt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5A5851] tabular-nums">
                <span>{criticalNetworkError.endpointLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[#921A14]">{criticalNetworkError.code}</span>
                {timeLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{timeLabel}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0 sm:pt-0.5">
            <button
              type="button"
              disabled={retryingNetworkSync}
              onClick={() => void retryCriticalNetworkSync()}
              className="min-h-[44px] px-4 rounded-xl bg-[#C6241B] hover:bg-[#9E1B14] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6241B]"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 shrink-0 ${retryingNetworkSync ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{retryingNetworkSync ? 'Synchronisation...' : 'Réessayer'}</span>
            </button>

            <button
              type="button"
              onClick={dismissCriticalNetworkError}
              aria-label="Fermer l’alerte d’erreur réseau"
              className="min-w-[44px] min-h-[44px] rounded-xl border border-[#E5E2D9] text-[#5A5851] hover:text-[#141413] hover:bg-[#F7F6F2] flex items-center justify-center transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141413]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
