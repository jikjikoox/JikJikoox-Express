import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Clock,
  Compass,
  Navigation,
  RefreshCw,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react';
import { useCourierApp } from '../context/CourierAppContext';
import { formatDateShortFr, MISSION_STATUS_META, VEHICLE_LABELS } from '../lib/missionWorkflow';
import { expressApi, ExpressApiError } from '../services/expressApi';
import type { AdminFleetDriverPosition } from '../types/delivery';

const DAKAR_CENTER: [number, number] = [14.7167, -17.4677];

function buildSafePopupNode(driver: AdminFleetDriverPosition): HTMLElement {
  const root = document.createElement('div');
  root.style.fontFamily = 'Plus Jakarta Sans, system-ui, sans-serif';
  root.style.minWidth = '190px';

  const nameEl = document.createElement('p');
  nameEl.style.fontWeight = '700';
  nameEl.style.fontSize = '13px';
  nameEl.style.margin = '0 0 2px 0';
  nameEl.style.color = '#141413';
  nameEl.textContent = driver.driverName;
  root.appendChild(nameEl);

  const metaEl = document.createElement('p');
  metaEl.style.fontSize = '11px';
  metaEl.style.margin = '0 0 6px 0';
  metaEl.style.color = '#5A5851';
  metaEl.textContent = `${VEHICLE_LABELS[driver.vehicleType] || driver.vehicleType} · ${driver.workZone}`;
  root.appendChild(metaEl);

  if (driver.orderNumber) {
    const orderEl = document.createElement('p');
    orderEl.style.fontSize = '11px';
    orderEl.style.fontWeight = '600';
    orderEl.style.margin = '0 0 4px 0';
    orderEl.style.color = '#0E6E2D';
    const statusLabel = driver.deliveryStatus
      ? MISSION_STATUS_META[driver.deliveryStatus]?.label || driver.deliveryStatus
      : 'En mission';
    orderEl.textContent = `${driver.orderNumber} — ${statusLabel}`;
    root.appendChild(orderEl);
  }

  const speedKmh =
    typeof driver.speedMps === 'number' ? Math.round(driver.speedMps * 3.6) : null;
  const statsEl = document.createElement('p');
  statsEl.style.fontSize = '11px';
  statsEl.style.margin = '0';
  statsEl.style.color = '#5A5851';
  const parts: string[] = [];
  if (speedKmh !== null) parts.push(`${speedKmh} km/h`);
  if (typeof driver.accuracyMeters === 'number') parts.push(`±${driver.accuracyMeters} m`);
  parts.push(`MAJ ${formatDateShortFr(driver.recordedAtIso)}`);
  statsEl.textContent = parts.join(' · ');
  root.appendChild(statsEl);

  return root;
}

function buildCourierMarkerIcon(isSelected: boolean, hasActiveMission: boolean): L.DivIcon {
  const bg = hasActiveMission ? '#0E6E2D' : '#8A5600';
  const ring = isSelected ? '0 0 0 4px rgba(14,110,45,0.28)' : '0 2px 6px rgba(20,20,19,0.25)';
  return L.divIcon({
    className: 'jikjikoox-fleet-marker',
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${bg};border:2.5px solid #ffffff;box-shadow:${ring};display:flex;align-items:center;justify-content:center;color:#ffffff;font-weight:800;font-size:11px;font-family:Plus Jakarta Sans,sans-serif;">JK</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function buildDemoFleetPositions(
  courierName: string,
  liveFix: { lat: number; lng: number; accuracyMeters: number | null; speedMps: number | null; recordedAtIso: string } | null
): AdminFleetDriverPosition[] {
  const nowIso = new Date().toISOString();
  return [
    {
      driverId: 'demo-driver-1',
      driverFirebaseUid: 'demo-courier-dakar-001',
      driverName: courierName || 'Mamadou Diop',
      driverPhone: '+221 77 412 89 30',
      vehicleType: 'scooter',
      workZone: 'Dakar Plateau',
      isAvailable: true,
      activeDeliveryId: 'mis_demo_001',
      orderNumber: 'JKX-2026-8412',
      deliveryStatus: 'IN_TRANSIT',
      deliveryZone: 'Plateau — Av. Léopold Sédar Senghor',
      lat: liveFix?.lat ?? 14.6696,
      lng: liveFix?.lng ?? -17.4381,
      accuracyMeters: liveFix?.accuracyMeters ?? 14,
      speedMps: liveFix?.speedMps ?? 7.8,
      headingDeg: 112,
      recordedAtIso: liveFix?.recordedAtIso ?? nowIso,
      updatedAtIso: liveFix?.recordedAtIso ?? nowIso,
    },
    {
      driverId: 'demo-driver-2',
      driverFirebaseUid: 'demo-courier-dakar-002',
      driverName: 'Cheikh Tidiane Sy',
      driverPhone: '+221 77 620 14 08',
      vehicleType: 'moto',
      workZone: 'Almadies / Ngor',
      isAvailable: true,
      activeDeliveryId: 'mis_demo_almadies',
      orderNumber: 'JKX-2026-8419',
      deliveryStatus: 'ARRIVED',
      deliveryZone: 'Almadies — Route de Ngor',
      lat: 14.7453,
      lng: -17.5138,
      accuracyMeters: 18,
      speedMps: 0.4,
      headingDeg: 240,
      recordedAtIso: new Date(Date.now() - 45_000).toISOString(),
      updatedAtIso: new Date(Date.now() - 45_000).toISOString(),
    },
    {
      driverId: 'demo-driver-3',
      driverFirebaseUid: 'demo-courier-dakar-003',
      driverName: 'Ousmane Faye',
      driverPhone: '+221 76 501 22 91',
      vehicleType: 'tricycle',
      workZone: 'Mermoz / Sacré-Cœur',
      isAvailable: true,
      activeDeliveryId: 'mis_demo_mermoz',
      orderNumber: 'JKX-2026-8425',
      deliveryStatus: 'PICKED_UP',
      deliveryZone: 'Mermoz — Pyrotechnie',
      lat: 14.7064,
      lng: -17.4709,
      accuracyMeters: 22,
      speedMps: 5.2,
      headingDeg: 45,
      recordedAtIso: new Date(Date.now() - 95_000).toISOString(),
      updatedAtIso: new Date(Date.now() - 95_000).toISOString(),
    },
  ];
}

export function AdminFleetMapPage() {
  const { mode, backendConnected, firebaseUser, isAdminUser, profile, gpsTracker } = useCourierApp();

  const [drivers, setDrivers] = useState<AdminFleetDriverPosition[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);
  const [lastRefreshedIso, setLastRefreshedIso] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markerMapRef = useRef<Map<string, L.Marker>>(new Map());

  const courierFullName = profile ? `${profile.firstName} ${profile.lastName}` : 'Mamadou Diop';

  const loadFleetPositions = useCallback(async () => {
    if (mode === 'demo' || !backendConnected) {
      const demoList = buildDemoFleetPositions(courierFullName, gpsTracker.lastFix);
      setDrivers(demoList);
      setAccessDeniedMessage(null);
      setLastRefreshedIso(new Date().toISOString());
      return;
    }

    if (!firebaseUser) return;
    setLoading(true);
    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await expressApi.fetchAdminFleetLocations(idToken);
      setDrivers(res.drivers);
      setAccessDeniedMessage(null);
      setLastRefreshedIso(res.generatedAtIso);
    } catch (err) {
      if (err instanceof ExpressApiError && err.status === 403) {
        setAccessDeniedMessage(err.message);
        setDrivers([]);
      } else {
        setAccessDeniedMessage(
          err instanceof ExpressApiError
            ? err.message
            : 'Impossible de charger les positions GPS de la flotte.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [mode, backendConnected, firebaseUser, courierFullName, gpsTracker.lastFix]);

  // Chargement initial + rafraîchissement automatique toutes les 15 secondes
  useEffect(() => {
    void loadFleetPositions();
    const timer = window.setInterval(() => {
      void loadFleetPositions();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [loadFleetPositions]);

  // Initialisation de la carte Leaflet + OpenStreetMap
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DAKAR_CENTER,
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const layerGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    markersLayerRef.current = layerGroup;

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      markerMapRef.current.clear();
    };
  }, []);

  // Synchronisation des marqueurs Leaflet avec les dernières positions GPS
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    markerMapRef.current.clear();

    drivers.forEach((driver) => {
      const isSelected = driver.driverId === selectedDriverId;
      const marker = L.marker([driver.lat, driver.lng], {
        icon: buildCourierMarkerIcon(isSelected, Boolean(driver.activeDeliveryId)),
      });

      marker.bindPopup(buildSafePopupNode(driver));
      marker.on('click', () => setSelectedDriverId(driver.driverId));
      marker.addTo(layer);
      markerMapRef.current.set(driver.driverId, marker);

      if (typeof driver.accuracyMeters === 'number' && driver.accuracyMeters > 0) {
        L.circle([driver.lat, driver.lng], {
          radius: Math.min(driver.accuracyMeters, 250),
          color: '#0E6E2D',
          weight: 1,
          fillColor: '#0E6E2D',
          fillOpacity: 0.1,
        }).addTo(layer);
      }
    });
  }, [drivers, selectedDriverId]);

  const handleFocusDriver = (driver: AdminFleetDriverPosition) => {
    setSelectedDriverId(driver.driverId);
    const map = mapRef.current;
    const marker = markerMapRef.current.get(driver.driverId);
    if (map) {
      map.flyTo([driver.lat, driver.lng], 15, { duration: 0.6 });
    }
    if (marker) {
      marker.openPopup();
    }
  };

  const activeMissionCount = useMemo(
    () => drivers.filter((d) => Boolean(d.activeDeliveryId)).length,
    [drivers]
  );

  if (mode === 'firebase' && !isAdminUser && accessDeniedMessage) {
    return (
      <section className="bg-white border border-[#E5E2D9] rounded-2xl p-8 text-center max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-xl bg-[#FDF0EE] text-[#C6241B] flex items-center justify-center mx-auto mb-3">
          <ShieldAlert className="w-6 h-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-extrabold text-[#141413]">Accès administrateur requis</h1>
        <p className="text-sm text-[#5A5851] mt-2 leading-relaxed">{accessDeniedMessage}</p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#141413] tracking-tight">
            Suivi GPS de la flotte
          </h1>
          <p className="text-sm text-[#5A5851] mt-0.5">
            {mode === 'demo'
              ? 'Visualisation démonstration Dakar (votre position GPS réelle s’affiche si autorisée).'
              : 'Dernières positions vérifiées des livreurs en mission active.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadFleetPositions()}
          disabled={loading}
          className="min-h-[44px] px-4 rounded-xl bg-white border border-[#D6D1C4] hover:bg-[#ECF7EE] hover:border-[#0E6E2D]/30 text-sm font-semibold text-[#141413] inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#ECF7EE] text-[#0E6E2D] flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#5A5851]">Livreurs géolocalisés</p>
            <p className="font-mono text-xl font-bold text-[#141413] tabular-nums">
              {drivers.length}
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FEF6E4] text-[#8A5600] flex items-center justify-center shrink-0">
            <Navigation className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#5A5851]">En mission active</p>
            <p className="font-mono text-xl font-bold text-[#141413] tabular-nums">
              {activeMissionCount}
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#E5E2D9] rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#F7F6F2] text-[#5A5851] flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#5A5851]">Dernière synchronisation</p>
            <p className="text-sm font-bold text-[#141413] truncate tabular-nums">
              {lastRefreshedIso ? formatDateShortFr(lastRefreshedIso) : 'En cours…'}
            </p>
          </div>
        </div>
      </div>

      {/* Interactive Map + Active Couriers Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden">
          <div
            ref={mapContainerRef}
            aria-label="Carte en temps réel des livreurs JikJikoox Express"
            className="w-full h-[380px] sm:h-[460px] z-0"
          />
          <div className="px-4 py-3 border-t border-[#E5E2D9] flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A5851]">
            <span className="inline-flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-[#0E6E2D]" aria-hidden="true" />
              Suivi limité aux livreurs connectés et en mission active.
            </span>
            <span>Actualisation auto : 15 s</span>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-[#E5E2D9] rounded-2xl overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[#E5E2D9] flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#141413]">Livreurs sur la carte</h2>
            <span className="font-mono text-xs font-semibold text-[#5A5851] tabular-nums">
              {drivers.length}
            </span>
          </div>

          {drivers.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#5A5851]">
              Aucun livreur ne transmet de position GPS active pour le moment.
            </div>
          ) : (
            <div className="divide-y divide-[#E5E2D9] max-h-[450px] overflow-y-auto">
              {drivers.map((driver) => {
                const isSelected = driver.driverId === selectedDriverId;
                const speedKmh =
                  typeof driver.speedMps === 'number' ? Math.round(driver.speedMps * 3.6) : null;
                return (
                  <button
                    key={driver.driverId}
                    type="button"
                    onClick={() => handleFocusDriver(driver)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#ECF7EE]/70' : 'hover:bg-[#F7F6F2]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#141413] truncate">
                          {driver.driverName}
                        </p>
                        <p className="text-xs text-[#5A5851] flex items-center gap-1 mt-0.5">
                          <Truck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">
                            {VEHICLE_LABELS[driver.vehicleType] || driver.vehicleType} ·{' '}
                            {driver.workZone}
                          </span>
                        </p>
                      </div>
                      {driver.orderNumber && (
                        <span className="font-mono text-[11px] font-bold text-[#0E6E2D] whitespace-nowrap shrink-0 tabular-nums">
                          {driver.orderNumber}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5A5851] tabular-nums">
                      <span className="font-mono">
                        {driver.lat.toFixed(4)}, {driver.lng.toFixed(4)}
                      </span>
                      <span>
                        {speedKmh !== null ? `${speedKmh} km/h · ` : ''}
                        {formatDateShortFr(driver.recordedAtIso)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
