import { useMemo, useState } from 'react';
import { ClipboardList, Search, X } from 'lucide-react';
import { MissionCard } from '../components/MissionCard';
import { useCourierApp } from '../context/CourierAppContext';
import { MISSION_STATUS_META } from '../lib/missionWorkflow';

interface MissionsPageProps {
  onSelectMission: (missionId: string) => void;
}

type MissionFilter = 'active' | 'assigned' | 'all' | 'closed';

const FILTER_OPTIONS: { id: MissionFilter; label: string }[] = [
  { id: 'active', label: 'En cours' },
  { id: 'assigned', label: 'À accepter' },
  { id: 'closed', label: 'Terminées' },
  { id: 'all', label: 'Toutes' },
];

export function MissionsPage({ onSelectMission }: MissionsPageProps) {
  const { missions, loadingData } = useCourierApp();
  const [filter, setFilter] = useState<MissionFilter>('active');
  const [searchQuery, setSearchQuery] = useState('');

  const counts = useMemo(() => {
    const active = missions.filter((m) => MISSION_STATUS_META[m.status].isActive).length;
    const assigned = missions.filter((m) => m.status === 'ASSIGNED').length;
    const closed = missions.filter((m) => !MISSION_STATUS_META[m.status].isActive).length;
    return { active, assigned, closed, all: missions.length };
  }, [missions]);

  const filteredMissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return missions.filter((m) => {
      if (filter === 'active' && !MISSION_STATUS_META[m.status].isActive) return false;
      if (filter === 'assigned' && m.status !== 'ASSIGNED') return false;
      if (filter === 'closed' && MISSION_STATUS_META[m.status].isActive) return false;

      if (!q) return true;
      return (
        m.orderNumber.toLowerCase().includes(q) ||
        m.customerName.toLowerCase().includes(q) ||
        m.deliveryZone.toLowerCase().includes(q) ||
        m.deliveryAddress.toLowerCase().includes(q)
      );
    });
  }, [missions, filter, searchQuery]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#141413] tracking-tight">
            Mes missions
          </h1>
          <p className="text-sm text-[#5A5851] mt-0.5 tabular-nums">
            {counts.active} active{counts.active > 1 ? 's' : ''} · {counts.assigned} en attente
            d’acceptation
          </p>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search
            className="w-4 h-4 text-[#5A5851] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="N° commande, client, zone..."
            className="w-full min-h-[44px] pl-10 pr-9 rounded-xl bg-white border border-[#D6D1C4] text-sm text-[#141413] placeholder:text-[#5A5851] focus:outline-none focus:border-[#0E6E2D] focus:ring-2 focus:ring-[#0E6E2D]/15"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#5A5851] hover:text-[#141413] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Segmented Interactive Filter Bar */}
      <div
        role="tablist"
        aria-label="Filtrer les missions"
        className="flex items-center gap-1 p-1 bg-[#EFECE4] rounded-xl overflow-x-auto"
      >
        {FILTER_OPTIONS.map((opt) => {
          const isSelected = filter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setFilter(opt.id)}
              className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer tabular-nums ${
                isSelected
                  ? 'bg-white text-[#0E6E2D] shadow-xs'
                  : 'text-[#5A5851] hover:text-[#141413]'
              }`}
            >
              {opt.label} ({counts[opt.id]})
            </button>
          );
        })}
      </div>

      {/* Mission List */}
      {loadingData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 rounded-2xl bg-white border border-[#E5E2D9] animate-pulse"
            />
          ))}
        </div>
      ) : filteredMissions.length === 0 ? (
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-10 text-center">
          <ClipboardList className="w-9 h-9 text-[#5A5851] mx-auto mb-3" aria-hidden="true" />
          <h2 className="text-base font-bold text-[#141413]">Aucune mission dans cette vue</h2>
          <p className="text-sm text-[#5A5851] mt-1">
            {searchQuery
              ? 'Essayez un autre numéro de commande ou quartier de Dakar.'
              : 'Consultez un autre filtre ou attendez une nouvelle affectation.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
          {filteredMissions.map((mission) => (
            <MissionCard
              key={mission.missionId}
              mission={mission}
              onSelect={onSelectMission}
            />
          ))}
        </div>
      )}
    </div>
  );
}
