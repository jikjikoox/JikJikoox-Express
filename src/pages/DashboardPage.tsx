import { useMemo } from 'react';
import {
  ArrowRight,
  Banknote,
  Bell,
  CheckCircle2,
  ClipboardList,
  Database,
  Power,
  Truck,
} from 'lucide-react';
import { MissionCard } from '../components/MissionCard';
import { useCourierApp } from '../context/CourierAppContext';
import {
  formatFcfa,
  formatTimeFr,
  MISSION_STATUS_META,
  NOTIFICATION_CATEGORY_LABELS,
} from '../lib/missionWorkflow';
import type { AppTab } from '../types/delivery';

interface DashboardPageProps {
  onSelectMission: (missionId: string) => void;
  onNavigateTab: (tab: AppTab) => void;
}

export function DashboardPage({ onSelectMission, onNavigateTab }: DashboardPageProps) {
  const {
    mode,
    profile,
    missions,
    notifications,
    loadingData,
    toggleAvailability,
    enterDemoMode,
  } = useCourierApp();

  const stats = useMemo(() => {
    const active = missions.filter((m) => MISSION_STATUS_META[m.status].isActive);
    const awaitingAccept = missions.filter((m) => m.status === 'ASSIGNED');
    const delivered = missions.filter((m) => m.status === 'DELIVERED');
    const estimatedEarnings = delivered.reduce((sum, m) => sum + m.estimatedFee, 0);
    const pendingCod = active
      .filter((m) => m.paymentMode === 'cod')
      .reduce((sum, m) => sum + m.codAmount, 0);
    const collectedCod = delivered
      .filter((m) => m.paymentMode === 'cod')
      .reduce((sum, m) => sum + m.codAmount, 0);

    const priorityMission =
      active.find((m) => m.status === 'ARRIVED') ||
      active.find((m) => m.status === 'IN_TRANSIT') ||
      active.find((m) => m.status === 'PICKED_UP') ||
      active.find((m) => m.status === 'ASSIGNED') ||
      active[0] ||
      null;

    return {
      totalToday: missions.length,
      activeCount: active.length,
      awaitingAcceptCount: awaitingAccept.length,
      deliveredCount: delivered.length,
      estimatedEarnings,
      pendingCod,
      collectedCod,
      priorityMission,
    };
  }, [missions]);

  const recentNotifications = useMemo(() => notifications.slice(0, 3), [notifications]);

  const todayFormatted = useMemo(
    () =>
      new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date()),
    []
  );

  if (!profile) return null;

  return (
    <div className="space-y-6">
      {/* Top Greeting & Availability Hero Row */}
      <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#586860] capitalize">
            {todayFormatted} · {profile.workZone}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#111915] tracking-tight mt-1">
            Bonjour, {profile.firstName}
          </h1>
          <p className="text-sm text-[#586860] mt-1">
            {stats.activeCount > 0
              ? `Vous avez ${stats.activeCount} livraison${stats.activeCount > 1 ? 's' : ''} active${stats.activeCount > 1 ? 's' : ''} aujourd’hui.`
              : 'Aucune mission active pour le moment.'}
          </p>
        </div>

        {/* Tactile Availability Switch */}
        <button
          type="button"
          onClick={() => void toggleAvailability()}
          className={`min-h-[54px] px-5 rounded-xl border font-semibold text-sm flex items-center justify-between sm:justify-center gap-3 transition-colors cursor-pointer shrink-0 ${
            profile.isAvailable
              ? 'bg-[#0F6B3E] hover:bg-[#0A5230] border-[#0F6B3E] text-white'
              : 'bg-[#F6F7F6] hover:bg-[#EBEFED] border-[#D5DDD8] text-[#111915]'
          }`}
        >
          <Power className="w-4 h-4 shrink-0" aria-hidden="true" />
          <div className="text-left">
            <div className="text-sm font-bold leading-tight">
              {profile.isAvailable ? 'Disponible' : 'Indisponible'}
            </div>
            <div
              className={`text-[11px] font-medium ${
                profile.isAvailable ? 'text-white/80' : 'text-[#586860]'
              }`}
            >
              {profile.isAvailable ? 'Prêt pour affectation' : 'Touchez pour reprendre'}
            </div>
          </div>
        </button>
      </section>

      {/* Firebase Active Courier Empty State — never writes fake missions to Firestore */}
      {mode === 'firebase' && !loadingData && missions.length === 0 && (
        <section className="bg-[#FEF7E0] border border-[#E5A400]/35 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#111915] flex items-center gap-2">
              <Database className="w-4 h-4 text-[#7A5600]" aria-hidden="true" />
              En attente d’affectations JikJikoox Admin
            </h2>
            <p className="text-sm text-[#586860]">
              Aucune mission réelle n’est encore affectée à votre compte. Pour tester l’interface
              sans écrire dans Firestore, utilisez l’aperçu démonstration local.
            </p>
          </div>
          <button
            type="button"
            onClick={enterDemoMode}
            className="min-h-[46px] px-4 rounded-xl bg-[#0F6B3E] hover:bg-[#0A5230] text-white font-semibold text-sm whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            Ouvrir l’aperçu démo local
          </button>
        </section>
      )}

      {/* 4-Column KPI Strip */}
      <section aria-label="Indicateurs du jour" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E4EAE6] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#586860]">Livraisons du jour</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold text-[#111915] tabular-nums">
            {stats.totalToday}
          </p>
          <p className="mt-1 text-xs text-[#586860] tabular-nums">
            {stats.awaitingAcceptCount > 0
              ? `${stats.awaitingAcceptCount} à accepter`
              : 'Toutes prises en charge'}
          </p>
        </div>

        <div className="bg-white border border-[#E4EAE6] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#586860]">En cours</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold text-[#0F6B3E] tabular-nums">
            {stats.activeCount}
          </p>
          <p className="mt-1 text-xs text-[#586860] tabular-nums">
            {stats.pendingCod > 0 ? `COD : ${formatFcfa(stats.pendingCod)}` : 'Aucun COD en attente'}
          </p>
        </div>

        <div className="bg-white border border-[#E4EAE6] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#586860]">Terminées</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold text-[#111915] tabular-nums">
            {stats.deliveredCount}
          </p>
          <p className="mt-1 text-xs text-[#0F6B3E] font-medium">Livrées avec preuve</p>
        </div>

        <div className="bg-white border border-[#E4EAE6] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#586860]">Rémunération estimée</p>
          <p className="mt-2 font-mono text-xl sm:text-2xl font-bold text-[#111915] tabular-nums">
            {formatFcfa(stats.estimatedEarnings)}
          </p>
          <p className="mt-1 text-xs text-[#7A5600] tabular-nums">
            Encaissé : {formatFcfa(stats.collectedCod)}
          </p>
        </div>
      </section>

      {/* Main Content 2-Column Split on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Dominant Column: Priority Mission + Primary CTA */}
        <section className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#111915]">Mission prioritaire</h2>
            <button
              type="button"
              onClick={() => onNavigateTab('missions')}
              className="text-sm font-semibold text-[#0F6B3E] hover:underline cursor-pointer"
            >
              Tout voir
            </button>
          </div>

          {stats.priorityMission ? (
            <MissionCard
              mission={stats.priorityMission}
              onSelect={onSelectMission}
            />
          ) : (
            <div className="bg-white border border-[#E4EAE6] rounded-2xl p-6 text-center">
              <Truck className="w-8 h-8 text-[#586860] mx-auto mb-2.5" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#111915]">
                Aucune course active en attente
              </p>
              <p className="text-xs text-[#586860] mt-1">
                Restez en statut Disponible pour recevoir les prochaines affectations JikJikoox.
              </p>
            </div>
          )}

          {/* Primary Action Button to view all missions */}
          <button
            type="button"
            onClick={() => onNavigateTab('missions')}
            className="w-full min-h-[52px] px-5 rounded-xl bg-[#0F6B3E] hover:bg-[#0A5230] text-white font-semibold text-sm flex items-center justify-between gap-3 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <ClipboardList className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>Consulter mes missions ({stats.activeCount} actives)</span>
            </span>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>

          {/* Cash to remit reminder when COD collected > 0 */}
          {stats.collectedCod > 0 && (
            <div className="bg-white border border-[#E4EAE6] rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#FEF7E0] text-[#7A5600] flex items-center justify-center shrink-0">
                  <Banknote className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#111915]">
                    Espèces encaissées (COD)
                  </p>
                  <p className="text-xs text-[#586860] truncate">
                    À reverser selon la procédure JikJikoox Admin
                  </p>
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-[#111915] tabular-nums shrink-0">
                {formatFcfa(stats.collectedCod)}
              </span>
            </div>
          )}
        </section>

        {/* Right Column: Recent Notifications */}
        <section className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#111915]">Notifications récentes</h2>
            <button
              type="button"
              onClick={() => onNavigateTab('notifications')}
              className="text-sm font-semibold text-[#0F6B3E] hover:underline cursor-pointer"
            >
              Historique
            </button>
          </div>

          <div className="bg-white border border-[#E4EAE6] rounded-2xl divide-y divide-[#E4EAE6] overflow-hidden">
            {recentNotifications.length === 0 ? (
              <div className="p-6 text-center">
                <Bell className="w-7 h-7 text-[#586860] mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-[#586860]">Aucune alerte récente</p>
              </div>
            ) : (
              recentNotifications.map((notif) => (
                <button
                  key={notif.notificationId}
                  type="button"
                  onClick={() => {
                    if (notif.missionId) {
                      onSelectMission(notif.missionId);
                    } else {
                      onNavigateTab('notifications');
                    }
                  }}
                  className="w-full text-left p-4 hover:bg-[#F6F7F6] transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-[#586860] mb-1">
                    <span className="font-semibold text-[#0F6B3E]">
                      {NOTIFICATION_CATEGORY_LABELS[notif.category]}
                    </span>
                    <span className="tabular-nums">{formatTimeFr(notif.createdAtIso)}</span>
                  </div>
                  <p
                    className={`text-sm leading-snug ${
                      notif.isRead ? 'font-medium text-[#586860]' : 'font-bold text-[#111915]'
                    }`}
                  >
                    {notif.title}
                  </p>
                  <p className="text-xs text-[#586860] mt-1 line-clamp-2">{notif.body}</p>
                </button>
              ))
            )}
          </div>

          {stats.deliveredCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-[#586860] px-1">
              <CheckCircle2 className="w-4 h-4 text-[#0F6B3E] shrink-0" aria-hidden="true" />
              <span>
                {stats.deliveredCount} course{stats.deliveredCount > 1 ? 's' : ''} clôturée
                {stats.deliveredCount > 1 ? 's' : ''} aujourd’hui sans incident.
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
