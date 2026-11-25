import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DeliveryMission, MissionStatus } from '../types/delivery';

interface DashboardChartProps {
  missions: DeliveryMission[];
}

interface DayMetric {
  key: string;
  shortLabel: string;
  fullLabel: string;
  delivered: number;
  issues: number;
  closed: number;
  successRate: number | null;
}

const ISSUE_STATUSES = new Set<MissionStatus>([
  'FAILED',
  'REFUSED',
  'RETURN_REQUIRED',
  'RETURNED',
]);

function getLocalDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: DayMetric;
  }>;
}

function DashboardChartTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-xl bg-white border border-[var(--color-jkx-border)] shadow-md px-3.5 py-2.5 text-xs space-y-1.5 min-w-[175px]">
      <p className="font-display font-bold text-[var(--color-jkx-ink)] capitalize">
        {point.fullLabel}
      </p>
      <div className="space-y-1 pt-1 border-t border-[var(--color-jkx-border)]">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-[var(--color-jkx-muted)]">
            <span
              className="w-2.5 h-2.5 rounded-[3px] shrink-0"
              style={{ backgroundColor: 'var(--color-jkx-green)' }}
            />
            Missions accomplies
          </span>
          <span className="font-mono font-bold text-[var(--color-jkx-ink)] tabular-nums">
            {point.delivered}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-[var(--color-jkx-muted)]">
            <span
              className="w-2.5 h-0.5 rounded-full shrink-0"
              style={{ backgroundColor: 'var(--color-jkx-yellow)' }}
            />
            Taux de succès
          </span>
          <span className="font-mono font-bold text-[var(--color-jkx-yellow-ink)] tabular-nums">
            {point.successRate !== null ? `${point.successRate} %` : '—'}
          </span>
        </div>

        {point.issues > 0 && (
          <div className="flex items-center justify-between gap-4 pt-1 border-t border-[var(--color-jkx-border)]/70">
            <span className="text-[var(--color-jkx-muted)]">Échecs / Retours</span>
            <span className="font-mono font-semibold text-[var(--color-jkx-red)] tabular-nums">
              {point.issues}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardChart({ missions }: DashboardChartProps) {
  const { dailyData, totalDelivered, totalIssues, overallSuccessRate } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const shortDayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
    const fullDayFormatter = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });

    const buckets: DayMetric[] = [];
    const bucketMap = new Map<string, DayMetric>();

    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const key = getLocalDayKey(date);
      const rawShort = shortDayFormatter.format(date).replace(/\.$/, '');
      const shortLabel =
        offset === 0
          ? 'Auj.'
          : rawShort.charAt(0).toUpperCase() + rawShort.slice(1, 3);

      const bucket: DayMetric = {
        key,
        shortLabel,
        fullLabel:
          offset === 0
            ? `Aujourd’hui · ${fullDayFormatter.format(date)}`
            : fullDayFormatter.format(date),
        delivered: 0,
        issues: 0,
        closed: 0,
        successRate: null,
      };
      buckets.push(bucket);
      bucketMap.set(key, bucket);
    }

    for (const mission of missions) {
      const isDelivered = mission.status === 'DELIVERED';
      const isIssue = ISSUE_STATUSES.has(mission.status);
      if (!isDelivered && !isIssue) continue;

      const timestamp = mission.updatedAtIso || mission.createdAtIso;
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) continue;

      const bucket = bucketMap.get(getLocalDayKey(parsed));
      if (!bucket) continue;

      if (isDelivered) {
        bucket.delivered += 1;
      } else {
        bucket.issues += 1;
      }
      bucket.closed += 1;
    }

    let deliveredSum = 0;
    let issuesSum = 0;

    for (const bucket of buckets) {
      deliveredSum += bucket.delivered;
      issuesSum += bucket.issues;
      bucket.successRate =
        bucket.closed > 0 ? Math.round((bucket.delivered / bucket.closed) * 100) : null;
    }

    const totalClosed = deliveredSum + issuesSum;
    const rate = totalClosed > 0 ? Math.round((deliveredSum / totalClosed) * 100) : null;

    return {
      dailyData: buckets,
      totalDelivered: deliveredSum,
      totalIssues: issuesSum,
      overallSuccessRate: rate,
    };
  }, [missions]);

  const hasWeeklyActivity = totalDelivered + totalIssues > 0;

  return (
    <section
      aria-label="Performance hebdomadaire des livraisons"
      className="bg-white border border-[var(--color-jkx-border)] rounded-2xl p-5 sm:p-6 space-y-5"
    >
      {/* Header + Summary Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-jkx-ink)] tracking-tight">
            Performance de la semaine
          </h2>
          <p className="text-xs sm:text-sm text-[var(--color-jkx-muted)] mt-0.5">
            Missions accomplies sur les 7 derniers jours et taux de succès quotidien
          </p>
        </div>

        <div className="flex items-center gap-6 sm:gap-7">
          <div>
            <p className="text-xs font-medium text-[var(--color-jkx-muted)]">Accomplies (7 j.)</p>
            <p className="font-mono text-xl sm:text-2xl font-bold text-[var(--color-jkx-green)] tabular-nums leading-tight mt-0.5">
              {totalDelivered}
            </p>
          </div>
          <div className="h-8 w-px bg-[var(--color-jkx-border)]" aria-hidden="true" />
          <div>
            <p className="text-xs font-medium text-[var(--color-jkx-muted)]">Taux de succès</p>
            <p
              className="font-mono text-xl sm:text-2xl font-bold tabular-nums leading-tight mt-0.5"
              style={{
                color:
                  overallSuccessRate === null
                    ? 'var(--color-jkx-muted)'
                    : 'var(--color-jkx-yellow-ink)',
              }}
            >
              {overallSuccessRate !== null ? `${overallSuccessRate} %` : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Clean Legend Row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-[var(--color-jkx-muted)]">
        <span className="inline-flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-[3px] shrink-0"
            style={{ backgroundColor: 'var(--color-jkx-green)' }}
          />
          <span>Missions accomplies</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="w-4 h-0.5 rounded-full shrink-0"
            style={{ backgroundColor: 'var(--color-jkx-yellow)' }}
          />
          <span>Taux de succès (%)</span>
        </span>
      </div>

      {/* Chart Canvas or Empty State */}
      {hasWeeklyActivity ? (
        <div className="w-full h-[230px] sm:h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={dailyData}
              margin={{ top: 10, right: 4, left: -18, bottom: 0 }}
              barCategoryGap="24%"
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--color-jkx-border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="shortLabel"
                axisLine={false}
                tickLine={false}
                tick={{
                  fill: 'var(--color-jkx-muted)',
                  fontSize: 12,
                  fontWeight: 500,
                }}
                dy={8}
              />
              <YAxis
                yAxisId="count"
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{
                  fill: 'var(--color-jkx-muted)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <YAxis
                yAxisId="rate"
                orientation="right"
                domain={[0, 100]}
                ticks={[0, 50, 100]}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value: number) => `${value}%`}
                tick={{
                  fill: 'var(--color-jkx-yellow-ink)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                }}
                width={42}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-jkx-canvas)', opacity: 0.75 }}
                content={<DashboardChartTooltip />}
              />
              <Bar
                yAxisId="count"
                dataKey="delivered"
                name="Missions accomplies"
                fill="var(--color-jkx-green)"
                maxBarSize={30}
                radius={[6, 6, 0, 0]}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="successRate"
                name="Taux de succès"
                stroke="var(--color-jkx-yellow)"
                strokeWidth={2.5}
                connectNulls
                dot={{
                  r: 4,
                  fill: 'var(--color-jkx-yellow)',
                  stroke: '#FFFFFF',
                  strokeWidth: 2,
                }}
                activeDot={{
                  r: 6,
                  fill: 'var(--color-jkx-yellow-ink)',
                  stroke: '#FFFFFF',
                  strokeWidth: 2,
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="rounded-xl bg-[var(--color-jkx-canvas)] border border-[var(--color-jkx-border)] p-8 text-center">
          <BarChart3
            className="w-8 h-8 text-[var(--color-jkx-muted)] mx-auto mb-2.5"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold text-[var(--color-jkx-ink)]">
            Aucune livraison clôturée cette semaine
          </p>
          <p className="text-xs text-[var(--color-jkx-muted)] mt-1">
            Le graphique se mettra à jour automatiquement dès vos premières livraisons terminées.
          </p>
        </div>
      )}
    </section>
  );
}
