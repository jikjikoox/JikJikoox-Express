import { useState } from 'react';
import { Clock, LogOut, ShieldAlert, Truck } from 'lucide-react';
import { AppShell } from './components/AppShell';
import { BrandAccentBar, BrandLogo } from './components/BrandLogo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CourierAppProvider, useCourierApp } from './context/CourierAppContext';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { MissionDetailPage } from './pages/MissionDetailPage';
import { MissionsPage } from './pages/MissionsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import type { AppTab } from './types/delivery';

const TAB_TITLES: Record<AppTab, string> = {
  dashboard: 'JikJikoox Express',
  missions: 'Mes missions',
  history: 'Historique',
  notifications: 'Notifications',
  profile: 'Mon profil',
};

function CourierExpressRouter() {
  const {
    authReady,
    loadingData,
    mode,
    profile,
    enterDemoMode,
    logout,
  } = useCourierApp();
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);

  if (!authReady || (mode === 'firebase' && loadingData && !profile)) {
    return (
      <div className="min-h-screen bg-[#F7F6F2] flex flex-col items-center justify-center gap-4 p-6">
        <BrandLogo size="lg" showWordmark />
        <p className="text-sm font-medium text-[#5A5851]">
          Vérification de votre compte livreur...
        </p>
      </div>
    );
  }

  if (mode === 'unauthenticated') {
    return <LoginPage />;
  }

  // Gate 1 : Livreur authentifié en attente de validation par JikJikoox Admin
  if (mode === 'firebase' && (!profile || profile.accountStatus === 'pending')) {
    return (
      <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden shadow-2xs">
          <BrandAccentBar />
          <div className="p-6 space-y-5">
            <div className="flex justify-center">
              <BrandLogo size="md" showWordmark />
            </div>

            <div className="w-12 h-12 rounded-xl bg-[#FEF6E4] text-[#8A5600] flex items-center justify-center mx-auto">
              <Clock className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-extrabold text-[#141413]">
                Compte en attente d’autorisation
              </h1>
              <p className="text-sm text-[#5A5851] leading-relaxed">
                Votre identité Google est vérifiée, mais l’accès aux missions réelles JikJikoox doit
                d’abord être approuvé par un administrateur.
              </p>
            </div>

            {profile && (
              <div className="rounded-xl bg-[#F7F6F2] border border-[#E5E2D9] p-3.5 text-xs space-y-1">
                <p className="text-[#5A5851]">
                  Compte : <strong className="text-[#141413]">{profile.email}</strong>
                </p>
                <p className="text-[#5A5851]">
                  Référence livreur :{' '}
                  <span className="font-mono text-[#141413]">{profile.uid.slice(0, 12)}…</span>
                </p>
              </div>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={enterDemoMode}
                className="w-full min-h-[48px] px-4 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Truck className="w-4 h-4" aria-hidden="true" />
                <span>Explorer le mode démonstration local</span>
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="w-full min-h-[46px] px-4 rounded-xl border border-[#D6D1C4] hover:bg-[#F7F6F2] text-[#141413] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>Se déconnecter</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Gate 2 : Livreur suspendu ou désactivé — blocage strict
  if (mode === 'firebase' && profile && profile.accountStatus !== 'active') {
    return (
      <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden shadow-2xs">
          <BrandAccentBar />
          <div className="p-6 text-center space-y-4">
            <div className="flex justify-center">
              <BrandLogo size="md" showWordmark />
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#FDF0EE] text-[#C6241B] flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-[#141413]">
                {profile.accountStatus === 'suspended'
                  ? 'Compte temporairement suspendu'
                  : 'Compte désactivé'}
              </h1>
              <p className="text-sm text-[#5A5851] mt-2 leading-relaxed">
                Votre accès aux missions JikJikoox Express est actuellement restreint. Contactez votre
                superviseur JikJikoox Admin à Dakar pour régulariser votre situation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full min-h-[48px] px-4 rounded-xl bg-[#141413] hover:bg-black text-white font-semibold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Se déconnecter</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSelectTab = (tab: AppTab) => {
    setSelectedMissionId(null);
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleSelectMission = (missionId: string) => {
    setSelectedMissionId(missionId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleBackFromMission = () => {
    setSelectedMissionId(null);
  };

  const pageTitle = selectedMissionId ? 'Détail de la mission' : TAB_TITLES[activeTab];

  return (
    <AppShell
      activeTab={activeTab}
      onSelectTab={handleSelectTab}
      pageTitle={pageTitle}
      showBack={Boolean(selectedMissionId)}
      onBack={handleBackFromMission}
    >
      {selectedMissionId ? (
        <MissionDetailPage
          missionId={selectedMissionId}
          onBack={handleBackFromMission}
        />
      ) : activeTab === 'dashboard' ? (
        <DashboardPage
          onSelectMission={handleSelectMission}
          onNavigateTab={handleSelectTab}
        />
      ) : activeTab === 'missions' ? (
        <MissionsPage onSelectMission={handleSelectMission} />
      ) : activeTab === 'history' ? (
        <HistoryPage onSelectMission={handleSelectMission} />
      ) : activeTab === 'notifications' ? (
        <NotificationsPage onSelectMission={handleSelectMission} />
      ) : (
        <ProfilePage />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CourierAppProvider>
        <CourierExpressRouter />
      </CourierAppProvider>
    </ErrorBoundary>
  );
}
