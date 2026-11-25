import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Info,
  MessageSquareText,
  PackagePlus,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import { formatDateShortFr, NOTIFICATION_CATEGORY_LABELS } from '../lib/missionWorkflow';
import type { NotificationCategory } from '../types/delivery';

interface NotificationsPageProps {
  onSelectMission: (missionId: string) => void;
}

type NotifFilter = 'all' | 'unread' | 'assignment';

function CategoryIcon({ category }: { category: NotificationCategory }) {
  const base = 'w-5 h-5 shrink-0';
  switch (category) {
    case 'assignment':
      return <PackagePlus className={`${base} text-[#0E6E2D]`} aria-hidden="true" />;
    case 'confirmation':
      return <CheckCircle2 className={`${base} text-[#0E6E2D]`} aria-hidden="true" />;
    case 'instruction':
    case 'modification':
      return <MessageSquareText className={`${base} text-[#8A5600]`} aria-hidden="true" />;
    case 'cancellation':
      return <AlertTriangle className={`${base} text-[#C6241B]`} aria-hidden="true" />;
    default:
      return <Info className={`${base} text-[#5A5851]`} aria-hidden="true" />;
  }
}

export function NotificationsPage({ onSelectMission }: NotificationsPageProps) {
  const {
    profile,
    notifications,
    unreadCount,
    markNotificationRead,
    markAllNotificationsRead,
  } = useCourierApp();

  const [filter, setFilter] = useState<NotifFilter>('all');

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'unread') return !n.isRead;
      if (filter === 'assignment') return n.category === 'assignment';
      return true;
    });
  }, [notifications, filter]);

  const handleOpenNotif = async (notificationId: string, missionId?: string) => {
    await markNotificationRead(notificationId);
    if (missionId) {
      onSelectMission(missionId);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#141413] tracking-tight">Notifications</h1>
          <p className="text-sm text-[#5A5851] mt-0.5 tabular-nums">
            {unreadCount > 0
              ? `${unreadCount} notification${unreadCount > 1 ? 's' : ''} non lue${unreadCount > 1 ? 's' : ''}`
              : 'Toutes vos alertes sont à jour'}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllNotificationsRead()}
            className="min-h-[42px] px-4 rounded-xl bg-white border border-[#D6D1C4] hover:bg-[#ECF7EE] hover:border-[#0E6E2D]/30 text-sm font-semibold text-[#0E6E2D] inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <CheckCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Tout marquer comme lu</span>
          </button>
        )}
      </div>

      {/* FCM Channel Notice */}
      <section className="bg-white border border-[#E5E2D9] rounded-2xl p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#ECF7EE] text-[#0E6E2D] flex items-center justify-center shrink-0">
            <BellRing className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#141413]">
              Alertes temps réel (Firebase Cloud Messaging)
            </p>
            <p className="text-xs text-[#5A5851]">
              {profile?.notificationsEnabled
                ? 'Notifications activées pour les affectations, instructions et confirmations.'
                : 'Notifications désactivées dans votre profil livreur.'}
            </p>
          </div>
        </div>
      </section>

      {/* Filter Bar */}
      <div
        role="tablist"
        aria-label="Filtrer les notifications"
        className="flex items-center gap-1 p-1 bg-[#EFECE4] rounded-xl max-w-md"
      >
        {(
          [
            { id: 'all', label: `Toutes (${notifications.length})` },
            { id: 'unread', label: `Non lues (${unreadCount})` },
            { id: 'assignment', label: 'Affectations' },
          ] as { id: NotifFilter; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => setFilter(tab.id)}
            className={`flex-1 min-h-[38px] px-3 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
              filter === tab.id
                ? 'bg-white text-[#0E6E2D] shadow-xs'
                : 'text-[#5A5851] hover:text-[#141413]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications Feed */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-10 text-center">
          <Bell className="w-9 h-9 text-[#5A5851] mx-auto mb-3" aria-hidden="true" />
          <p className="text-base font-bold text-[#141413]">Aucune notification</p>
          <p className="text-sm text-[#5A5851] mt-1">
            Les nouvelles affectations et instructions opérationnelles s’afficheront ici.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E2D9] rounded-2xl divide-y divide-[#E5E2D9] overflow-hidden">
          {filtered.map((notif) => (
            <button
              key={notif.notificationId}
              type="button"
              onClick={() => void handleOpenNotif(notif.notificationId, notif.missionId)}
              className={`w-full text-left p-4 sm:p-5 flex items-start gap-3.5 transition-colors cursor-pointer ${
                notif.isRead ? 'bg-white hover:bg-[#F7F6F2]' : 'bg-[#ECF7EE]/50 hover:bg-[#ECF7EE]/80'
              }`}
            >
              <div className="w-10 h-10 rounded-xl bg-white border border-[#E5E2D9] flex items-center justify-center shrink-0 mt-0.5">
                <CategoryIcon category={notif.category} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A5851]">
                  <span className="font-semibold text-[#0E6E2D]">
                    {NOTIFICATION_CATEGORY_LABELS[notif.category]}
                    {!notif.isRead ? ' · Nouveau' : ''}
                  </span>
                  <span className="tabular-nums">{formatDateShortFr(notif.createdAtIso)}</span>
                </div>
                <p
                  className={`text-sm sm:text-base mt-1 leading-snug ${
                    notif.isRead ? 'font-semibold text-[#5A5851]' : 'font-bold text-[#141413]'
                  }`}
                >
                  {notif.title}
                </p>
                <p className="text-sm text-[#5A5851] mt-1 leading-relaxed">{notif.body}</p>
              </div>

              {notif.missionId && (
                <ChevronRight className="w-5 h-5 text-[#5A5851] shrink-0 mt-2" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
