import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Clock, LogOut, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { BrandAccentBar, BrandLogo } from './components/BrandLogo';
import { CourierApplicationPage } from './pages/CourierApplicationPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GlobalNetworkAlert } from './components/GlobalNetworkAlert';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { CourierAppProvider, useCourierApp } from './context/CourierAppContext';
import type { AppTab } from './types/delivery';

const AppShell = lazy(() =>
  import('./components/AppShell').then((m) => ({ default: m.AppShell }))
);
const LoginPage = lazy(() =>
  import('./pages/LoginPage').then((m) => ({ default: m.LoginPage }))
);

const AdminDriversPage = lazy(() =>
  import('./pages/AdminDriversPage').then((m) => ({ default: m.AdminDriversPage }))
);
const AdminFleetMapPage = lazy(() =>
  import('./pages/AdminFleetMapPage').then((m) => ({ default: m.AdminFleetMapPage }))
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage }))
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage }))
);
const MissionDetailPage = lazy(() =>
  import('./pages/MissionDetailPage').then((m) => ({ default: m.MissionDetailPage }))
);
const MissionsPage = lazy(() =>
  import('./pages/MissionsPage').then((m) => ({ default: m.MissionsPage }))
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))
);
const FinancePage = lazy(() =>\n  import('./pages/FinancePage').then((m) => ({ default: m.FinancePage }))\n);\nconst ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage }))
);

const TAB_TITLES: Record<AppTab, string> = {
  dashboard: 'JikJikoox Express',
  missions: 'Mes missions',
  fleet: 'Suivi GPS Flotte',
  drivers: 'Validation livreurs',
  history: 'Historique',
  notifications: 'Notifications',
  profile: 'Mon profil',\n  finance: 'Portefeuille & dépenses',
};

function MissingDriverProfileGate() { return <CourierApplicationPage />; }

function CourierExpressRouter() {
  const {
    authReady,
    loadingData,
    mode,
    profile,
    profileNotFound,
    isAdminUser,
    criticalNetworkError,
    retryingNetworkSync,
    refreshBackendData,
    retryCriticalNetworkSync,
    logout,
  } = useCourierApp();
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [showApplicationForm, setShowApplicationForm] = useState(false);

  // Ouverture directe d'une mission lors du clic sur une notification push FCM (`/?mission=...`)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const missionParam = params.get('mission')?.trim();
    if (missionParam) {
      setSelectedMissionId(missionParam);
    }
  }, []);

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

  let routeContent: ReactNode;

  if (!authReady || (mode === 'firebase' && loadingData && !profile && !profileNotFound)) {
    routeContent = (
      <div className="min-h-screen bg-[#F7F6F2] flex flex-col items-center justify-center gap-4 p-6">
        <BrandLogo size="lg" showWordmark />
        <p className="text-sm font-medium text-[#5A5851]">
          Vérification de votre compte livreur...
        </p>
      </div>
    );
  } else if (mode === 'unauthenticated') {
    routeContent = (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-6">
            <BrandLogo size="lg" showWordmark />
          </div>
        }
      >
        <LoginPage />
      </Suspense>
    );
  } else if (mode === 'firebase' && !isAdminUser && !profile && criticalNetworkError) {
    routeContent = (
      <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-6 pt-28">
        <div className="w-full max-w-md bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden shadow-2xs">
          <BrandAccentBar />
          <div className="p-6 space-y-5">
            <div className="flex justify-center">
              <BrandLogo size="md" showWordmark />
            </div>
            <div className="w-12 h-12 rounded-xl bg-[#FDF0EE] text-[#C6241B] flex items-center justify-center mx-auto">
              <WifiOff className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-extrabold text-[#141413]">
                Synchronisation Supabase indisponible
              </h1>
              <p className="text-sm text-[#5A5851] leading-relaxed">
                Impossible de charger votre profil livreur depuis les fonctions Supabase après la
                perte de connexion. Vérifiez votre accès Internet puis relancez le chargement.
              </p>
            </div>
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={retryingNetworkSync}
                onClick={() => void retryCriticalNetworkSync()}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#C6241B] hover:bg-[#9E1B14] disabled:opacity-60 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${retryingNetworkSync ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {retryingNetworkSync ? 'Reconnexion en cours...' : 'Réessayer le chargement'}
                </span>
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
  } else if (mode === 'firebase' && !isAdminUser && profileNotFound && !profile) {
    // Gate 0 : Compte Firebase authentifié sans profil `express_drivers` — écran contrôlé (aucune auto-activation)
    routeContent = <MissingDriverProfileGate />;
  } else if (mode === 'firebase' && !isAdminUser && (!profile || profile.accountStatus === 'pending')) {
    // Gate 1 : candidat en attente; autoriser la reprise/complétion du dossier, sans accès aux missions.
    routeContent = showApplicationForm ? <CourierApplicationPage onReturnToStatus={() => setShowApplicationForm(false)} /> : (
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
                Votre compte est en attente de validation
              </h1>
              <p className="text-sm text-[#5A5851] leading-relaxed">
                Votre demande d’accès livreur est bien enregistrée, mais l’accès aux missions réelles
                JikJikoox doit d’abord être approuvé par un administrateur. Pensez également à confirmer
                votre adresse e-mail via le lien reçu.
              </p>
            </div>

            {profile && (
              <div className="rounded-xl bg-[#F7F6F2] border border-[#E5E2D9] p-3.5 text-xs space-y-1">
                <p className="text-[#5A5851]">
                  Livreur :{' '}
                  <strong className="text-[#141413]">
                    {profile.firstName} {profile.lastName}
                  </strong>
                </p>
                <p className="text-[#5A5851]">
                  Compte : <strong className="text-[#141413]">{profile.email}</strong>
                </p>
                <p className="text-[#5A5851]">
                  Statut : <strong className="text-[#8A5600]">En attente de validation</strong>
                </p>
              </div>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setShowApplicationForm(true)}
                className="w-full min-h-[46px] px-4 rounded-xl border border-[#0E6E2D] bg-[#ECF7EE] text-[#0E6E2D] font-semibold text-sm"
              >
                Compléter ou ajouter mes documents
              </button>
              <button
                type="button"
                disabled={rechecking}
                onClick={() => {
                  setRechecking(true);
                  void refreshBackendData().finally(() => setRechecking(false));
                }}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-60 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${rechecking ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Vérifier l’état de validation</span>
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
  } else if (mode === 'firebase' && !isAdminUser && profile && profile.accountStatus !== 'active') {
    // Gate 2 : Livreur suspendu ou désactivé — blocage strict
    routeContent = (
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
                  : 'Accès refusé — Compte désactivé'}
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
  } else {
    routeContent = (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-6">
            <BrandLogo size="lg" showWordmark />
          </div>
        }
      >
        <AppShell
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          pageTitle={pageTitle}
          showBack={Boolean(selectedMissionId)}
          onBack={handleBackFromMission}
        >
          <Suspense
            fallback={
              <div className="space-y-4 py-4" aria-busy="true" aria-label="Chargement de la page">
                <div className="h-32 rounded-2xl bg-white border border-[#E5E2D9] animate-pulse" />
                <div className="h-64 rounded-2xl bg-white border border-[#E5E2D9] animate-pulse" />
              </div>
            }
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
            ) : activeTab === 'fleet' ? (
              <AdminFleetMapPage />
            ) : activeTab === 'drivers' ? (
              <AdminDriversPage />
            ) : activeTab === 'history' ? (
              <HistoryPage onSelectMission={handleSelectMission} />
            ) : activeTab === 'notifications' ? (
              <NotificationsPage onSelectMission={handleSelectMission} />
            ) : activeTab === 'finance' ? (
              <FinancePage />
            ) : (
              <ProfilePage />
            )}
          </Suspense>
        </AppShell>
      </Suspense>
    );
  }

  return (
    <>
      <GlobalNetworkAlert />
      {routeContent}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CourierAppProvider>
        <PwaInstallPrompt />
        <CourierExpressRouter />
      </CourierAppProvider>
    </ErrorBoundary>
  );
}
