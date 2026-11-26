import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  ImageUp,
  QrCode,
  RefreshCw,
  SwitchCamera,
  X,
} from 'lucide-react';
import {
  buildDemoParcelQrPayload,
  validateParcelQrForMission,
  type QrValidationSuccess,
} from '../lib/qrParcelValidation';
import type { DeliveryMission } from '../types/delivery';

interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

export interface QRCodeScannerProps {
  mission: DeliveryMission;
  instantDeliveryOnMatch?: boolean;
  onClose: () => void;
  onValidated: (result: QrValidationSuccess) => void | Promise<void>;
  codPaymentMode?: boolean;
  onCodPayload?: (rawPayload: string) => void | Promise<void>;
}

type CameraStatus = 'starting' | 'active' | 'error' | 'matched';

/**
 * Scanner QR code natif basé sur navigator.mediaDevices.getUserMedia()
 * avec décodage hybride BarcodeDetector + jsQR, torche, inversion de caméra
 * et import d'image en secours pour valider instantanément l'ID d'une mission.
 */
export function QRCodeScanner({
  mission,
  instantDeliveryOnMatch = false,
  onClose,
  onValidated,
  codPaymentMode = false,
  onCodPayload,
}: QRCodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanMsRef = useRef<number>(0);
  const frameCounterRef = useRef<number>(0);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const lockedRef = useRef<boolean>(false);
  const mismatchTimerRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [mismatchMessage, setMismatchMessage] = useState<string | null>(null);
  const [matchedResult, setMatchedResult] = useState<QrValidationSuccess | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const handleDecodedPayload = useCallback(
    async (rawValue: string) => {
      if (lockedRef.current) return;
      if (codPaymentMode) {
        lockedRef.current = true;
        setMismatchMessage(null);
        setFinalizing(true);
        stopCamera();
        try {
          await onCodPayload?.(rawValue);
          onClose();
        } catch (error) {
          setMismatchMessage(error instanceof Error ? error.message : "QR de paiement refusé.");
          lockedRef.current = false;
          setCameraStatus("active");
          void startCamera();
        } finally {
          setFinalizing(false);
        }
        return;
      }
      const result = validateParcelQrForMission(rawValue, mission);

      if (!result.ok) {
        lockedRef.current = true;
        setMismatchMessage(result.message);
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([110, 50, 110]);
        }
        if (mismatchTimerRef.current !== null) {
          window.clearTimeout(mismatchTimerRef.current);
        }
        mismatchTimerRef.current = window.setTimeout(() => {
          setMismatchMessage(null);
          lockedRef.current = false;
        }, 2400);
        return;
      }

      lockedRef.current = true;
      setMismatchMessage(null);
      setMatchedResult(result);
      setCameraStatus('matched');
      stopCamera();

      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([45, 30, 65]);
      }

      setFinalizing(true);
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 480));
        await onValidated(result);
      } finally {
        setFinalizing(false);
      }
    },
    [mission, onValidated, codPaymentMode, onCodPayload, onClose, stopCamera, startCamera]
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    lockedRef.current = false;
    setCameraError(null);
    setMismatchMessage(null);
    setCameraStatus('starting');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error');
      setCameraError(
        'Votre navigateur ne permet pas l’accès direct à la caméra. Utilisez « Importer photo QR » ci-dessous.'
      );
      return;
    }

    if (!detectorRef.current && typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor })
          .BarcodeDetector;
        detectorRef.current = new Ctor({ formats: ['qr_code'] });
      } catch {
        detectorRef.current = null;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
        const caps = videoTrack.getCapabilities() as MediaTrackCapabilities & {
          torch?: boolean;
        };
        setTorchSupported(Boolean(caps.torch));
      }

      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }

      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      setCameraStatus('active');

      const scanFrame = async (timestamp: number) => {
        if (!streamRef.current || lockedRef.current) {
          if (streamRef.current) {
            rafRef.current = requestAnimationFrame(scanFrame);
          }
          return;
        }

        if (timestamp - lastScanMsRef.current >= 130) {
          lastScanMsRef.current = timestamp;
          const v = videoRef.current;

          if (v && v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) {
            let decodedText: string | null = null;

            if (detectorRef.current) {
              try {
                const hits = await detectorRef.current.detect(v);
                const firstVal = hits.find((h) => h.rawValue)?.rawValue;
                if (firstVal) decodedText = firstVal;
              } catch {
                detectorRef.current = null;
              }
            }

            if (!decodedText && canvasRef.current) {
              const canvas = canvasRef.current;
              const targetWidth = Math.min(640, v.videoWidth);
              const scale = targetWidth / v.videoWidth;
              const targetHeight = Math.round(v.videoHeight * scale);

              if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                canvas.width = targetWidth;
                canvas.height = targetHeight;
              }

              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0, targetWidth, targetHeight);
                const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
                frameCounterRef.current += 1;
                const inversion =
                  frameCounterRef.current % 4 === 0 ? 'attemptBoth' : 'dontInvert';
                const qr = jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: inversion,
                });
                if (qr?.data) {
                  decodedText = qr.data;
                }
              }
            }

            if (decodedText) {
              void handleDecodedPayload(decodedText);
              return;
            }
          }
        }

        if (streamRef.current) {
          rafRef.current = requestAnimationFrame(scanFrame);
        }
      };

      rafRef.current = requestAnimationFrame(scanFrame);
    } catch (err) {
      stopCamera();
      setCameraStatus('error');
      const errorName = err instanceof Error ? err.name : '';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setCameraError(
          'Accès caméra refusé. Autorisez la caméra dans votre navigateur ou importez une photo du QR code.'
        );
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setCameraError(
          'Aucune caméra détectée sur cet appareil. Vous pouvez importer une photo du QR code.'
        );
      } else {
        setCameraError(
          'Impossible de démarrer la caméra. Réessayez ou importez une photo du QR code de la mission.'
        );
      }
    }
  }, [facingMode, handleDecodedPayload, stopCamera]);

  useEffect(() => {
    void startCamera();
    return () => {
      if (mismatchTimerRef.current !== null) {
        window.clearTimeout(mismatchTimerRef.current);
      }
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !finalizing) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [finalizing, onClose]);

  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const nextTorch = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorch } as MediaTrackConstraintSet],
      });
      setTorchOn(nextTorch);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleSwitchCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Image illisible'));
        img.src = objectUrl;
      });

      const canvas = canvasRef.current || document.createElement('canvas');
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      URL.revokeObjectURL(objectUrl);

      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (!qr?.data) {
        setMismatchMessage(
          'Aucun QR code détecté sur cette photo. Cadrez nettement l’étiquette du colis.'
        );
        return;
      }

      await handleDecodedPayload(qr.data);
    } catch {
      setMismatchMessage('Impossible de lire cette image. Essayez une autre photo plus nette.');
    }
  };

  const handleDemoSimulateScan = () => {
    void handleDecodedPayload(buildDemoParcelQrPayload(mission));
  };

  const frameBorderColor =
    cameraStatus === 'matched'
      ? 'border-[#2F9428]'
      : mismatchMessage
      ? 'border-[#C6241B]'
      : 'border-[#F4A61D]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#141413]/85 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
    >
      <div className="w-full h-full sm:h-auto sm:max-w-lg bg-[#141413] text-white sm:rounded-3xl overflow-hidden flex flex-col border border-white/10">
        {/* Top Bar */}
        <div className="px-4 py-3.5 bg-[#141413] border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-[#F4A61D] font-semibold tabular-nums truncate">
              {mission.orderNumber} · {mission.missionId}
            </p>
            <h2 id="qr-scanner-title" className="text-base font-bold text-white truncate">
              codPaymentMode ? "Scanner le QR de paiement COD" : "Validation rapide par QR code"
            </h2>
          </div>

          <button
            type="button"
            disabled={finalizing}
            onClick={onClose}
            aria-label="Fermer le scanner"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="relative flex-1 min-h-[340px] sm:min-h-[380px] bg-black overflow-hidden flex items-center justify-center">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className={`w-full h-full object-cover ${
              cameraStatus === 'active' ? 'opacity-100' : 'opacity-20'
            } transition-opacity duration-200`}
          />
          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

          {(cameraStatus === 'active' || cameraStatus === 'starting') && (
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
              <div className="relative w-60 h-60 sm:w-64 sm:h-64">
                <span
                  className={`absolute top-0 left-0 w-9 h-9 border-t-4 border-l-4 rounded-tl-2xl ${frameBorderColor} transition-colors`}
                />
                <span
                  className={`absolute top-0 right-0 w-9 h-9 border-t-4 border-r-4 rounded-tr-2xl ${frameBorderColor} transition-colors`}
                />
                <span
                  className={`absolute bottom-0 left-0 w-9 h-9 border-b-4 border-l-4 rounded-bl-2xl ${frameBorderColor} transition-colors`}
                />
                <span
                  className={`absolute bottom-0 right-0 w-9 h-9 border-b-4 border-r-4 rounded-br-2xl ${frameBorderColor} transition-colors`}
                />

                {cameraStatus === 'active' && !mismatchMessage && (
                  <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-0.5 bg-[#F4A61D]/80 shadow-[0_0_12px_rgba(244,166,29,0.75)]" />
                )}
              </div>

              <div className="mt-5 px-3.5 py-2 rounded-xl bg-black/75 text-center max-w-xs">
                <p className="text-xs font-medium text-white leading-snug">
                  {cameraStatus === 'starting'
                    ? 'Activation de la caméra arrière...'
                    : instantDeliveryOnMatch
                    ? 'Cadrez le QR code du colis pour vérifier l’ID de mission et valider la livraison.'
                    : 'Cadrez le QR code de l’étiquette JikJikoox pour vérifier la mission.'}
                </p>
              </div>
            </div>
          )}

          {mismatchMessage && cameraStatus !== 'matched' && (
            <div className="absolute inset-x-4 bottom-4 rounded-2xl bg-[#C6241B] text-white p-3.5 shadow-lg flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1 text-xs leading-relaxed">
                <p className="font-bold">ID de mission non concordant</p>
                <p className="text-white/95 mt-0.5">{mismatchMessage}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMismatchMessage(null);
                  lockedRef.current = false;
                }}
                className="min-h-[36px] px-2.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
              >
                Réessayer
              </button>
            </div>
          )}

          {cameraStatus === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#141413]/95">
              <div className="w-14 h-14 rounded-2xl bg-[#FEF6E4]/15 text-[#F4A61D] flex items-center justify-center mb-3">
                <Camera className="w-7 h-7" aria-hidden="true" />
              </div>
              <p className="text-base font-bold text-white">Caméra indisponible</p>
              <p className="text-sm text-white/80 mt-1.5 max-w-sm leading-relaxed">
                {cameraError}
              </p>
              <button
                type="button"
                onClick={() => void startCamera()}
                className="mt-4 min-h-[44px] px-4 rounded-xl bg-white/15 hover:bg-white/25 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                Réessayer la caméra
              </button>
            </div>
          )}

          {cameraStatus === 'matched' && matchedResult && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#0E6E2D]/95">
              <div className="w-16 h-16 rounded-2xl bg-white/20 text-white flex items-center justify-center mb-3">
                <CheckCircle2 className="w-9 h-9" aria-hidden="true" />
              </div>
              <p className="text-lg font-extrabold text-white">Mission validée</p>
              <p className="font-mono text-sm font-semibold text-[#FEF6E4] mt-1 tabular-nums">
                {matchedResult.displayRef}
              </p>
              <p className="text-xs text-white/90 mt-2">
                {instantDeliveryOnMatch
                  ? 'Enregistrement instantané de la livraison...'
                  : 'Identifiant vérifié, retour au formulaire de remise...'}
              </p>
            </div>
          )}
        </div>

        {/* Bottom Thumb-Zone Controls */}
        <div className="p-4 bg-[#141413] border-t border-white/10 space-y-2.5 pb-safe">
          <div className="flex items-center gap-2">
            {torchSupported && cameraStatus === 'active' && (
              <button
                type="button"
                onClick={() => void handleToggleTorch()}
                className={`min-h-[46px] px-3.5 rounded-xl font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  torchOn
                    ? 'bg-[#F4A61D] text-[#141413]'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                {torchOn ? (
                  <FlashlightOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Flashlight className="w-4 h-4" aria-hidden="true" />
                )}
                <span>Torche</span>
              </button>
            )}

            {cameraStatus === 'active' && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                className="min-h-[46px] px-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <SwitchCamera className="w-4 h-4" aria-hidden="true" />
                <span>Caméra</span>
              </button>
            )}

            <button
              type="button"
              disabled={finalizing}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <ImageUp className="w-4 h-4" aria-hidden="true" />
              <span>Importer photo QR</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void handleImageUpload(e)}
              className="hidden"
            />
          </div>

          {mission.dataSource === 'local_demo' && cameraStatus !== 'matched' && (
            <button
              type="button"
              disabled={finalizing}
              onClick={handleDemoSimulateScan}
              className="w-full min-h-[46px] px-4 rounded-xl bg-[#0E6E2D] hover:bg-[#095220] text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <QrCode className="w-4 h-4" aria-hidden="true" />
              <span>Simuler le scan QR de la mission (Démo)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default QRCodeScanner;
