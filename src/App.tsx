import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Clock, LogOut, RefreshCw, ShieldAlert, Truck, UserPlus } from 'lucide-react';
import { BrandAccentBar, BrandLogo } from './components/BrandLogo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { CourierAppProvider, useCourierApp } from './context/CourierAppContext';
import { DAKAR_ZONES, VEHICLE_LABELS } from './lib/missionWorkflow';
import type { AppTab, VehicleType } from './types/delivery';

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
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage }))
);

const TAB_TITLES: Record<AppTab, string> = {
  dashboard: 'JikJikoox Express',
  missions: 'Mes missions',
  fleet: 'Suivi GPS Flotte',
  drivers: 'Validation livreurs',
  history: 'Historique',
  notifications: 'Notifications',
  profile: 'Mon profil',
};

function MissingDriverProfileGate() {
  const { firebaseUser, completeCourierRegistration, enterDemoMode, logout } = useCourierApp();
  const displayParts = (firebaseUser?.displayName || '').trim().split(/\s+/).filter(Boolean);
  const [firstName, setFirstName] = useState(displayParts[0] || '');
  const [lastName, setLastName] = useState(displayParts.slice(1).join(' ') || '');
  const [phone, setPhone] = useState('+221 ');
  const [vehicleType, setVehicleType] = useState<VehicleType>('scooter');
  const [workZone, setWorkZone] = useState<string>(DAKAR_ZONES[0]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleComplete = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      await completeCourierRegistration({
        firstName,
        lastName,
        phone,
        vehicleType,
        workZone,
        termsAccepted,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden shadow-2xs">
        <BrandAccentBar />
        <div className="p-6 space-y-5">
          <div className="flex justify-center">
            <BrandLogo size="md" showWordmark />
          </div>

          <div className="w-12 h-12 rounded-xl bg-[#FEF6E4] text-[#8A5600] flex items-center justify-center mx-auto">
            <UserPlus className="w-6 h-6" aria-hidden="true" />
          </div>

          <div className="text-center space-y-1.5">
            <h1 className="text-xl font-extrabold text-[#141413]">Profil livreur introuvable</h1>
            <p className="text-sm text-[#5A5851] leading-relaxed">
              Votre compte Firebase (<strong className="text-[#141413]">{firebaseUser?.email}</strong>)
              n’est pas encore enregistré dans <code className="font-mono text-xs">express_drivers</code>.
              Complétez votre demande ci-dessous pour la soumettre à validation administrative.
            </p>
          </div>

          <form onSubmit={handleComplete} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-[#5A5851]">
                Prénom
                <input
                  required
                  minLength={2}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full h-10 rounded-xl border border-[#D6D1C4] px-3 text-sm text-[#141413]"
                />
              </label>
              <label className="text-xs font-semibold text-[#5A5851]">
                Nom
                <input
                  required
                  minLength={2}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full h-10 rounded-xl border border-[#D6D1C4] px-3 text-sm text-[#141413]"
                />
              </label>
            </div>

            <label className="block text-xs font-semibold text-[#5A5851]">
              Téléphone (avec indicatif)
              <input
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+221 77 000 00 00"
                className="mt-1 w-full h-10 rounded-xl border border-[#D6D1C4] px-3 font-mono text-sm text-[#141413]"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-[#5A5851]">
                Véhicule
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                  className="mt-1 w-full h-10 rounded-xl border border-[#D6D1C4] bg-white px-2.5 text-sm text-[#141413]"
                >
                  {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map((key) => (
                    <option key={key} value={key}>
                      {VEHICLE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-[#5A5851]">
                Zone souhaitée
                <select
                  value={workZone}
                  onChange={(e) => setWorkZone(e.target.value)}
                  className="mt-1 w-full h-10 rounded-xl border border-[#D6D1C4] bg-white px-2.5 text-sm text-[#141413]"
                >
                  {DAKAR_ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex items-start gap-2 text-xs text-[#5A5851] cursor-pointer pt-1">
              <input
                type="checkbox"
                required
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#0E6E2D] shrink-0"
              />
              <span>
                J’accepte les conditions d’utilisation de JikJikoox Express (validation administrative
                requise).
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[46px] rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-60 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              {busy ? 'Enregistrement...' : 'Finaliser ma demande livreur'}
            </button>
          </form>

          <div className="space-y-2 border-t border-[#E5E2D9] pt-3">
            <button
              type="button"
              onClick={enterDemoMode}
              className="w-full min-h-[44px] px-4 rounded-xl bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#D6D1C4] text-[#141413] font-semibold text-xs inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Truck className="w-4 h-4 text-[#0E6E2D]" aria-hidden="true" />
              <span>Explorer le mode démonstration</span>
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="w-full min-h-[44px] px-4 rounded-xl border border-[#D6D1C4] hover:bg-[#F7F6F2] text-[#141413] font-semibold text-xs inline-flex items-center justify-center gap-2 cursor-pointer"
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

function CourierExpressRouter() {
  const {
    authReady,
    loadingData,
    mode,
    profile,
    profileNotFound,
    isAdminUser,
    refreshBackendData,
    enterDemoMode,
    logout,
  } = useCourierApp();
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);

  // Ouverture directe d'une mission lors du clic sur une notification push FCM (`/?mission=...`)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const missionParam = params.get('mission')?.trim();
    if (missionParam) {
      setSelectedMissionId(missionParam);
    }
  }, []);

  if (!authReady || (mode === 'firebase' && loadingData && !profile && !profileNotFound)) {
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
    return (
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
  }

  // Gate 0 : Compte Firebase authentifié sans profil `express_drivers` — écran contrôlé (aucune auto-activation)
  if (mode === 'firebase' && !isAdminUser && profileNotFound && !profile) {
    return <MissingDriverProfileGate />;
  }

  // Gate 1 : Livreur authentifié en attente de validation par JikJikoox Admin
  if (mode === 'firebase' && !isAdminUser && (!profile || profile.accountStatus === 'pending')) {
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
                onClick={enterDemoMode}
                className="w-full min-h-[46px] px-4 rounded-xl bg-[#F7F6F2] hover:bg-[#EFECE4] border border-[#D6D1C4] text-[#141413] font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Truck className="w-4 h-4 text-[#0E6E2D]" aria-hidden="true" />
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
  if (mode === 'firebase' && !isAdminUser && profile && profile.accountStatus !== 'active') {
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
          ) : (
            <ProfilePage />
          )}
        </Suspense>
      </AppShell>
    </Suspense>
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
