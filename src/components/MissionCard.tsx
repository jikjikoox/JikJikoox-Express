import { Banknote, ChevronRight, MapPin, Package } from 'lucide-react';
import { formatFcfa, formatTimeFr } from '../lib/missionWorkflow';
import type { DeliveryMission } from '../types/delivery';
import { StatusIndicator } from './StatusIndicator';

interface MissionCardProps {
  mission: DeliveryMission;
  onSelect: (missionId: string) => void;
}

export function MissionCard({ mission, onSelect }: MissionCardProps) {
  const isCod = mission.paymentMode === 'cod' && mission.codAmount > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(mission.missionId)}
      className="w-full text-left bg-white border border-[#E4EAE6] hover:border-[#0F6B3E]/40 active:scale-[0.99] rounded-2xl p-4 sm:p-5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F6B3E]"
    >
      {/* Top row: Order ID + Status */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 text-xs text-[#586860] min-w-0">
          <span className="font-mono font-semibold text-[#111915] tabular-nums">
            {mission.orderNumber}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{formatTimeFr(mission.createdAtIso)}</span>
        </div>
        <StatusIndicator status={mission.status} compact />
      </div>

      {/* Customer & Destination */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[#111915] truncate">
            {mission.customerName}
          </h3>
          <p className="text-sm text-[#586860] flex items-start gap-1.5 mt-1 leading-snug">
            <MapPin className="w-4 h-4 text-[#0F6B3E] shrink-0 mt-0.5" aria-hidden="true" />
            <span className="line-clamp-2">
              <span className="font-medium text-[#111915]">{mission.deliveryZone}</span> —{' '}
              {mission.deliveryAddress}
            </span>
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-[#586860] shrink-0 mt-1" aria-hidden="true" />
      </div>

      {/* Bottom hairline meta row: Items + Payment/COD */}
      <div className="pt-3 border-t border-[#E4EAE6] flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-[#586860] font-medium">
          <Package className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="tabular-nums">
            {mission.itemCount} article{mission.itemCount > 1 ? 's' : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate max-w-[150px] sm:max-w-[200px]">{mission.pickupName}</span>
        </span>

        {isCod ? (
          <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#7A5600] bg-[#FEF7E0] px-2.5 py-1 rounded-lg tabular-nums">
            <Banknote className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            À encaisser : {formatFcfa(mission.codAmount)}
          </span>
        ) : (
          <span className="font-medium text-[#0F6B3E]">Payée en ligne</span>
        )}
      </div>
    </button>
  );
}
