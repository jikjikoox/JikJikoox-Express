import React, { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Download,
  LogOut,
  MapPin,
  Save,
  ShieldCheck,
  Smartphone,
  Truck,
  Volume2,
} from 'lucide-react';
import { BrandAccentBar, BrandLogo } from '../components/BrandLogo';
import { useCourierApp } from '../context/CourierAppContext';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DAKAR_ZONES, VEHICLE_LABELS } from '../lib/missionWorkflow';
import type { VehicleType } from '../types/delivery';

export function ProfilePage() {
  const {
    mode,
    profile,
    pushState,
    updateProfile,
    enablePushNotifications,
    disablePushNotifications,
    toggleAvailability,
    logout,
  } = useCourierApp();

  const { isInstalled, isIosSafari, canPromptInstall, canShowInstallAction, promptInstall } =
    usePWAInstall();
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false);

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [vehicleType, setVehicleType] = useState<VehicleType>(profile?.vehicleType ?? 'scooter');
  const [vehiclePlate, setVehiclePlate] = useState(profile?.vehiclePlate ?? '');
  const [workZone, setWorkZone] = useState(profile?.workZone ?? DAKAR_ZONES[0]);
  const [saving, setSaving] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setPhone(profile.phone);
    setVehicleType(profile.vehicleType);
    setVehiclePlate(profile.vehiclePlate ?? '');
    setWorkZone(profile.workZone);
  }, [profile]);

  if (!profile) return null;

  const initials = `${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({
        firstName,
        lastName,
        phone,
        vehicleType,
        vehiclePlate,
        workZone,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-[#141413] tracking-tight">Profil livreur</h1>
        <p className="text-sm text-[#5A5851] mt-0.5">
          Informations opérationnelles, véhicule et préférences de notification.
        </p>
      </div>

      {/* Courier Identity Header Card */}
      <section className="bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden">
        <BrandAccentBar className="h-[3px]" />
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {profile.photoUrl && !avatarError ? (
              <img
                src={profile.photoUrl}
                alt={`Portrait de ${profile.firstName} ${profile.lastName}`}
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="w-16 h-16 rounded-2xl object-cover border border-[#E5E2D9] shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-[#ECF7EE] text-[#0E6E2D] font-display font-extrabold text-xl flex items-center justify-center shrink-0">
                {initials}
              </div>
            )}

            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-[#141413] truncate">
                {profile.firstName} {profile.lastName}
              </h2>
              <p className="text-sm text-[#5A5851] truncate">{profile.email}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#5A5851]">
                <span className="font-semibold text-[#0E6E2D]">
                  Compte : {profile.accountStatus === 'active' ? 'Actif' : profile.accountStatus}
                </span>
                <span aria-hidden="true">·</span>
                <span>{VEHICLE_LABELS[profile.vehicleType]}</span>
                <span aria-hidden="true">·</span>
                <span>{mode === 'firebase' ? 'Session Firebase' : 'Mode démo'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void toggleAvailability()}
            className={`min-h-[46px] px-4 rounded-xl font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              profile.isAvailable
                ? 'bg-[#0E6E2D] hover:bg-[#095220] text-white'
                : 'bg-[#F7F6F2] hover:bg-[#EFECE4] text-[#141413] border border-[#D6D1C4]'
            }`}
          >
            {profile.isAvailable ? 'Disponible' : 'Indisponible'}
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Editable Operational Details Form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 bg-white border border-[#E5E2D9] rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <h2 className="text-base font-bold text-[#141413]">Informations personnelles & terrain</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-semibold text-[#141413] mb-1.5">
                Prénom
              </label>
              <input
                id="firstName"
                type="text"
                required
                maxLength={60}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D6D1C4] bg-white text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
              />
            </div>

            <div>
              <label htmlFor="lastName" className="block text-sm font-semibold text-[#141413] mb-1.5">
                Nom
              </label>
              <input
                id="lastName"
                type="text"
                required
                maxLength={60}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D6D1C4] bg-white text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
              />
            </div>
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-semibold text-[#141413] mb-1.5">
              Téléphone professionnel (Sénégal)
            </label>
            <input
              id="phone"
              type="tel"
              required
              minLength={7}
              maxLength={24}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D6D1C4] bg-white font-mono text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="vehicleType" className="block text-sm font-semibold text-[#141413] mb-1.5">
                Type de véhicule
              </label>
              <div className="relative">
                <Truck
                  className="w-4 h-4 text-[#5A5851] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <select
                  id="vehicleType"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                  className="w-full min-h-[46px] pl-10 pr-3.5 rounded-xl border border-[#D6D1C4] bg-white text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
                >
                  {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map((key) => (
                    <option key={key} value={key}>
                      {VEHICLE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="vehiclePlate" className="block text-sm font-semibold text-[#141413] mb-1.5">
                Immatriculation
              </label>
              <input
                id="vehiclePlate"
                type="text"
                maxLength={24}
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="Ex. DK-4821-AM"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D6D1C4] bg-white font-mono text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
              />
            </div>
          </div>

          <div>
            <label htmlFor="workZone" className="block text-sm font-semibold text-[#141413] mb-1.5">
              Zone de travail principale
            </label>
            <div className="relative">
              <MapPin
                className="w-4 h-4 text-[#5A5851] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <select
                id="workZone"
                value={workZone}
                onChange={(e) => setWorkZone(e.target.value)}
                className="w-full min-h-[46px] pl-10 pr-3.5 rounded-xl border border-[#D6D1C4] bg-white text-sm text-[#141413] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
              >
                {DAKAR_ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="w-full sm:w-auto min-h-[48px] px-6 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-60 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              <span>{saving ? 'Enregistrement...' : 'Enregistrer les modifications'}</span>
            </button>
          </div>
        </form>

        {/* Right Column: Notification Preferences + Account Security + Sign Out */}
        <div className="lg:col-span-5 space-y-5">
          <section className="bg-white border border-[#E5E2D9] rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-[#141413]">Paramètres de notification</h2>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Bell className="w-4 h-4 text-[#0E6E2D] mt-1 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[#141413]">Alertes missions (Push FCM)</p>
                  <p className="text-xs text-[#5A5851]">
                    {pushState.tokenRegistered && profile.notificationsEnabled
                      ? 'Appareil enregistré pour les affectations, modifications et annulations.'
                      : 'Activez pour recevoir instantanément vos missions en arrière-plan.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                disabled={pushState.busy}
                aria-checked={profile.notificationsEnabled}
                onClick={() => {
                  if (profile.notificationsEnabled) {
                    void disablePushNotifications();
                  } else {
                    void enablePushNotifications();
                  }
                }}
                className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 disabled:opacity-50 ${
                  profile.notificationsEnabled ? 'bg-[#0E6E2D]' : 'bg-[#D6D1C4]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    profile.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-[#E5E2D9]" />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Volume2 className="w-4 h-4 text-[#0E6E2D] mt-1 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[#141413]">Sonnerie prioritaire</p>
                  <p className="text-xs text-[#5A5851]">
                    Alerte sonore renforcée pour les nouvelles courses.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={profile.pushSoundEnabled}
                onClick={() =>
                  void updateProfile({ pushSoundEnabled: !profile.pushSoundEnabled })
                }
                className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                  profile.pushSoundEnabled ? 'bg-[#0E6E2D]' : 'bg-[#D6D1C4]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    profile.pushSoundEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </section>

          {(isInstalled || canShowInstallAction) && (
            <section className="bg-white border border-[#E5E2D9] rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-5 h-5 text-[#0E6E2D] shrink-0" aria-hidden="true" />
                <h2 className="text-base font-bold text-[#141413]">Application mobile (PWA)</h2>
              </div>

              {isInstalled ? (
                <div className="flex items-center gap-2 text-xs font-semibold text-[#0E6E2D] bg-[#ECF7EE] border border-[#0E6E2D]/20 rounded-xl px-3.5 py-2.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>JikJikoox Express est installée sur votre appareil.</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-[#5A5851] leading-relaxed">
                    Installez JikJikoox Express sur votre écran d’accueil pour un accès direct en plein écran.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void promptInstall().then((res) => {
                        if (res === 'ios_manual') setShowIosInstallHelp((v) => !v);
                      });
                    }}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {canPromptInstall ? 'Installer l’application' : 'Guide d’installation iPhone / iPad'}
                    </span>
                  </button>
                  {showIosInstallHelp && isIosSafari && !canPromptInstall && (
                    <div className="rounded-xl bg-[#F7F6F2] border border-[#E5E2D9] p-3 text-xs text-[#5A5851] leading-relaxed">
                      Dans Safari : touchez <strong className="text-[#141413]">Partager</strong>, puis{' '}
                      <strong className="text-[#141413]">Sur l’écran d’accueil</strong> et{' '}
                      <strong className="text-[#141413]">Ajouter</strong>.
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <section className="bg-white border border-[#E5E2D9] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E5E2D9]">
              <BrandLogo size="sm" showWordmark subtitle="Réseau officiel Sénégal" />
              <ShieldCheck className="w-5 h-5 text-[#0E6E2D] shrink-0" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-bold text-[#141413]">Sécurité du compte</h2>
              <p className="text-xs text-[#5A5851] leading-relaxed">
                Votre rôle (<strong className="text-[#141413]">livreur</strong>), l’activation de
                votre compte et vos rémunérations officielles sont administrés exclusivement par{' '}
                <strong className="text-[#141413]">JikJikoox Admin</strong>.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              className="w-full min-h-[48px] px-4 rounded-xl bg-[#FDF0EE] hover:bg-[#FCE2DE] border border-[#C6241B]/25 text-[#C6241B] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Se déconnecter</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
