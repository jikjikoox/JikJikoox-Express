import {
  AlertCircle,
  CheckCircle2,
  Clock,
  MapPin,
  PackageCheck,
  RotateCcw,
  Truck,
  XCircle,
} from 'lucide-react';
import { MISSION_STATUS_META } from '../lib/missionWorkflow';
import type { MissionStatus } from '../types/delivery';

interface StatusIndicatorProps {
  status: MissionStatus;
  compact?: boolean;
}

const TONE_CLASSES: Record<'green' | 'yellow' | 'red' | 'neutral', string> = {
  green: 'text-[#0F6B3E]',
  yellow: 'text-[#9A6B00]',
  red: 'text-[#C82829]',
  neutral: 'text-[#586860]',
};

function StatusIcon({ status }: { status: MissionStatus }) {
  const cls = 'w-4 h-4 shrink-0';
  switch (status) {
    case 'ASSIGNED':
    case 'PREPARING':
      return <Clock className={cls} aria-hidden="true" />;
    case 'ACCEPTED':
    case 'PICKED_UP':
      return <PackageCheck className={cls} aria-hidden="true" />;
    case 'IN_TRANSIT':
      return <Truck className={cls} aria-hidden="true" />;
    case 'ARRIVED':
      return <MapPin className={cls} aria-hidden="true" />;
    case 'DELIVERED':
      return <CheckCircle2 className={cls} aria-hidden="true" />;
    case 'FAILED':
    case 'REFUSED':
      return <AlertCircle className={cls} aria-hidden="true" />;
    case 'RETURN_REQUIRED':
    case 'RETURNED':
      return <RotateCcw className={cls} aria-hidden="true" />;
    case 'CANCELLED':
      return <XCircle className={cls} aria-hidden="true" />;
  }
}

export function StatusIndicator({ status, compact = false }: StatusIndicatorProps) {
  const meta = MISSION_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap shrink-0 ${
        compact ? 'text-xs' : 'text-sm'
      } ${TONE_CLASSES[meta.tone]}`}
    >
      <StatusIcon status={status} />
      <span>{compact ? meta.shortLabel : meta.label}</span>
    </span>
  );
}
