import { useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Lock,
  MapPin,
  MessageSquareText,
  Package,
  Phone,
  Store,
} from 'lucide-react';
import { ProofOfDeliverySheet } from '../components/ProofOfDeliverySheet';
import { StatusIndicator } from '../components/StatusIndicator';
import { useCourierApp } from '../context/CourierAppContext';
import { useCourierActions } from '../hooks/useCourierActions';
import {
  ACTIVE_WORKFLOW_STEPS,
  ALLOWED_TRANSITIONS,
  formatDateShortFr,
  formatFcfa,
  maskPhoneNumber,
  MISSION_STATUS_META,
} from '../lib/missionWorkflow';
import type { MissionStatus, ProofSubmission } from '../types/delivery';

interface MissionDetailPageProps {
  missionId: string;
  onBack: () => void;
}

export function MissionDetailPage({ missionId, onBack }: MissionDetailPageProps) {
  const { missions, showToast } = useCourierApp();
  const { executeTransition } = useCourierActions();
  const mission = missions.find((m) => m.missionId === missionId);

  const [phoneVisible, setPhoneVisible] = useState(false);
  const [busyStatus, setBusyStatus] = useState<MissionStatus | null>(null);
  const [activeSheet, setActiveSheet] = useState<'proof' | 'failure' | null>(null);

  if (!mission) {
    return (
      <div className="bg-white border border-[#E4EAE6] rounded-2xl p-8 text-center">
        <p className="text-base font-bold text-[#111915]">Mission introuvable</p>
        <p className="text-sm text-[#586860] mt-1">
          Cette mission n’est plus rattachée à votre compte ou a été retirée.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 min-h-[46px] px-5 rounded-xl bg-[#0F6B3E] text-white text-sm font-semibold cursor-pointer"
        >
          Retour aux missions
        </button>
      </div>
    );
  }

  const statusMeta = MISSION_STATUS_META[mission.status];
  const actions = ALLOWED_TRANSITIONS[mission.status];
  const isCod = mission.paymentMode === 'cod' && mission.codAmount > 0;
  const canRevealPhone = statusMeta.isActive;

  const handleActionClick = async (
    nextStatus: MissionStatus,
    requiresProof?: boolean,
    requiresFailureReason?: boolean
  ) => {
    if (requiresProof) {
      setActiveSheet('proof');
      return;
    }
    if (requiresFailureReason) {
      setActiveSheet('failure');
      return;
    }
    setBusyStatus(nextStatus);
    try {
      await executeTransition(mission.missionId, nextStatus);
    } finally {
      setBusyStatus(null);
    }
  };

  const handleConfirmDelivery = async (proof: ProofSubmission) => {
    await executeTransition(mission.missionId, 'DELIVERED', { proof });
  };

  const handleConfirmFailure = async (failureReason: string) => {
    await executeTransition(mission.missionId, 'FAILED', { failureReason });
  };

  const handleCopyGps = async () => {
    if (typeof mission.gpsLat !== 'number' || typeof mission.gpsLng !== 'number') return;
    const coords = `${mission.gpsLat.toFixed(5)}, ${mission.gpsLng.toFixed(5)}`;
    try {
      await navigator.clipboard.writeText(coords);
      showToast(`Coordonnées GPS copiées : ${coords}`, 'green');
    } catch {
      showToast(`GPS : ${coords}`, 'yellow');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Summary Card */}
      <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#586860]">
              <span className="font-mono font-bold text-[#111915] text-sm tabular-nums">
                {mission.orderNumber}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Créée le {formatDateShortFr(mission.createdAtIso)}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#111915] mt-1.5">
              {mission.customerName}
            </h1>
            <p className="text-sm text-[#586860] mt-0.5">{mission.deliveryZone}</p>
          </div>
          <StatusIndicator status={mission.status} />
        </div>

        {/* Workflow Progress Bar (Active & Delivered) */}
        {statusMeta.stepIndex >= 0 && (
          <div className="mt-5 pt-4 border-t border-[#E4EAE6]">
            <div className="grid grid-cols-6 gap-1.5">
              {ACTIVE_WORKFLOW_STEPS.map((step, idx) => {
                const stepOrder = MISSION_STATUS_META[step.status].stepIndex;
                const reached = statusMeta.stepIndex >= stepOrder;
                return (
                  <div key={step.status} className="space-y-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-colors ${
                        reached ? 'bg-[#0F6B3E]' : 'bg-[#E4EAE6]'
                      }`}
                    />
                    <p
                      className={`text-[10px] sm:text-xs font-medium truncate ${
                        reached ? 'text-[#111915]' : 'text-[#586860]'
                      }`}
                    >
                      {idx + 1}. {step.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Financial / Encaissement Panel (Immutable from Frontend) */}
      <section
        className={`rounded-2xl border p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
          isCod
            ? 'bg-[#FEF7E0] border-[#E5A400]/40'
            : 'bg-[#ECF6F0] border-[#0F6B3E]/25'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isCod ? 'bg-[#E5A400]/20 text-[#7A5600]' : 'bg-[#0F6B3E]/15 text-[#0F6B3E]'
            }`}
          >
            <Banknote className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#586860]">
              {isCod ? 'Paiement à la réception (COD)' : 'Commande prépayée'}
            </p>
            <p className="font-mono text-2xl font-bold text-[#111915] tabular-nums mt-0.5">
              {isCod ? formatFcfa(mission.codAmount) : '0 FCFA à encaisser'}
            </p>
          </div>
        </div>

        <div className="sm:text-right border-t sm:border-t-0 pt-3 sm:pt-0 border-black/10">
          <p className="text-xs text-[#586860]">Rémunération estimée</p>
          <p className="font-mono text-base font-bold text-[#111915] tabular-nums">
            {formatFcfa(mission.estimatedFee)}
          </p>
          <p className="text-[11px] text-[#586860] inline-flex items-center gap-1 mt-0.5">
            <Lock className="w-3 h-3" aria-hidden="true" />
            Montants vérifiés par JikJikoox
          </p>
        </div>
      </section>

      {/* Main 2-Column Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Route, Customer Contact, Instructions, Items */}
        <div className="lg:col-span-7 space-y-5">
          {/* Pickup & Delivery Route */}
          <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-[#111915]">Itinéraire de la course</h2>

            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#F6F7F6] text-[#586860] flex items-center justify-center shrink-0">
                  <Store className="w-4 h-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#586860]">Point de retrait marchand</p>
                  <p className="text-sm font-bold text-[#111915] mt-0.5">{mission.pickupName}</p>
                  <p className="text-sm text-[#586860]">{mission.pickupAddress}</p>
                </div>
              </div>

              <div className="border-t border-[#E4EAE6]" />

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#ECF6F0] text-[#0F6B3E] flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0F6B3E]">
                    Livraison · {mission.deliveryZone}
                  </p>
                  <p className="text-sm font-bold text-[#111915] mt-0.5">
                    {mission.deliveryAddress}
                  </p>

                  {typeof mission.gpsLat === 'number' && typeof mission.gpsLng === 'number' && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-[#586860] tabular-nums">
                        GPS : {mission.gpsLat.toFixed(4)}, {mission.gpsLng.toFixed(4)}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyGps}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-[#F6F7F6] hover:bg-[#ECF6F0] text-xs font-semibold text-[#111915] transition-colors cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        Copier GPS
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Customer Contact (PII Protected) */}
          <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#586860]">Contact client</p>
                <p className="text-base font-bold text-[#111915] mt-0.5">
                  {mission.customerName}
                </p>
                <p className="font-mono text-sm text-[#586860] mt-1 tabular-nums">
                  {canRevealPhone && phoneVisible
                    ? mission.customerPhone
                    : maskPhoneNumber(mission.customerPhone)}
                </p>
              </div>

              {canRevealPhone ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPhoneVisible((v) => !v)}
                    className="min-h-[44px] px-3.5 rounded-xl border border-[#D5DDD8] hover:bg-[#F6F7F6] text-xs sm:text-sm font-semibold text-[#111915] inline-flex items-center gap-2 cursor-pointer"
                  >
                    {phoneVisible ? (
                      <>
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                        <span>Masquer</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4" aria-hidden="true" />
                        <span>Afficher</span>
                      </>
                    )}
                  </button>

                  {phoneVisible && (
                    <a
                      href={`tel:${mission.customerPhone.replace(/\s+/g, '')}`}
                      className="min-h-[44px] px-4 rounded-xl bg-[#0F6B3E] hover:bg-[#0A5230] text-white text-sm font-semibold inline-flex items-center gap-2"
                    >
                      <Phone className="w-4 h-4" aria-hidden="true" />
                      <span>Appeler</span>
                    </a>
                  )}
                </div>
              ) : (
                <span className="text-xs text-[#586860] font-medium">
                  Numéro masqué (mission clôturée)
                </span>
              )}
            </div>
          </section>

          {/* Special Instructions */}
          {mission.instructions && (
            <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5">
              <h2 className="text-sm font-bold text-[#111915] flex items-center gap-2 mb-2">
                <MessageSquareText className="w-4 h-4 text-[#0F6B3E]" aria-hidden="true" />
                Instructions particulières
              </h2>
              <p className="text-sm text-[#111915] leading-relaxed">{mission.instructions}</p>
            </section>
          )}

          {/* Products List */}
          <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-base font-bold text-[#111915] flex items-center gap-2">
                <Package className="w-4 h-4 text-[#0F6B3E]" aria-hidden="true" />
                Contenu du colis
              </h2>
              <span className="text-xs font-mono text-[#586860] tabular-nums">
                {mission.itemCount} article{mission.itemCount > 1 ? 's' : ''}
              </span>
            </div>

            <ul className="divide-y divide-[#E4EAE6]">
              {mission.itemsSummary.map((item, idx) => (
                <li
                  key={`${item.name}-${idx}`}
                  className="py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-[#111915] font-medium">{item.name}</span>
                  <span className="font-mono text-xs font-semibold text-[#586860] whitespace-nowrap shrink-0 tabular-nums">
                    × {item.quantity} {item.unit || ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Right Column: Controlled Actions + Proof Summary + Timeline */}
        <div className="lg:col-span-5 space-y-5">
          {/* Controlled Workflow Action Card */}
          <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5 space-y-3">
            <h2 className="text-base font-bold text-[#111915]">Action suivante</h2>

            {actions.length > 0 ? (
              <div className="space-y-2.5">
                {actions.map((action) => (
                  <button
                    key={action.nextStatus}
                    type="button"
                    disabled={busyStatus !== null}
                    onClick={() =>
                      void handleActionClick(
                        action.nextStatus,
                        action.requiresProof,
                        action.requiresFailureReason
                      )
                    }
                    className={`w-full min-h-[52px] px-4 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                      action.variant === 'primary'
                        ? 'bg-[#0F6B3E] hover:bg-[#0A5230] text-white'
                        : action.variant === 'danger'
                        ? 'bg-[#FDF0F0] hover:bg-[#FCE2E2] text-[#C82829] border border-[#C82829]/25'
                        : 'bg-[#F6F7F6] hover:bg-[#E9EFEA] text-[#111915] border border-[#D5DDD8]'
                    }`}
                  >
                    {busyStatus === action.nextStatus ? 'Mise à jour...' : action.label}
                  </button>
                ))}
                <p className="text-xs text-[#586860] leading-relaxed">
                  Seules les transitions autorisées par le workflow JikJikoox sont activées à chaque
                  étape.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {mission.status === 'DELIVERED' && (
                  <div className="rounded-xl bg-[#ECF6F0] p-4 space-y-1.5 text-sm">
                    <p className="font-bold text-[#0F6B3E] flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                      Mission livrée et verrouillée
                    </p>
                    {mission.recipientName && (
                      <p className="text-[#111915]">
                        Remis à : <strong>{mission.recipientName}</strong>
                      </p>
                    )}
                    {mission.proofCode && (
                      <p className="font-mono text-xs text-[#586860] tabular-nums">
                        Code remise : {mission.proofCode}
                      </p>
                    )}
                    {mission.proofNote && (
                      <p className="text-xs text-[#586860]">{mission.proofNote}</p>
                    )}
                  </div>
                )}

                {(mission.status === 'RETURN_REQUIRED' ||
                  mission.status === 'RETURNED' ||
                  mission.status === 'REFUSED' ||
                  mission.status === 'CANCELLED') && (
                  <div className="rounded-xl bg-[#FDF0F0] p-4 space-y-1.5 text-sm">
                    <p className="font-bold text-[#C82829] flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {statusMeta.label}
                    </p>
                    {mission.failureReason && (
                      <p className="text-xs text-[#8F1D1E]">Motif : {mission.failureReason}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Event History Timeline */}
          <section className="bg-white border border-[#E4EAE6] rounded-2xl p-5">
            <h2 className="text-base font-bold text-[#111915] flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-[#0F6B3E]" aria-hidden="true" />
              Historique des événements
            </h2>

            <ol className="space-y-4">
              {[...mission.events].reverse().map((ev, index) => (
                <li key={`${ev.timestampIso}-${index}`} className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      index === 0
                        ? 'bg-[#0F6B3E] text-white'
                        : 'bg-[#EEF3F0] text-[#586860]'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#111915] leading-snug">
                      {ev.label}
                    </p>
                    {ev.note && (
                      <p className="text-xs text-[#586860] mt-0.5">{ev.note}</p>
                    )}
                    <p className="text-xs text-[#586860] mt-0.5 tabular-nums">
                      {formatDateShortFr(ev.timestampIso)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {/* Proof of Delivery / Failure Modal Sheet */}
      {activeSheet && (
        <ProofOfDeliverySheet
          mission={mission}
          sheetMode={activeSheet}
          onClose={() => setActiveSheet(null)}
          onConfirmDelivery={handleConfirmDelivery}
          onConfirmFailure={handleConfirmFailure}
        />
      )}
    </div>
  );
}
