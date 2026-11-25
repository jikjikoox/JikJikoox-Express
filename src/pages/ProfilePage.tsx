import React, { useEffect, useState } from 'react';
import {
  Bell,
  LogOut,
  MapPin,
  Save,
  ShieldCheck,
  Truck,
  Volume2,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import { DAKAR_ZONES, VEHICLE_LABELS } from '../lib/missionWorkflow';
import type { VehicleType } from '../types/delivery';

export function ProfilePage() {
  const { mode, profile, updateProfile, toggleAvailability, logout } = useCourierApp();

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
        <h1 className="text-2xl font-extrabold text-[#111915] tracking-tight">Profil livreur</h1>
        <p className="text-sm text-[#586860] mt-0.5">
          Informations opérationnelles, véhicule et préférences de notification.
        </p>
      </div>

      {/* Courier Identity Header Card */}
      <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {profile.photoUrl && !avatarError ? (
            <img
              src={profile.photoUrl}
              alt={`Portrait de ${profile.firstName} ${profile.lastName}`}
              referrerPolicy="no-referrer"
              onError={() => setAvatarError(true)}
              className="w-16 h-16 rounded-2xl object-cover border border-[#E4EAE6] shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-[#ECF6F0] text-[#0F6B3E] font-display font-extrabold text-xl flex items-center justify-center shrink-0">
              {initials}
            </div>
          )}

          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-[#111915] truncate">
              {profile.firstName} {profile.lastName}
            </h2>
            <p className="text-sm text-[#586860] truncate">{profile.email}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#586860]">
              <span className="font-semibold text-[#0F6B3E]">
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
              ? 'bg-[#0F6B3E] hover:bg-[#0A5230] text-white'
              : 'bg-[#F6F7F6] hover:bg-[#E9EFEA] text-[#111915] border border-[#D5DDD8]'
          }`}
        >
          {profile.isAvailable ? 'Disponible' : 'Indisponible'}
        </button>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Editable Operational Details Form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-7 bg-white border border-[#E4EAE6] rounded-2xl p-5 sm:p-6 space-y-4"
        >
          <h2 className="text-base font-bold text-[#111915]">Informations personnelles & terrain</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-semibold text-[#111915] mb-1.5">
                Prénom
              </label>
              <input
                id="firstName"
                type="text"
                required
                maxLength={60}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#111915] focus:outline-none focus:border-[#0F6B3E] focus:ring-2 focus:ring-[#0F6B3E]/15"
              />
            </div>

            <div>
              <label htmlFor="lastName" className="block text-sm font-semibold text-[#111915] mb-1.5">
                Nom
              </label>
              <input
                id="lastName"
                type="text"
                required
                maxLength={60}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#111915] focus:outline-none focus:border-[#0F6B3E] focus:ring-2 focus:ring-[#0F6B3E]/15"
              />
            </div>
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-semibold text-[#111915] mb-1.5">
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
              className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D5DDD8] bg-white font-mono text-sm text-[#111915] focus:outline-none focus:border-[#0F6B3E] focus:ring-2 focus:ring-[#0F6B3E]/15"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="vehicleType" className="block text-sm font-semibold text-[#111915] mb-1.5">
                Type de véhicule
              </label>
              <div className="relative">
                <Truck
                  className="w-4 h-4 text-[#586860] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <select
                  id="vehicleType"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value as VehicleType)}
                  className="w-full min-h-[46px] pl-10 pr-3.5 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#111915] focus:outline-none focus:border-[#0F6B3E] focus:ring-2 focus:ring-[#0F6B3E]/15"
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
              <label htmlFor="vehiclePlate" className="block text-sm font-semibold text-[#111915] mb-1.5">
                Immatriculation
              </label>
              <input
                id="vehiclePlate"
                type="text"
                maxLength={24}
                value={vehiclePlate}
                onChange={(e) => setVehiclePlate(e.target.value)}
                placeholder="Ex. DK-4821-AM"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D5DDD8] bg-white font-mono text-sm text-[#111915] focus:outline-none focus:border-[#0F6B3E] focus:ring-2 focus:ring-[#0F6B3E]/15"
              />
            </div>
          </div>

          <div>
            <label htmlFor="workZone" className="block text-sm font-semibold text-[#111915] mb-1.5">
              Zone de travail principale
            </label>
            <div className="relative">
              <MapPin
                className="w-4 h-4 text-[#586860] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <select
                id="workZone"
                value={workZone}
                onChange={(e) => setWorkZone(e.target.value)}
                className="w-full min-h-[46px] pl-10 pr-3.5 rounded-xl border border-[#D5DDD8] bg-white text-sm text-[#111915] focus:outline-none focus:border-[#0F6B3E] focus:ring-2 focus:ring-[#0F6B3E]/15"
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
              className="w-full sm:w-auto min-h-[48px] px-6 rounded-xl bg-[#0F6B3E] hover:bg-[#0A5230] disabled:opacity-60 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" aria-hidden="true" />
              <span>{saving ? 'Enregistrement...' : 'Enregistrer les modifications'}</span>
            </button>
          </div>
        </form>

        {/* Right Column: Notification Preferences + Account Security + Sign Out */}
        <div className="lg:col-span-5 space-y-5">
          <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-[#111915]">Paramètres de notification</h2>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Bell className="w-4 h-4 text-[#0F6B3E] mt-1 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[#111915]">Alertes missions (Push)</p>
                  <p className="text-xs text-[#586860]">
                    Nouvelles affectations, modifications et annulations.
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={profile.notificationsEnabled}
                onClick={() =>
                  void updateProfile({ notificationsEnabled: !profile.notificationsEnabled })
                }
                className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                  profile.notificationsEnabled ? 'bg-[#0F6B3E]' : 'bg-[#D5DDD8]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    profile.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="border-t border-[#E4EAE6]" />

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Volume2 className="w-4 h-4 text-[#0F6B3E] mt-1 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-[#111915]">Sonnerie prioritaire</p>
                  <p className="text-xs text-[#586860]">
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
                  profile.pushSoundEnabled ? 'bg-[#0F6B3E]' : 'bg-[#D5DDD8]'
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

          <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5 space-y-3">
            <h2 className="text-base font-bold text-[#111915] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#0F6B3E]" aria-hidden="true" />
              Sécurité du compte
            </h2>
            <p className="text-xs text-[#586860] leading-relaxed">
              Votre rôle (<strong className="text-[#111915]">livreur</strong>), l’activation de votre
              compte et vos rémunérations officielles sont administrés exclusivement par{' '}
              <strong className="text-[#111915]">JikJikoox Admin</strong>.
            </p>

            <button
              type="button"
              onClick={() => void logout()}
              className="w-full min-h-[48px] px-4 rounded-xl bg-[#FDF0F0] hover:bg-[#FCE2E2] border border-[#C82829]/25 text-[#C82829] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
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
