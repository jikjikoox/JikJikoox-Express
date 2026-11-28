import React from 'react';
import {
  ArrowLeft,
  Bell,
  ClipboardList,
  History,
  Home,
  LogOut,
  Map as MapIcon,
  Power,
  User as UserIcon,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import type { AppTab } from '../types/delivery';
import { BrandAccentBar, BrandLogo } from './BrandLogo';

interface AppShellProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  pageTitle: string;
  showBack?: boolean;
  onBack?: () => void;
  children: React.ReactNode;
}

const BASE_NAV_ITEMS: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Accueil', icon: Home },
  { id: 'missions', label: 'Missions', icon: ClipboardList },
  { id: 'history', label: 'Historique', icon: History },
  { id: 'notifications', label: 'Alertes', icon: Bell },
  { id: 'profile', label: 'Profil', icon: UserIcon },
  { id: 'finance', label: 'Finances', icon: Wallet },
];

export function AppShell({
  activeTab,
  onSelectTab,
  pageTitle,
  showBack = false,
  onBack,
  children,
}: AppShellProps) {
  const {
    mode,
    isAdminUser,
    profile,
    unreadCount,
    toast,
    dismissToast,
    toggleAvailability,
    logout,
  } = useCourierApp();

  const showAdminTabs = isAdminUser || mode === 'demo';
  const desktopNavItems = showAdminTabs
    ? [
        BASE_NAV_ITEMS[0],
        BASE_NAV_ITEMS[1],
        { id: 'fleet' as AppTab, label: 'Carte GPS', icon: MapIcon },
        { id: 'drivers' as AppTab, label: 'Validation livreurs', icon: Users },
        BASE_NAV_ITEMS[2],
        BASE_NAV_ITEMS[3],
        BASE_NAV_ITEMS[4],
      ]
    : BASE_NAV_ITEMS;
  const mobileNavItems = showAdminTabs
    ? BASE_NAV_ITEMS.filter((item) => item.id !== 'finance')
    : BASE_NAV_ITEMS;

  return (
    <div className="min-h-screen bg-[#F7F6F2] text-[#141413] flex flex-col lg:flex-row">
      {/* Desktop Sidebar Rail */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-white border-r border-[#E5E2D9]">
        <BrandAccentBar />

        {/* Brand Header */}
        <div className="px-5 h-16 flex items-center border-b border-[#E5E2D9]">
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            aria-label="Retour à l'accueil JikJikoox Express"
            className="flex items-center cursor-pointer text-left rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0E6E2D]"
          >
            <BrandLogo size="sm" showWordmark subtitle="Espace livreur" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav aria-label="Navigation principale" className="flex-1 p-3 space-y-1">
          {desktopNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full min-h-[46px] px-3.5 rounded-xl flex items-center justify-between gap-3 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#ECF7EE] text-[#0E6E2D]'
                    : 'text-[#5A5851] hover:bg-[#F7F6F2] hover:text-[#141413]'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span className="font-mono text-xs font-bold text-[#C6241B] tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Availability & Courier Summary */}
        <div className="p-4 border-t border-[#E5E2D9] space-y-3">
          {mode === 'demo' && (
            <p className="text-xs text-[#8A5600] bg-[#FEF6E4] border border-[#F4A61D]/25 rounded-lg px-3 py-2 font-medium">
              Mode démonstration local
            </p>
          )}
          {profile && (
            <button
              type="button"
              onClick={() => void toggleAvailability()}
              className={`w-full min-h-[44px] px-3.5 rounded-xl border text-sm font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                profile.isAvailable
                  ? 'border-[#0E6E2D]/30 bg-[#ECF7EE] text-[#0E6E2D]'
                  : 'border-[#E5E2D9] bg-[#F7F6F2] text-[#5A5851]'
              }`}
            >
              <span className="flex items-center gap-2 truncate">
                <Power className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {profile.isAvailable ? 'Disponible' : 'Indisponible'}
                </span>
              </span>
              <span className="text-xs font-medium underline">Changer</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full min-h-[44px] px-3.5 rounded-xl text-sm font-medium text-[#5A5851] hover:text-[#C6241B] hover:bg-[#FDF0EE] flex items-center gap-2.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Compact Top App Bar (54px total height to stay well under 15% mobile sticky cap) */}
        <header className="lg:hidden sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E5E2D9]">
          <BrandAccentBar className="h-[2px]" />
          <div className="h-[52px] px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {showBack && onBack ? (
                <>
                  <button
                    type="button"
                    onClick={onBack}
                    aria-label="Retour"
                    className="-ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#141413] hover:bg-[#F7F6F2] cursor-pointer shrink-0"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTab('dashboard')}
                    aria-label="Accueil JikJikoox Express"
                    className="flex items-center cursor-pointer shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0E6E2D]"
                  >
                    <BrandLogo size="sm" />
                  </button>
                  <span className="font-display font-bold text-base text-[#141413] truncate">
                    {pageTitle}
                  </span>
                </>
              ) : activeTab === 'dashboard' ? (
                <button
                  type="button"
                  onClick={() => onSelectTab('dashboard')}
                  aria-label="Accueil JikJikoox Express"
                  className="flex items-center cursor-pointer text-left min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0E6E2D]"
                >
                  <BrandLogo size="sm" showWordmark />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelectTab('dashboard')}
                    aria-label="Retour à l'accueil JikJikoox Express"
                    className="flex items-center cursor-pointer shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0E6E2D]"
                  >
                    <BrandLogo size="sm" />
                  </button>
                  <span aria-hidden="true" className="w-px h-4 bg-[#E5E2D9] shrink-0" />
                  <span className="font-display font-bold text-base text-[#141413] truncate">
                    {pageTitle}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {showAdminTabs && (
                <>
                  <button
                    type="button"
                    onClick={() => onSelectTab('fleet')}
                    aria-label="Ouvrir la carte GPS de la flotte"
                    className={`min-w-[36px] min-h-[36px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                      activeTab === 'fleet'
                        ? 'bg-[#0E6E2D] text-white'
                        : 'bg-[#F7F6F2] text-[#141413]'
                    }`}
                  >
                    <MapIcon className="w-4 h-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">GPS</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTab('drivers')}
                    aria-label="Valider les comptes livreurs"
                    className={`min-w-[36px] min-h-[36px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                      activeTab === 'drivers'
                        ? 'bg-[#0E6E2D] text-white'
                        : 'bg-[#F7F6F2] text-[#141413]'
                    }`}
                  >
                    <Users className="w-4 h-4" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">Livreurs</span>
                  </button>
                </>
              )}
              {profile && (
                <button
                  type="button"
                  onClick={() => void toggleAvailability()}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    profile.isAvailable
                      ? 'bg-[#ECF7EE] text-[#0E6E2D]'
                      : 'bg-[#EFECE4] text-[#5A5851]'
                  }`}
                >
                  {profile.isAvailable ? 'Disponible' : 'Indisponible'}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Desktop Sticky Top Header (aligned with sidebar BrandAccentBar & 64px brand row) */}
        <header className="hidden lg:flex flex-col sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-[#E5E2D9]">
          <BrandAccentBar />
          <div className="h-16 px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {showBack && onBack && (
                <>
                  <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-[#5A5851] hover:text-[#141413] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Retour aux missions</span>
                  </button>
                  <span aria-hidden="true" className="w-px h-5 bg-[#E5E2D9]" />
                </>
              )}
              <span className="font-display font-bold text-base text-[#141413] truncate">
                {activeTab === 'dashboard' && !showBack ? 'Tableau de bord' : pageTitle}
              </span>
            </div>

            {profile && (
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right leading-tight">
                  <p className="text-sm font-semibold text-[#141413] whitespace-nowrap">
                    {profile.firstName} {profile.lastName}
                  </p>
                  <p className="text-xs text-[#5A5851] whitespace-nowrap">{profile.workZone}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectTab('notifications')}
                  aria-label="Voir les alertes"
                  className="relative w-10 h-10 rounded-xl border border-[#E5E2D9] bg-white hover:bg-[#F7F6F2] text-[#141413] flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C6241B] text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Toast Feedback */}
        {toast && (
          <div className="fixed top-16 lg:top-20 right-4 left-4 sm:left-auto sm:w-96 z-50">
            <div
              role="status"
              className={`rounded-xl px-4 py-3 border shadow-sm flex items-center justify-between gap-3 text-sm font-medium ${
                toast.tone === 'red'
                  ? 'bg-[#FDF0EE] border-[#C6241B]/30 text-[#921A14]'
                  : toast.tone === 'yellow'
                  ? 'bg-[#FEF6E4] border-[#F4A61D]/40 text-[#8A5600]'
                  : 'bg-[#ECF7EE] border-[#0E6E2D]/30 text-[#095220]'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={dismissToast}
                aria-label="Fermer la notification"
                className="p-1 rounded-lg hover:bg-black/5 shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Tab Bar (5 Destinations) */}
      <nav
        aria-label="Navigation mobile"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E5E2D9] pb-safe"
      >
        <div className="grid grid-cols-6 h-[60px] items-center">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                  isActive ? 'text-[#0E6E2D]' : 'text-[#5A5851]'
                }`}
              >
                <div className="relative">
                  <Icon className="w-[21px] h-[21px]" aria-hidden="true" />
                  {item.id === 'notifications' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#C6241B] text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
