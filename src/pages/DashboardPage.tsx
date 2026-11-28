import { lazy, Suspense, useMemo } from 'react';
import {
  ArrowRight,
  Banknote,
  Bell,
  CheckCircle2,
  ClipboardList,
  Database,
  Power,
  Truck,
  MapPin,
  Users,
  ShieldCheck,
} from 'lucide-react';
import { BrandAccentBar } from '../components/BrandLogo';
import { MissionCard } from '../components/MissionCard';
import { useCourierApp } from '../context/CourierAppContext';
import {
  formatFcfa,
  formatTimeFr,
  MISSION_STATUS_META,
  NOTIFICATION_CATEGORY_LABELS,
} from '../lib/missionWorkflow';
import type { AppTab } from '../types/delivery';

const DashboardChart = lazy(() =>
  import('../components/DashboardChart').then((m) => ({ default: m.DashboardChart }))
);

interface DashboardPageProps {
  onSelectMission: (missionId: string) => void;
  onNavigateTab: (tab: AppTab) => void;
}

export function DashboardPage({ onSelectMission, onNavigateTab }: DashboardPageProps) {
  const {
    mode,
    profile,
    isAdminUser,
    firebaseUser,
    missions,
    notifications,
    loadingData,
    toggleAvailability,
    enterDemoMode,
  } = useCourierApp();

  const stats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    const isFromToday = (iso: string) => {
      const parsed = new Date(iso).getTime();
      return !Number.isNaN(parsed) && parsed >= todayMs;
    };

    const active = missions.filter((m) => MISSION_STATUS_META[m.status].isActive);
    const awaitingAccept = missions.filter((m) => m.status === 'ASSIGNED');
    const deliveredToday = missions.filter(
      (m) => m.status === 'DELIVERED' && isFromToday(m.updatedAtIso || m.createdAtIso)
    );
    const todayMissions = missions.filter(
      (m) =>
        MISSION_STATUS_META[m.status].isActive ||
        isFromToday(m.updatedAtIso || m.createdAtIso)
    );
    const estimatedEarnings = deliveredToday.reduce((sum, m) => sum + m.estimatedFee, 0);
    const pendingCod = active
      .filter((m) => m.paymentMode === 'cod')
      .reduce((sum, m) => sum + m.codAmount, 0);
    const collectedCod = deliveredToday
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
      totalToday: todayMissions.length,
      activeCount: active.length,
      awaitingAcceptCount: awaitingAccept.length,
      deliveredCount: deliveredToday.length,
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

  if (isAdminUser && !profile) {
    const adminName = firebaseUser?.displayName?.trim() || 'Administrateur';
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <section className="rounded-2xl border border-[#E5E2D9] bg-white p-5">
          <BrandAccentBar className="h-[3px]" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[#0E6E2D]">Espace de gestion</p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#141413]">Bonjour, {adminName}</h1>
          <p className="mt-2 text-sm text-[#5A5851]">Accédez directement aux opérations essentielles de JikJikoox Express.</p>
          {firebaseUser?.email && <p className="mt-3 text-xs text-[#77736A]">{firebaseUser.email}</p>}
        </section>
        <section className="space-y-2">
          <h2 className="text-base font-bold text-[#141413]">Actions rapides</h2>
          {([
            ['missions', ClipboardList, 'Commandes et missions', 'Consulter et gérer les livraisons'],
            ['drivers', Users, 'Livreurs', 'Examiner les dossiers et validations'],
            ['fleet', MapPin, 'Suivi de la flotte', 'Voir les livreurs sur la carte'],
          ] as const).map(([tab, Icon, title, description]) => (
            <button key={tab} type="button" onClick={() => onNavigateTab(tab)} className="w-full min-h-[72px] rounded-xl border border-[#E5E2D9] bg-white p-4 flex items-center gap-3 text-left hover:border-[#0E6E2D] transition-colors">
              <span className="w-11 h-11 rounded-xl bg-[#ECF7EE] text-[#0E6E2D] flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold text-[#141413]">{title}</span><span className="block text-xs text-[#5A5851] mt-0.5">{description}</span></span>
              <ArrowRight className="w-4 h-4 text-[#5A5851] shrink-0" />
            </button>
          ))}
        </section>
        <section className="rounded-xl border border-[#E5E2D9] bg-[#F7F6F2] p-4 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#0E6E2D] shrink-0 mt-0.5" />
          <p className="text-sm text-[#5A5851]">Votre session administrateur est authentifiée. Cette page ne nécessite pas de profil livreur.</p>
        </section>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-6">
      {/* Top Greeting & Availability Hero Row */}
      <section className="bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden">
        <BrandAccentBar className="h-[3px]" />
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#5A5851] capitalize">
              {todayFormatted} · {profile.workZone}
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#141413] tracking-tight mt-1">
              Bonjour, {profile.firstName}
            </h1>
            <p className="text-sm text-[#5A5851] mt-1">
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
                ? 'bg-[#0E6E2D] hover:bg-[#095220] border-[#0E6E2D] text-white'
                : 'bg-[#F7F6F2] hover:bg-[#EFECE4] border-[#D6D1C4] text-[#141413]'
            }`}
          >
            <Power className="w-4 h-4 shrink-0" aria-hidden="true" />
            <div className="text-left">
              <div className="text-sm font-bold leading-tight">
                {profile.isAvailable ? 'Disponible' : 'Indisponible'}
              </div>
              <div
                className={`text-[11px] font-medium ${
                  profile.isAvailable ? 'text-white/80' : 'text-[#5A5851]'
                }`}
              >
                {profile.isAvailable ? 'Prêt pour affectation' : 'Touchez pour reprendre'}
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* Weekly Missions Accomplished & Success Rate Chart (Recharts — lazy-loaded) */}
      <Suspense
        fallback={
          <section
            aria-label="Chargement du graphique hebdomadaire"
            className="bg-white border border-[#E5E2D9] rounded-2xl p-5 sm:p-6 h-[356px] animate-pulse"
          />
        }
      >
        <DashboardChart missions={missions} />
      </Suspense>

      {/* Firebase Active Courier Empty State — never writes fake missions to Firestore */}
      {mode === 'firebase' && !loadingData && missions.length === 0 && (
        <section className="bg-[#FEF6E4] border border-[#F4A61D]/40 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[#141413] flex items-center gap-2">
              <Database className="w-4 h-4 text-[#8A5600]" aria-hidden="true" />
              En attente d’affectations JikJikoox Admin
            </h2>
            <p className="text-sm text-[#5A5851]">
              Aucune mission réelle n’est encore affectée à votre compte. Pour tester l’interface
              sans écrire dans Firestore, utilisez l’aperçu démonstration local.
            </p>
          </div>
          <button
            type="button"
            onClick={enterDemoMode}
            className="min-h-[46px] px-4 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] text-white font-semibold text-sm whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            Ouvrir l’aperçu démo local
          </button>
        </section>
      )}

      {/* 4-Column KPI Strip */}
      <section aria-label="Indicateurs du jour" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#5A5851]">Livraisons du jour</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold text-[#141413] tabular-nums">
            {stats.totalToday}
          </p>
          <p className="mt-1 text-xs text-[#5A5851] tabular-nums">
            {stats.awaitingAcceptCount > 0
              ? `${stats.awaitingAcceptCount} à accepter`
              : 'Toutes prises en charge'}
          </p>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#5A5851]">En cours</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold text-[#0E6E2D] tabular-nums">
            {stats.activeCount}
          </p>
          <p className="mt-1 text-xs text-[#5A5851] tabular-nums">
            {stats.pendingCod > 0 ? `COD : ${formatFcfa(stats.pendingCod)}` : 'Aucun COD en attente'}
          </p>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#5A5851]">Terminées (auj.)</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold text-[#141413] tabular-nums">
            {stats.deliveredCount}
          </p>
          <p className="mt-1 text-xs text-[#0E6E2D] font-medium">Livrées avec preuve</p>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-[#5A5851]">Rémunération du jour</p>
          <p className="mt-2 font-mono text-xl sm:text-2xl font-bold text-[#141413] tabular-nums">
            {formatFcfa(stats.estimatedEarnings)}
          </p>
          <p className="mt-1 text-xs text-[#8A5600] tabular-nums">
            Encaissé : {formatFcfa(stats.collectedCod)}
          </p>
        </div>
      </section>

      {/* Main Content 2-Column Split on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Dominant Column: Priority Mission + Primary CTA */}
        <section className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#141413]">Mission prioritaire</h2>
            <button
              type="button"
              onClick={() => onNavigateTab('missions')}
              className="text-sm font-semibold text-[#0E6E2D] hover:underline cursor-pointer"
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
            <div className="bg-white border border-[#E5E2D9] rounded-2xl p-6 text-center">
              <Truck className="w-8 h-8 text-[#5A5851] mx-auto mb-2.5" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#141413]">
                Aucune course active en attente
              </p>
              <p className="text-xs text-[#5A5851] mt-1">
                Restez en statut Disponible pour recevoir les prochaines affectations JikJikoox.
              </p>
            </div>
          )}

          {/* Primary Action Button to view all missions */}
          <button
            type="button"
            onClick={() => onNavigateTab('missions')}
            className="w-full min-h-[52px] px-5 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] text-white font-semibold text-sm flex items-center justify-between gap-3 transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <ClipboardList className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>Consulter mes missions ({stats.activeCount} actives)</span>
            </span>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          </button>

          {/* Cash to remit reminder when COD collected > 0 */}
          {stats.collectedCod > 0 && (
            <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#FEF6E4] text-[#8A5600] flex items-center justify-center shrink-0">
                  <Banknote className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#141413]">
                    Espèces encaissées (COD)
                  </p>
                  <p className="text-xs text-[#5A5851] truncate">
                    À reverser selon la procédure JikJikoox Admin
                  </p>
                </div>
              </div>
              <span className="font-mono text-sm font-bold text-[#141413] tabular-nums shrink-0">
                {formatFcfa(stats.collectedCod)}
              </span>
            </div>
          )}
        </section>

        {/* Right Column: Recent Notifications */}
        <section className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[#141413]">Notifications récentes</h2>
            <button
              type="button"
              onClick={() => onNavigateTab('notifications')}
              className="text-sm font-semibold text-[#0E6E2D] hover:underline cursor-pointer"
            >
              Historique
            </button>
          </div>

          <div className="bg-white border border-[#E5E2D9] rounded-2xl divide-y divide-[#E5E2D9] overflow-hidden">
            {recentNotifications.length === 0 ? (
              <div className="p-6 text-center">
                <Bell className="w-7 h-7 text-[#5A5851] mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-[#5A5851]">Aucune alerte récente</p>
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
                  className="w-full text-left p-4 hover:bg-[#F7F6F2] transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-[#5A5851] mb-1">
                    <span className="font-semibold text-[#0E6E2D]">
                      {NOTIFICATION_CATEGORY_LABELS[notif.category]}
                    </span>
                    <span className="tabular-nums">{formatTimeFr(notif.createdAtIso)}</span>
                  </div>
                  <p
                    className={`text-sm leading-snug ${
                      notif.isRead ? 'font-medium text-[#5A5851]' : 'font-bold text-[#141413]'
                    }`}
                  >
                    {notif.title}
                  </p>
                  <p className="text-xs text-[#5A5851] mt-1 line-clamp-2">{notif.body}</p>
                </button>
              ))
            )}
          </div>

          {stats.deliveredCount > 0 && (
            <div className="flex items-center gap-2 text-xs text-[#5A5851] px-1">
              <CheckCircle2 className="w-4 h-4 text-[#0E6E2D] shrink-0" aria-hidden="true" />
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
