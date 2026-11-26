import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  MapPin,
  PauseCircle,
  Phone,
  RefreshCw,
  ShieldAlert,
  Truck,
  UserCheck,
  Users,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import { VEHICLE_LABELS } from '../lib/missionWorkflow';
import type { AdminDriverRow } from '../lib/supabaseContract';
import { expressApi, ExpressApiError } from '../services/expressApi';
import type { AccountStatus } from '../types/delivery';

type FilterTab = 'all' | AccountStatus;

const DEMO_APPLICATIONS: AdminDriverRow[] = [
  {
    id: 'demo-drv-pending-01',
    firebase_uid: 'demo_uid_pending_01',
    email: 'cheikh.sow@exemple.sn',
    first_name: 'Cheikh',
    last_name: 'Sow',
    phone: '+221 77 451 22 10',
    photo_url: null,
    vehicle_type: 'moto',
    vehicle_plate: 'DK-7712-AB',
    work_zone: 'Almadies / Ngor',
    role: 'courier',
    account_status: 'pending',
    is_available: false,
    notifications_enabled: true,
    push_sound_enabled: true,
    fcm_token: null,
    created_at: new Date(Date.now() - 45 * 60_000).toISOString(),
    updated_at: new Date(Date.now() - 45 * 60_000).toISOString(),
  },
  {
    id: 'demo-drv-active-01',
    firebase_uid: 'demo_uid_active_01',
    email: 'moussa.diallo@jikjikoox.sn',
    first_name: 'Moussa',
    last_name: 'Diallo',
    phone: '+221 77 123 45 67',
    photo_url: null,
    vehicle_type: 'scooter',
    vehicle_plate: 'DK-4821-AM',
    work_zone: 'Dakar Plateau',
    role: 'courier',
    account_status: 'active',
    is_available: true,
    notifications_enabled: true,
    push_sound_enabled: true,
    fcm_token: 'demo-token',
    created_at: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 15 * 60_000).toISOString(),
  },
  {
    id: 'demo-drv-suspended-01',
    firebase_uid: 'demo_uid_suspended_01',
    email: 'ibrahima.ba@exemple.sn',
    first_name: 'Ibrahima',
    last_name: 'Ba',
    phone: '+221 76 309 84 12',
    photo_url: null,
    vehicle_type: 'voiture',
    vehicle_plate: 'DK-9045-CD',
    work_zone: 'Mermoz / Sacré-Cœur',
    role: 'courier',
    account_status: 'suspended',
    is_available: false,
    notifications_enabled: false,
    push_sound_enabled: true,
    fcm_token: null,
    created_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

const STATUS_BADGE: Record<AccountStatus, { label: string; className: string }> = {
  pending: { label: 'En attente', className: 'bg-[#FEF6E4] text-[#8A5600] border-[#F4A61D]/30' },
  active: { label: 'Actif', className: 'bg-[#ECF7EE] text-[#0E6E2D] border-[#0E6E2D]/25' },
  suspended: { label: 'Suspendu', className: 'bg-[#FDF0EE] text-[#921A14] border-[#C6241B]/25' },
  disabled: { label: 'Refusé / Désactivé', className: 'bg-[#EFECE4] text-[#5A5851] border-[#D6D1C4]' },
};

export function AdminDriversPage() {
  const { mode, isAdminUser, firebaseUser, backendConnected, showToast } = useCourierApp();
  const [drivers, setDrivers] = useState<AdminDriverRow[]>([]);
  const [filter, setFilter] = useState<FilterTab>('pending');
  const [loading, setLoading] = useState(true);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAccess = isAdminUser || mode === 'demo';

  const loadDrivers = useCallback(async () => {
    if (!canAccess) {
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      if (mode === 'demo') {
        setDrivers((prev) => (prev.length > 0 ? prev : DEMO_APPLICATIONS));
        return;
      }
      if (!firebaseUser || !backendConnected) {
        setError('Backend Supabase non configuré : impossible de charger les dossiers livreurs.');
        return;
      }
      const idToken = await firebaseUser.getIdToken();
      const res = await expressApi.fetchAdminDrivers(idToken);
      setDrivers(res.drivers);
    } catch (err) {
      setError(
        err instanceof ExpressApiError
          ? err.message
          : 'Impossible de charger les candidatures livreurs.'
      );
    } finally {
      setLoading(false);
    }
  }, [canAccess, mode, firebaseUser, backendConnected]);

  useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  const counts = useMemo(
    () => ({
      all: drivers.length,
      pending: drivers.filter((d) => d.account_status === 'pending').length,
      active: drivers.filter((d) => d.account_status === 'active').length,
      suspended: drivers.filter((d) => d.account_status === 'suspended').length,
      disabled: drivers.filter((d) => d.account_status === 'disabled').length,
    }),
    [drivers]
  );

  const filteredDrivers = useMemo(
    () => (filter === 'all' ? drivers : drivers.filter((d) => d.account_status === filter)),
    [drivers, filter]
  );

  const handleDecision = async (
    driver: AdminDriverRow,
    nextStatus: 'active' | 'suspended' | 'disabled'
  ) => {
    setBusyDriverId(driver.id);
    try {
      if (mode === 'demo') {
        setDrivers((prev) =>
          prev.map((row) =>
            row.id === driver.id
              ? {
                  ...row,
                  account_status: nextStatus,
                  is_available: nextStatus === 'active' ? row.is_available : false,
                  updated_at: new Date().toISOString(),
                }
              : row
          )
        );
        showToast(
          `${driver.first_name} ${driver.last_name} : statut passé à ${STATUS_BADGE[nextStatus].label} (démo).`,
          nextStatus === 'active' ? 'green' : 'yellow'
        );
        return;
      }

      if (!firebaseUser) return;
      const idToken = await firebaseUser.getIdToken();
      const res = await expressApi.updateAdminDriverStatus(idToken, {
        driverId: driver.id,
        accountStatus: nextStatus,
      });
      setDrivers((prev) => prev.map((row) => (row.id === driver.id ? res.driver : row)));
      showToast(
        `${driver.first_name} ${driver.last_name} : statut mis à jour (${STATUS_BADGE[nextStatus].label}).`,
        nextStatus === 'active' ? 'green' : 'yellow'
      );
    } catch (err) {
      showToast(
        err instanceof ExpressApiError
          ? err.message
          : 'Impossible de modifier le statut de ce livreur.',
        'red'
      );
    } finally {
      setBusyDriverId(null);
    }
  };

  if (!canAccess) {
    return (
      <div className="bg-white border border-[#E5E2D9] rounded-2xl p-6 text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-[#FDF0EE] text-[#C6241B] flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-extrabold text-[#141413]">Accès administrateur requis</h1>
        <p className="text-sm text-[#5A5851] max-w-md mx-auto">
          La validation, la suspension et le refus des comptes livreurs sont réservés aux
          administrateurs autorisés dans <code className="font-mono">express_admins</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#141413] tracking-tight">
            Validation des livreurs
          </h1>
          <p className="text-sm text-[#5A5851] mt-0.5">
            Approuvez les nouvelles inscriptions, consultez les profils et gérez les statuts d’accès.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadDrivers()}
          disabled={loading}
          className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-[#F7F6F2] border border-[#D6D1C4] text-sm font-semibold text-[#141413] inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#5A5851]">En attente</p>
          <p className="text-2xl font-extrabold font-mono text-[#8A5600] mt-1 tabular-nums">
            {counts.pending}
          </p>
        </div>
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#5A5851]">Actifs</p>
          <p className="text-2xl font-extrabold font-mono text-[#0E6E2D] mt-1 tabular-nums">
            {counts.active}
          </p>
        </div>
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#5A5851]">Suspendus</p>
          <p className="text-2xl font-extrabold font-mono text-[#C6241B] mt-1 tabular-nums">
            {counts.suspended}
          </p>
        </div>
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#5A5851]">Refusés / Désactivés</p>
          <p className="text-2xl font-extrabold font-mono text-[#5A5851] mt-1 tabular-nums">
            {counts.disabled}
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['pending', `En attente (${counts.pending})`],
            ['active', `Actifs (${counts.active})`],
            ['suspended', `Suspendus (${counts.suspended})`],
            ['disabled', `Refusés (${counts.disabled})`],
            ['all', `Tous (${counts.all})`],
          ] as [FilterTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
              filter === key
                ? 'bg-[#0E6E2D] text-white border-[#0E6E2D]'
                : 'bg-white text-[#5A5851] border-[#E5E2D9] hover:text-[#141413]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[#FDF0EE] border border-[#C6241B]/25 p-4 text-sm text-[#921A14]"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-32 rounded-2xl bg-white border border-[#E5E2D9] animate-pulse" />
          <div className="h-32 rounded-2xl bg-white border border-[#E5E2D9] animate-pulse" />
        </div>
      ) : filteredDrivers.length === 0 ? (
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-8 text-center space-y-2">
          <Users className="w-8 h-8 text-[#77736A] mx-auto" aria-hidden="true" />
          <p className="text-sm font-bold text-[#141413]">Aucun dossier dans cette catégorie</p>
          <p className="text-xs text-[#5A5851]">
            Les nouvelles demandes d’inscription livreurs apparaîtront ici automatiquement.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDrivers.map((driver) => {
            const badge = STATUS_BADGE[driver.account_status];
            const isBusy = busyDriverId === driver.id;
            const createdDate = new Date(driver.created_at).toLocaleDateString('fr-SN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });

            return (
              <article
                key={driver.id}
                className="bg-white border border-[#E5E2D9] rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-base font-extrabold text-[#141413]">
                      {driver.first_name} {driver.last_name}
                    </h2>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border text-xs font-semibold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <p className="text-xs text-[#5A5851] truncate">{driver.email}</p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#5A5851]">
                    <span className="inline-flex items-center gap-1.5 font-mono text-[#141413]">
                      <Phone className="w-3.5 h-3.5 text-[#0E6E2D]" aria-hidden="true" />
                      {driver.phone}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5 text-[#0E6E2D]" aria-hidden="true" />
                      {VEHICLE_LABELS[driver.vehicle_type]}
                      {driver.vehicle_plate ? ` (${driver.vehicle_plate})` : ''}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#0E6E2D]" aria-hidden="true" />
                      {driver.work_zone}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#77736A]" aria-hidden="true" />
                      Inscrit le {createdDate}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {driver.account_status !== 'active' && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDecision(driver, 'active')}
                      className="min-h-[42px] px-3.5 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {driver.account_status === 'pending' ? (
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <UserCheck className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span>{driver.account_status === 'pending' ? 'Accepter' : 'Réactiver'}</span>
                    </button>
                  )}

                  {driver.account_status !== 'suspended' && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDecision(driver, 'suspended')}
                      className="min-h-[42px] px-3.5 rounded-xl bg-[#FEF6E4] hover:bg-[#FDEBC2] border border-[#F4A61D]/40 disabled:opacity-50 text-[#8A5600] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <PauseCircle className="w-4 h-4" aria-hidden="true" />
                      <span>Suspendre</span>
                    </button>
                  )}

                  {driver.account_status !== 'disabled' && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDecision(driver, 'disabled')}
                      className="min-h-[42px] px-3.5 rounded-xl bg-[#FDF0EE] hover:bg-[#FCE2DE] border border-[#C6241B]/25 disabled:opacity-50 text-[#921A14] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Ban className="w-4 h-4" aria-hidden="true" />
                      <span>{driver.account_status === 'pending' ? 'Refuser' : 'Désactiver'}</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
