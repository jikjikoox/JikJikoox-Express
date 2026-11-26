import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Camera,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import { FAILURE_REASONS, formatFcfa } from '../lib/missionWorkflow';
import type { QrValidationSuccess } from '../lib/qrParcelValidation';
import type { DeliveryMission, ProofSubmission } from '../types/delivery';

const QRCodeScanner = lazy(() =>
  import('./QRCodeScanner').then((m) => ({
    default: m.QRCodeScanner,
  }))
);

const ALLOWED_PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

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
  const { gpsTracker, uploadDeliveryProofPhoto } = useCourierApp();
  const isCod = mission.paymentMode === 'cod' && mission.codAmount > 0;

  const [recipientName, setRecipientName] = useState(mission.customerName);
  const [proofCode, setProofCode] = useState(initialQrValidation?.proofCodeValue ?? '');
  const [proofNote, setProofNote] = useState(initialQrValidation?.verificationNote ?? '');
  const [codConfirmed, setCodConfirmed] = useState(!isCod);
  const [qrValidation, setQrValidation] = useState<QrValidationSuccess | null>(
    initialQrValidation
  );
  const [scannerOpen, setScannerOpen] = useState(false);

  // État Photo de preuve de livraison (caméra ou galerie)
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploadStage, setUploadStage] = useState<
    null | 'preparing' | 'uploading' | 'confirming' | 'finalizing'
  >(null);

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedReason, setSelectedReason] = useState(FAILURE_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Nettoyage propre de l'URL blob d'aperçu
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  const handlePhotoSelected = (fileList: FileList | null) => {
    setPhotoError(null);
    const file = fileList?.[0];
    if (!file) return;

    if (!ALLOWED_PHOTO_MIMES.has(file.type)) {
      setPhotoError('Format non pris en charge. Utilisez uniquement JPEG, PNG ou WebP.');
      return;
    }
    if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) {
      setPhotoError('La photo dépasse 5 Mo. Réduisez la résolution ou reprenez la photo.');
      return;
    }

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemovePhoto = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setPhotoError(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  };

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

    setPhotoError(null);
    setSubmitting(true);

    try {
      let verifiedProofId: string | undefined;
      let verifiedStoragePath: string | undefined;
      let photoUploadVerified = false;

      if (photoFile) {
        const uploaded = await uploadDeliveryProofPhoto({
          deliveryId: mission.missionId,
          file: photoFile,
          recipientName: recipientName.trim(),
          proofCode: proofCode.trim() || undefined,
          proofNote: proofNote.trim() || undefined,
          codCollectedConfirmed: codConfirmed,
          onStageChange: (stage) => setUploadStage(stage),
        });
        verifiedProofId = uploaded.proofId;
        verifiedStoragePath = uploaded.storagePath;
        photoUploadVerified = uploaded.uploadVerified;
      }

      setUploadStage('finalizing');
      await onConfirmDelivery({
        recipientName: recipientName.trim(),
        proofCode: proofCode.trim() || undefined,
        proofNote: proofNote.trim() || undefined,
        codCollectedConfirmed: codConfirmed,
        proofId: verifiedProofId,
        photoStoragePath: verifiedStoragePath,
        photoUploadVerified,
        gpsLat: gpsTracker.lastFix?.lat,
        gpsLng: gpsTracker.lastFix?.lng,
      });
      onClose();
    } catch (err) {
      // Ne jamais clôturer la feuille ni prétendre que la photo est enregistrée en cas d'échec
      setPhotoError(
        err instanceof Error
          ? err.message
          : 'Échec de la transmission de la photo de preuve. Veuillez réessayer.'
      );
    } finally {
      setUploadStage(null);
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

  const submitLabel =
    uploadStage === 'preparing'
      ? 'Préparation sécurisée…'
      : uploadStage === 'uploading'
        ? 'Envoi de la photo…'
        : uploadStage === 'confirming'
          ? 'Vérification du stockage…'
          : uploadStage === 'finalizing' || submitting
            ? 'Validation de la livraison…'
            : 'Valider la livraison';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#141413]/50 backdrop-blur-[2px] p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-[#E5E2D9] max-h-[92vh] overflow-y-auto">
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
            disabled={submitting}
            onClick={onClose}
            aria-label="Fermer"
            className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-[#5A5851] hover:bg-[#F7F6F2] transition-colors cursor-pointer disabled:opacity-50"
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
                  disabled={submitting}
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
                disabled={submitting}
                onClick={() => setScannerOpen(true)}
                className="w-full min-h-[50px] px-4 rounded-xl border border-[#0E6E2D]/30 bg-[#ECF7EE] hover:bg-[#DFF1E3] text-[#0E6E2D] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <QrCode className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>Scanner le QR code du colis</span>
              </button>
            )}

            {/* Photo Proof of Delivery Capture / Upload Block */}
            <div className="rounded-xl border border-[#E5E2D9] bg-[#F7F6F2]/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-[#141413]">
                  Photo de preuve de livraison
                </p>
                <span className="text-[11px] font-medium text-[#5A5851]">
                  JPEG, PNG, WebP · 5 Mo max
                </span>
              </div>

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={(e) => handlePhotoSelected(e.target.files)}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handlePhotoSelected(e.target.files)}
              />

              {photoFile && photoPreviewUrl ? (
                <div className="space-y-2.5">
                  <div className="relative rounded-xl overflow-hidden border border-[#D6D1C4] bg-white">
                    <img
                      src={photoPreviewUrl}
                      alt="Aperçu de la preuve de livraison"
                      className="w-full h-44 object-cover"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-[#141413] font-medium truncate">
                      {photoFile.name} ·{' '}
                      <span className="font-mono text-[#5A5851]">
                        {formatFileSize(photoFile.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleRemovePhoto}
                      className="min-h-[36px] px-2.5 rounded-lg text-[#C6241B] hover:bg-[#FDF0EE] font-semibold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Retirer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => cameraInputRef.current?.click()}
                    className="min-h-[46px] px-3.5 rounded-xl bg-white border border-[#D6D1C4] hover:border-[#0E6E2D] hover:bg-[#ECF7EE]/50 text-[#141413] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-[#0E6E2D] shrink-0" aria-hidden="true" />
                    <span>Prendre une photo</span>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => galleryInputRef.current?.click()}
                    className="min-h-[46px] px-3.5 rounded-xl bg-white border border-[#D6D1C4] hover:border-[#0E6E2D] hover:bg-[#ECF7EE]/50 text-[#141413] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <ImageIcon className="w-4 h-4 text-[#5A5851] shrink-0" aria-hidden="true" />
                    <span>Choisir un fichier</span>
                  </button>
                </div>
              )}

              {photoError && (
                <div
                  role="alert"
                  className="rounded-lg bg-[#FDF0EE] border border-[#C6241B]/25 p-2.5 text-xs text-[#921A14] flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{photoError}</span>
                </div>
              )}
            </div>

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
                disabled={submitting}
                onClick={onClose}
                className="sm:w-1/3 min-h-[48px] px-4 rounded-xl border border-[#D6D1C4] text-[#141413] font-semibold text-sm hover:bg-[#F7F6F2] transition-colors cursor-pointer disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={submitting || !recipientName.trim() || (isCod && !codConfirmed)}
                className="sm:flex-1 min-h-[48px] px-4 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                )}
                <span>{submitLabel}</span>
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
                disabled={submitting}
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
