import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { MissionCard } from '../components/MissionCard';
import { useCourierApp } from '../context/CourierAppContext';
import { formatFcfa, MISSION_STATUS_META } from '../lib/missionWorkflow';

interface HistoryPageProps {
  onSelectMission: (missionId: string) => void;
}

type HistoryFilter = 'all' | 'delivered' | 'issues' | 'cancelled';

const HISTORY_FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'delivered', label: 'Livrées' },
  { id: 'issues', label: 'Échecs & Retours' },
  { id: 'cancelled', label: 'Annulées' },
];

export function HistoryPage({ onSelectMission }: HistoryPageProps) {
  const { missions } = useCourierApp();
  const [filter, setFilter] = useState<HistoryFilter>('all');

  const closedMissions = useMemo(
    () => missions.filter((m) => !MISSION_STATUS_META[m.status].isActive),
    [missions]
  );

  const summary = useMemo(() => {
    const delivered = closedMissions.filter((m) => m.status === 'DELIVERED');
    const issues = closedMissions.filter(
      (m) => m.status === 'FAILED' || m.status === 'RETURN_REQUIRED'
    );
    const totalCod = delivered
      .filter((m) => m.paymentMode === 'cod')
      .reduce((acc, m) => acc + m.codAmount, 0);
    const totalFees = delivered.reduce((acc, m) => acc + m.estimatedFee, 0);

    return {
      deliveredCount: delivered.length,
      issuesCount: issues.length,
      totalCod,
      totalFees,
    };
  }, [closedMissions]);

  const filtered = useMemo(() => {
    return closedMissions.filter((m) => {
      if (filter === 'delivered') return m.status === 'DELIVERED';
      if (filter === 'issues') return m.status === 'FAILED' || m.status === 'RETURN_REQUIRED';
      if (filter === 'cancelled') return m.status === 'CANCELLED';
      return true;
    });
  }, [closedMissions, filter]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-[#141413] tracking-tight">Historique</h1>
        <p className="text-sm text-[#5A5851] mt-0.5">
          Courses clôturées, preuves de remise et récapitulatif des encaissements.
        </p>
      </div>

      {/* Historical KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-medium text-[#5A5851]">Livrées</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#0E6E2D] tabular-nums">
            {summary.deliveredCount}
          </p>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-medium text-[#5A5851]">Échecs / Retours</p>
          <p className="mt-1.5 font-mono text-2xl font-bold text-[#C6241B] tabular-nums">
            {summary.issuesCount}
          </p>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-medium text-[#5A5851]">COD encaissé</p>
          <p className="mt-1.5 font-mono text-lg sm:text-xl font-bold text-[#141413] tabular-nums">
            {formatFcfa(summary.totalCod)}
          </p>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4">
          <p className="text-xs font-medium text-[#5A5851]">Rémunération estimée</p>
          <p className="mt-1.5 font-mono text-lg sm:text-xl font-bold text-[#141413] tabular-nums">
            {formatFcfa(summary.totalFees)}
          </p>
        </div>
      </section>

      {/* Filter Segmented Bar */}
      <div
        role="tablist"
        aria-label="Filtrer l'historique"
        className="flex items-center gap-1 p-1 bg-[#EFECE4] rounded-xl overflow-x-auto"
      >
        {HISTORY_FILTERS.map((opt) => {
          const active = filter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(opt.id)}
              className={`flex-1 min-h-[40px] px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-white text-[#0E6E2D] shadow-xs'
                  : 'text-[#5A5851] hover:text-[#141413]'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Historical List */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-10 text-center">
          <History className="w-9 h-9 text-[#5A5851] mx-auto mb-3" aria-hidden="true" />
          <p className="text-base font-bold text-[#141413]">Aucune course clôturée</p>
          <p className="text-sm text-[#5A5851] mt-1">
            Vos livraisons terminées apparaîtront ici avec leurs preuves de remise.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
          {filtered.map((mission) => (
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
