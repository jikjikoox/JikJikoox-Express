import type { MissionStatus, NotificationCategory, VehicleType } from '../types/delivery';

export interface StatusMeta {
  status: MissionStatus;
  label: string;
  shortLabel: string;
  tone: 'green' | 'yellow' | 'red' | 'neutral';
  stepIndex: number; // 0..6 for active workflow, -1 for exception/terminal
  isTerminal: boolean;
  isActive: boolean;
}

export const MISSION_STATUS_META: Record<MissionStatus, StatusMeta> = {
  ASSIGNED: {
    status: 'ASSIGNED',
    label: 'Affectée',
    shortLabel: 'Affectée',
    tone: 'yellow',
    stepIndex: 0,
    isTerminal: false,
    isActive: true,
  },
  ACCEPTED: {
    status: 'ACCEPTED',
    label: 'Acceptée',
    shortLabel: 'Acceptée',
    tone: 'green',
    stepIndex: 1,
    isTerminal: false,
    isActive: true,
  },
  PREPARING: {
    status: 'PREPARING',
    label: 'En préparation',
    shortLabel: 'Préparation',
    tone: 'yellow',
    stepIndex: 2,
    isTerminal: false,
    isActive: true,
  },
  PICKED_UP: {
    status: 'PICKED_UP',
    label: 'Colis récupéré',
    shortLabel: 'Récupéré',
    tone: 'green',
    stepIndex: 3,
    isTerminal: false,
    isActive: true,
  },
  IN_TRANSIT: {
    status: 'IN_TRANSIT',
    label: 'En route',
    shortLabel: 'En route',
    tone: 'green',
    stepIndex: 4,
    isTerminal: false,
    isActive: true,
  },
  ARRIVED: {
    status: 'ARRIVED',
    label: 'Arrivé chez le client',
    shortLabel: 'Arrivé',
    tone: 'yellow',
    stepIndex: 5,
    isTerminal: false,
    isActive: true,
  },
  DELIVERED: {
    status: 'DELIVERED',
    label: 'Livrée',
    shortLabel: 'Livrée',
    tone: 'green',
    stepIndex: 6,
    isTerminal: true,
    isActive: false,
  },
  REFUSED: {
    status: 'REFUSED',
    label: 'Refusée',
    shortLabel: 'Refusée',
    tone: 'red',
    stepIndex: -1,
    isTerminal: true,
    isActive: false,
  },
  FAILED: {
    status: 'FAILED',
    label: 'Échec de livraison',
    shortLabel: 'Échec',
    tone: 'red',
    stepIndex: -1,
    isTerminal: false,
    isActive: false,
  },
  RETURN_REQUIRED: {
    status: 'RETURN_REQUIRED',
    label: 'Retour nécessaire',
    shortLabel: 'Retour',
    tone: 'red',
    stepIndex: -1,
    isTerminal: false,
    isActive: false,
  },
  RETURNED: {
    status: 'RETURNED',
    label: 'Colis retourné',
    shortLabel: 'Retourné',
    tone: 'neutral',
    stepIndex: -1,
    isTerminal: true,
    isActive: false,
  },
  CANCELLED: {
    status: 'CANCELLED',
    label: 'Annulée',
    shortLabel: 'Annulée',
    tone: 'neutral',
    stepIndex: -1,
    isTerminal: true,
    isActive: false,
  },
};

export interface WorkflowAction {
  nextStatus: MissionStatus;
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  requiresProof?: boolean;
  requiresFailureReason?: boolean;
}

/**
 * Transitions autorisées — strictement synchronisées avec firestore.rules
 * et le futur backend de validation Supabase.
 */
export const ALLOWED_TRANSITIONS: Record<MissionStatus, WorkflowAction[]> = {
  ASSIGNED: [
    { nextStatus: 'ACCEPTED', label: 'Accepter la mission', variant: 'primary' },
  ],
  ACCEPTED: [
    { nextStatus: 'PICKED_UP', label: 'Colis récupéré', variant: 'primary' },
    { nextStatus: 'PREPARING', label: 'En préparation chez le marchand', variant: 'secondary' },
  ],
  PREPARING: [
    { nextStatus: 'PICKED_UP', label: 'Confirmer la récupération du colis', variant: 'primary' },
  ],
  PICKED_UP: [
    { nextStatus: 'IN_TRANSIT', label: 'Démarrer la livraison (En route)', variant: 'primary' },
  ],
  IN_TRANSIT: [
    { nextStatus: 'ARRIVED', label: 'Je suis arrivé chez le client', variant: 'primary' },
  ],
  ARRIVED: [
    {
      nextStatus: 'DELIVERED',
      label: 'Confirmer la livraison',
      variant: 'primary',
      requiresProof: true,
    },
    {
      nextStatus: 'FAILED',
      label: 'Signaler un échec',
      variant: 'danger',
      requiresFailureReason: true,
    },
  ],
  FAILED: [
    {
      nextStatus: 'RETURN_REQUIRED',
      label: 'Déclarer retour au point relais',
      variant: 'danger',
    },
  ],
  RETURN_REQUIRED: [
    {
      nextStatus: 'RETURNED',
      label: 'Confirmer colis retourné au marchand',
      variant: 'secondary',
    },
  ],
  DELIVERED: [],
  REFUSED: [],
  RETURNED: [],
  CANCELLED: [],
};

export function isTransitionAllowed(from: MissionStatus, to: MissionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].some((action) => action.nextStatus === to);
}

export const ACTIVE_WORKFLOW_STEPS: { status: MissionStatus; label: string }[] = [
  { status: 'ASSIGNED', label: 'Affectée' },
  { status: 'ACCEPTED', label: 'Acceptée' },
  { status: 'PICKED_UP', label: 'Récupéré' },
  { status: 'IN_TRANSIT', label: 'En route' },
  { status: 'ARRIVED', label: 'Arrivé' },
  { status: 'DELIVERED', label: 'Livrée' },
];

export const FAILURE_REASONS: string[] = [
  'Client injoignable après 3 appels',
  'Adresse introuvable ou incomplète',
  'Client absent au point de rendez-vous',
  'Refus du colis par le client',
  'Montant à encaisser non disponible',
];

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  moto: 'Moto 125cc',
  scooter: 'Scooter urbain',
  voiture: 'Voiture utilitaire',
  velo: 'Vélo cargo',
  tricycle: 'Tricycle motorisé',
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  assignment: 'Nouvelle affectation',
  modification: 'Modification de mission',
  cancellation: 'Annulation',
  instruction: 'Instruction client',
  operational: 'Note opérationnelle',
  confirmation: 'Livraison confirmée',
};

export const DAKAR_ZONES: string[] = [
  'Dakar Plateau',
  'Almadies & Ngor',
  'Mermoz & Sacré-Cœur',
  'Point E & Fann',
  'Ouakam & Yoff',
  'Parcelles Assainies',
  'Liberté 6 & Grand Yoff',
  'Pikine & Guédiawaye',
];

export function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(Math.round(amount))} FCFA`;
}

export function formatTimeFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateShortFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function maskPhoneNumber(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length < 6) return '•• ••• •• ••';
  const start = trimmed.slice(0, 7);
  const end = trimmed.slice(-2);
  return `${start} ••• •• ${end}`;
}
