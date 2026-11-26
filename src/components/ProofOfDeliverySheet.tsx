import React, { lazy, Suspense, useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, QrCode, RefreshCw, X } from 'lucide-react';
import { FAILURE_REASONS, formatFcfa } from '../lib/missionWorkflow';
import type { QrValidationSuccess } from '../lib/qrParcelValidation';
import type { DeliveryMission, ProofSubmission } from '../types/delivery';

const QRCodeScanner = lazy(() =>
  import('./QRCodeScanner').then((m) => ({
    default: m.QRCodeScanner,
  }))
);

interface ProofOfDeliverySheetProps {
  mission: DeliveryMission;
  sheetMode: 'proof' | 'failure';
  initialQrValidation?: QrValidationSuccess | null;
  onClose: () => void;
  onConfirmDelivery: (proof: ProofSubmission) => Promise<void>;
  onConfirmFailure: (reason: string) => Promise<void>;
}

export function ProofOfDeliverySheet({
  mission,
  sheetMode,
  initialQrValidation = null,
  onClose,
  onConfirmDelivery,
  onConfirmFailure,
}: ProofOfDeliverySheetProps) {
  const isCod = mission.paymentMode === 'cod' && mission.codAmount > 0;

  const [recipientName, setRecipientName] = useState(mission.customerName);
  const [proofCode, setProofCode] = useState(initialQrValidation?.proofCodeValue ?? '');
  const [proofNote, setProofNote] = useState(initialQrValidation?.verificationNote ?? '');
  const [codConfirmed, setCodConfirmed] = useState(!isCod);
  const [qrValidation, setQrValidation] = useState<QrValidationSuccess | null>(
    initialQrValidation
  );
  const [scannerOpen, setScannerOpen] = useState(false);

  const [selectedReason, setSelectedReason] = useState(FAILURE_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleQrValidated = (result: QrValidationSuccess) => {
    setQrValidation(result);
    setProofCode(result.proofCodeValue);
    setProofNote((prev) => {
      const cleaned = prev.trim();
      if (!cleaned) return result.verificationNote;
      if (cleaned.includes('scan QR')) return result.verificationNote;
      return `${result.verificationNote} ${cleaned}`.slice(0, 300);
    });
    setScannerOpen(false);
  };

  const handleProofSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientName.trim() || (isCod && !codConfirmed)) return;
    setSubmitting(true);
    try {
      await onConfirmDelivery({
        recipientName: recipientName.trim(),
        proofCode: proofCode.trim() || undefined,
        proofNote: proofNote.trim() || undefined,
        codCollectedConfirmed: codConfirmed,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleFailureSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalReason = customReason.trim()
      ? `${selectedReason} — ${customReason.trim()}`
      : selectedReason;
    setSubmitting(true);
    try {
      await onConfirmFailure(finalReason.slice(0, 240));
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#141413]/50 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-[#E5E2D9] max-h-[90vh] overflow-y-auto">
        {/* Grab handle on mobile */}
        <div className="sm:hidden pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1.5 rounded-full bg-[#D6D1C4]" />
        </div>

        <div className="px-5 pt-4 pb-3 border-b border-[#E5E2D9] flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-mono text-[#5A5851] tabular-nums">{mission.orderNumber}</p>
            <h2 id="sheet-title" className="text-lg font-bold text-[#141413]">
              {sheetMode === 'proof'
                ? 'Confirmer la livraison'
                : 'Signaler un échec de livraison'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-[#5A5851] hover:bg-[#F7F6F2] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {sheetMode === 'proof' ? (
          <form onSubmit={handleProofSubmit} className="p-5 space-y-4">
            {/* QR Code Parcel Verification Block */}
            {qrValidation ? (
              <div className="rounded-xl bg-[#ECF7EE] border border-[#0E6E2D]/25 p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <CheckCircle2
                    className="w-5 h-5 text-[#0E6E2D] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0E6E2D]">Colis vérifié par scan QR</p>
                    <p className="font-mono text-xs text-[#141413] tabular-nums truncate">
                      {qrValidation.displayRef} · {qrValidation.proofCodeValue}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="min-h-[40px] px-3 rounded-lg border border-[#0E6E2D]/30 bg-white hover:bg-[#F7F6F2] text-xs font-semibold text-[#0E6E2D] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Rescanner
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="w-full min-h-[52px] px-4 rounded-xl border border-[#0E6E2D]/30 bg-[#ECF7EE] hover:bg-[#DFF1E3] text-[#0E6E2D] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <QrCode className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>Scanner le QR code du colis</span>
              </button>
            )}

            {isCod && (
              <div className="rounded-xl bg-[#FEF6E4] border border-[#F4A61D]/35 p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#8A5600]">
                    <Banknote className="w-4 h-4" aria-hidden="true" />
                    Encaissement obligatoire
                  </span>
                  <span className="font-mono text-base font-bold text-[#141413] tabular-nums">
                    {formatFcfa(mission.codAmount)}
                  </span>
                </div>
                <label className="flex items-start gap-3 cursor-pointer mt-2">
                  <input
                    type="checkbox"
                    checked={codConfirmed}
                    onChange={(e) => setCodConfirmed(e.target.checked)}
                    className="mt-0.5 w-5 h-5 rounded accent-[#0E6E2D] shrink-0"
                  />
                  <span className="text-sm text-[#141413] leading-snug">
                    Je confirme avoir encaissé exactement{' '}
                    <strong className="font-mono tabular-nums">
                      {formatFcfa(mission.codAmount)}
                    </strong>{' '}
                    auprès du client.
                  </span>
                </label>
              </div>
            )}

            <div>
              <label
                htmlFor="recipientName"
                className="block text-sm font-semibold text-[#141413] mb-1.5"
              >
                Nom du réceptionnaire
              </label>
              <input
                id="recipientName"
                type="text"
                required
                maxLength={100}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Ex. Aïssatou Ndiaye ou Gardien"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D6D1C4] bg-white text-[#141413] text-sm focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
              />
            </div>

            <div>
              <label
                htmlFor="proofCode"
                className="block text-sm font-semibold text-[#141413] mb-1.5"
              >
                Code de remise ou référence QR{' '}
                <span className="font-normal text-[#5A5851]">(optionnel)</span>
              </label>
              <input
                id="proofCode"
                type="text"
                inputMode="text"
                maxLength={32}
                value={proofCode}
                onChange={(e) => setProofCode(e.target.value)}
                placeholder="Ex. 4829 ou QR:JKX-2026-8412"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D6D1C4] bg-white font-mono text-[#141413] text-sm tracking-wider focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
              />
            </div>

            <div>
              <label
                htmlFor="proofNote"
                className="block text-sm font-semibold text-[#141413] mb-1.5"
              >
                Observation terrain <span className="font-normal text-[#5A5851]">(optionnel)</span>
              </label>
              <textarea
                id="proofNote"
                rows={2}
                maxLength={300}
                value={proofNote}
                onChange={(e) => setProofNote(e.target.value)}
                placeholder="Ex. Remis à l’accueil de l’immeuble, colis intact."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D6D1C4] bg-white text-[#141413] text-sm focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15 resize-none"
              />
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2.5 pb-safe">
              <button
                type="button"
                onClick={onClose}
                className="sm:w-1/3 min-h-[48px] px-4 rounded-xl border border-[#D6D1C4] text-[#141413] font-semibold text-sm hover:bg-[#F7F6F2] transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || !recipientName.trim() || (isCod && !codConfirmed)}
                className="sm:flex-1 min-h-[48px] px-4 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                {submitting ? 'Enregistrement...' : 'Valider la livraison'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleFailureSubmit} className="p-5 space-y-4">
            <div className="rounded-xl bg-[#FDF0EE] border border-[#C6241B]/20 p-3.5 flex items-start gap-2.5 text-sm text-[#921A14]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Un échec de livraison est transmis à JikJikoox Admin pour suivi client et éventuel
                retour au point relais.
              </span>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-[#141413]">Motif principal</p>
              {FAILURE_REASONS.map((reason) => (
                <label
                  key={reason}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    selectedReason === reason
                      ? 'border-[#C6241B] bg-[#FDF0EE]/55'
                      : 'border-[#E5E2D9] hover:bg-[#F7F6F2]'
                  }`}
                >
                  <input
                    type="radio"
                    name="failureReason"
                    value={reason}
                    checked={selectedReason === reason}
                    onChange={() => setSelectedReason(reason)}
                    className="w-4 h-4 accent-[#C6241B]"
                  />
                  <span className="text-sm text-[#141413]">{reason}</span>
                </label>
              ))}
            </div>

            <div>
              <label
                htmlFor="customReason"
                className="block text-sm font-semibold text-[#141413] mb-1.5"
              >
                Précision complémentaire <span className="font-normal text-[#5A5851]">(optionnel)</span>
              </label>
              <input
                id="customReason"
                type="text"
                maxLength={140}
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Ex. Client a demandé une reprogrammation demain matin"
                className="w-full min-h-[46px] px-3.5 rounded-xl border border-[#D6D1C4] bg-white text-[#141413] text-sm focus:outline-none focus:border-[#C6241B] focus:ring-2 focus:ring-[#C6241B]/15"
              />
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-2.5 pb-safe">
              <button
                type="button"
                onClick={onClose}
                className="sm:w-1/3 min-h-[48px] px-4 rounded-xl border border-[#D6D1C4] text-[#141413] font-semibold text-sm hover:bg-[#F7F6F2] transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="sm:flex-1 min-h-[48px] px-4 rounded-xl bg-[#C6241B] hover:bg-[#9E1B14] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                {submitting ? 'Transmission...' : 'Confirmer l’échec'}
              </button>
            </div>
          </form>
        )}
      </div>

      {scannerOpen && (
        <Suspense fallback={null}>
          <QRCodeScanner
            mission={mission}
            instantDeliveryOnMatch={false}
            onClose={() => setScannerOpen(false)}
            onValidated={handleQrValidated}
          />
        </Suspense>
      )}
    </div>
  );
}
