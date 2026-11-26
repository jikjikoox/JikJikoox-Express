import type { DeliveryMission } from '../types/delivery';

export interface ParsedParcelQr {
  raw: string;
  orderNumber?: string;
  missionId?: string;
  proofCode?: string;
}

export interface QrValidationSuccess {
  ok: true;
  matchedBy: 'orderNumber' | 'missionId';
  displayRef: string;
  proofCodeValue: string;
  verificationNote: string;
  scannedAtIso: string;
  rawPayload: string;
}

export interface QrValidationFailure {
  ok: false;
  scannedSummary: string;
  message: string;
}

export type QrValidationResult = QrValidationSuccess | QrValidationFailure;

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function sanitizeProofCode(value: string): string {
  return value.trim().slice(0, 32);
}

/**
 * Extrait les identifiants de colis depuis les principaux formats de QR code
 * utilisés sur les étiquettes JikJikoox Express :
 * - Référence brute : "JKX-2026-8412"
 * - Préfixe structuré : "JKX:JKX-2026-8412" ou "JKX|JKX-2026-8412|4829"
 * - URL de suivi : "https://livraison.jikjikoox.com/track/JKX-2026-8412?code=4829"
 * - JSON étiquette : {"orderNumber":"JKX-2026-8412","missionId":"...","code":"4829"}
 */
export function parseParcelQrPayload(rawPayload: string): ParsedParcelQr {
  const raw = rawPayload.trim();
  if (!raw) return { raw: '' };

  // 1. Format JSON
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const orderNumber =
        (typeof parsed.orderNumber === 'string' && parsed.orderNumber) ||
        (typeof parsed.order_number === 'string' && parsed.order_number) ||
        (typeof parsed.order === 'string' && parsed.order) ||
        (typeof parsed.ref === 'string' && parsed.ref) ||
        undefined;
      const missionId =
        (typeof parsed.missionId === 'string' && parsed.missionId) ||
        (typeof parsed.mission_id === 'string' && parsed.mission_id) ||
        (typeof parsed.deliveryId === 'string' && parsed.deliveryId) ||
        (typeof parsed.delivery_id === 'string' && parsed.delivery_id) ||
        undefined;
      const proofCode =
        (typeof parsed.proofCode === 'string' && parsed.proofCode) ||
        (typeof parsed.proof_code === 'string' && parsed.proof_code) ||
        (typeof parsed.code === 'string' && parsed.code) ||
        (typeof parsed.otp === 'string' && parsed.otp) ||
        undefined;

      return {
        raw,
        orderNumber: orderNumber?.trim() || undefined,
        missionId: missionId?.trim() || undefined,
        proofCode: proofCode?.trim() || undefined,
      };
    } catch {
      // Poursuit avec les autres analyseurs si le JSON est malformé
    }
  }

  // 2. Format URL (https://... ou jikjikoox://...)
  if (/^(https?:|jikjikoox:)/i.test(raw)) {
    try {
      const url = new URL(raw);
      const qOrder =
        url.searchParams.get('order') ||
        url.searchParams.get('orderNumber') ||
        url.searchParams.get('ref');
      const qMission =
        url.searchParams.get('missionId') ||
        url.searchParams.get('deliveryId') ||
        url.searchParams.get('id');
      const qCode =
        url.searchParams.get('code') ||
        url.searchParams.get('otp') ||
        url.searchParams.get('proofCode');

      const segments = url.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1];

      return {
        raw,
        orderNumber: (qOrder || lastSegment)?.trim() || undefined,
        missionId: qMission?.trim() || undefined,
        proofCode: qCode?.trim() || undefined,
      };
    } catch {
      // Poursuit avec les analyseurs texte
    }
  }

  // 3. Format délimité par "|" (ex: JKX|JKX-2026-8412|4829)
  if (raw.includes('|')) {
    const parts = raw
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2 && parts[0].toUpperCase() === 'JKX') {
      return {
        raw,
        orderNumber: parts[1],
        proofCode: parts[2],
      };
    }
  }

  // 4. Format préfixé "JKX:..." ou "ORDER:..."
  const prefixMatch = raw.match(/^(?:JKX|ORDER|COLIS|REF)\s*[:=#]\s*(.+)$/i);
  if (prefixMatch?.[1]) {
    return {
      raw,
      orderNumber: prefixMatch[1].trim(),
    };
  }

  // 5. Référence brute (numéro de commande ou ID de mission)
  return {
    raw,
    orderNumber: raw,
    missionId: raw,
  };
}

/**
 * Valide un QR code scanné par rapport à la mission de livraison en cours.
 * Empêche toute remise du mauvais colis.
 */
export function validateParcelQrForMission(
  rawPayload: string,
  mission: Pick<DeliveryMission, 'missionId' | 'orderNumber'>
): QrValidationResult {
  const parsed = parseParcelQrPayload(rawPayload);
  if (!parsed.raw) {
    return {
      ok: false,
      scannedSummary: 'QR vide',
      message: 'QR code illisible ou vide. Rapprochez l’étiquette du colis.',
    };
  }

  const expectedOrder = normalizeToken(mission.orderNumber);
  const expectedMissionId = normalizeToken(mission.missionId);

  const candidateOrder = parsed.orderNumber ? normalizeToken(parsed.orderNumber) : '';
  const candidateMission = parsed.missionId ? normalizeToken(parsed.missionId) : '';
  const normalizedRaw = normalizeToken(parsed.raw);

  let matchedBy: 'orderNumber' | 'missionId' | null = null;
  if (
    candidateOrder === expectedOrder ||
    normalizedRaw === expectedOrder ||
    normalizedRaw.includes(expectedOrder)
  ) {
    matchedBy = 'orderNumber';
  } else if (
    candidateMission === expectedMissionId ||
    normalizedRaw === expectedMissionId
  ) {
    matchedBy = 'missionId';
  }

  if (!matchedBy) {
    const scannedSummary = (parsed.orderNumber || parsed.missionId || parsed.raw).slice(0, 48);
    return {
      ok: false,
      scannedSummary,
      message: `Colis non concordant : QR scanné « ${scannedSummary} » au lieu de « ${mission.orderNumber} ».`,
    };
  }

  const scannedAtIso = new Date().toISOString();
  const timeLabel = new Date(scannedAtIso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const proofCodeValue = sanitizeProofCode(
    parsed.proofCode ? parsed.proofCode : `QR:${mission.orderNumber}`
  );

  return {
    ok: true,
    matchedBy,
    displayRef: mission.orderNumber,
    proofCodeValue,
    verificationNote: `Colis validé par scan QR (${mission.orderNumber}) à ${timeLabel}.`,
    scannedAtIso,
    rawPayload: parsed.raw,
  };
}

/**
 * Génère une charge utile QR réaliste pour les tests en mode Démonstration local uniquement.
 */
export function buildDemoParcelQrPayload(
  mission: Pick<DeliveryMission, 'missionId' | 'orderNumber'>
): string {
  return JSON.stringify({
    orderNumber: mission.orderNumber,
    missionId: mission.missionId,
    carrier: 'JikJikoox Express',
  });
}
