import React from 'react';
import {
  ArrowLeft,
  Bell,
  ClipboardList,
  History,
  Home,
  LogOut,
  Power,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import type { AppTab } from '../types/delivery';

interface AppShellProps {
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  pageTitle: string;
  showBack?: boolean;
  onBack?: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: { id: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Accueil', icon: Home },
  { id: 'missions', label: 'Missions', icon: ClipboardList },
  { id: 'history', label: 'Historique', icon: History },
  { id: 'notifications', label: 'Alertes', icon: Bell },
  { id: 'profile', label: 'Profil', icon: UserIcon },
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
    profile,
    unreadCount,
    toast,
    dismissToast,
    toggleAvailability,
    logout,
  } = useCourierApp();

  return (
    <div className="min-h-screen bg-[#F6F7F6] text-[#111915] flex flex-col lg:flex-row">
      {/* Desktop Sidebar Rail */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-white border-r border-[#E4EAE6]">
        {/* Brand Header */}
        <div className="px-6 h-16 flex items-center border-b border-[#E4EAE6]">
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer text-left"
          >
            <span className="w-8 h-8 rounded-lg bg-[#0F6B3E] flex items-center justify-center text-white font-display font-extrabold text-sm shrink-0">
              JX
            </span>
            <span className="font-display font-extrabold text-base tracking-tight text-[#111915] whitespace-nowrap">
              JikJikoox Express
            </span>
          </button>
        </div>

        {/* Navigation Links */}
        <nav aria-label="Navigation principale" className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full min-h-[46px] px-3.5 rounded-xl flex items-center justify-between gap-3 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#ECF6F0] text-[#0F6B3E]'
                    : 'text-[#586860] hover:bg-[#F6F7F6] hover:text-[#111915]'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span className="font-mono text-xs font-bold text-[#C82829] tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Availability & Courier Summary */}
        <div className="p-4 border-t border-[#E4EAE6] space-y-3">
          {mode === 'demo' && (
            <p className="text-xs text-[#7A5600] bg-[#FEF7E0] rounded-lg px-3 py-2 font-medium">
              Mode démonstration local
            </p>
          )}
          {profile && (
            <button
              type="button"
              onClick={() => void toggleAvailability()}
              className={`w-full min-h-[44px] px-3.5 rounded-xl border text-sm font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                profile.isAvailable
                  ? 'border-[#0F6B3E]/30 bg-[#ECF6F0] text-[#0F6B3E]'
                  : 'border-[#E4EAE6] bg-[#F6F7F6] text-[#586860]'
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
            className="w-full min-h-[44px] px-3.5 rounded-xl text-sm font-medium text-[#586860] hover:text-[#C82829] hover:bg-[#FDF0F0] flex items-center gap-2.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Compact Top App Bar (52px height to stay well under 15% mobile sticky cap) */}
        <header className="lg:hidden sticky top-0 z-30 h-[52px] bg-white/95 backdrop-blur-md border-b border-[#E4EAE6] px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {showBack && onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="Retour"
                className="-ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#111915] hover:bg-[#F6F7F6] cursor-pointer"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <span className="w-7 h-7 rounded-lg bg-[#0F6B3E] flex items-center justify-center text-white font-display font-extrabold text-xs shrink-0">
                JX
              </span>
            )}
            <span className="font-display font-bold text-base text-[#111915] truncate">
              {pageTitle}
            </span>
          </div>

          {profile && (
            <button
              type="button"
              onClick={() => void toggleAvailability()}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                profile.isAvailable
                  ? 'bg-[#ECF6F0] text-[#0F6B3E]'
                  : 'bg-[#F0F2F1] text-[#586860]'
              }`}
            >
              {profile.isAvailable ? 'Disponible' : 'Indisponible'}
            </button>
          )}
        </header>

        {/* Desktop Subtle Top Context Row */}
        {showBack && onBack && (
          <div className="hidden lg:flex items-center px-8 pt-6">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#586860] hover:text-[#111915] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Retour aux missions</span>
            </button>
          </div>
        )}

        {/* Toast Feedback */}
        {toast && (
          <div className="fixed top-16 lg:top-5 right-4 left-4 sm:left-auto sm:w-96 z-50">
            <div
              role="status"
              className={`rounded-xl px-4 py-3 border shadow-sm flex items-center justify-between gap-3 text-sm font-medium ${
                toast.tone === 'red'
                  ? 'bg-[#FDF0F0] border-[#C82829]/30 text-[#8F1D1E]'
                  : toast.tone === 'yellow'
                  ? 'bg-[#FEF7E0] border-[#E5A400]/35 text-[#7A5600]'
                  : 'bg-[#ECF6F0] border-[#0F6B3E]/30 text-[#0A5230]'
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
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E4EAE6] pb-safe"
      >
        <div className="grid grid-cols-5 h-[60px] items-center">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                  isActive ? 'text-[#0F6B3E]' : 'text-[#586860]'
                }`}
              >
                <div className="relative">
                  <Icon className="w-[21px] h-[21px]" aria-hidden="true" />
                  {item.id === 'notifications' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#C82829] text-white font-mono text-[10px] font-bold flex items-center justify-center tabular-nums">
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
