export type MissionStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'REFUSED'
  | 'FAILED'
  | 'RETURN_REQUIRED'
  | 'RETURNED'
  | 'CANCELLED';

export type VehicleType = 'moto' | 'scooter' | 'voiture' | 'velo' | 'tricycle';

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'disabled';

export type DataSource = 'supabase_sync' | 'local_demo';

export type NotificationCategory =
  | 'assignment'
  | 'modification'
  | 'cancellation'
  | 'instruction'
  | 'operational'
  | 'confirmation';

export type AppTab =
  | 'dashboard'
  | 'missions'
  | 'fleet'
  | 'drivers'
  | 'history'
  | 'notifications'
  | 'profile'
  | 'finance';

export interface MissionItem {
  name: string;
  quantity: number;
  unit?: string;
}

export interface MissionEvent {
  status: MissionStatus;
  label: string;
  timestampIso: string;
  actor: 'system' | 'courier' | 'admin';
  note?: string;
}

export interface CourierProfile {
  uid: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoUrl?: string;
  vehicleType: VehicleType;
  vehiclePlate?: string;
  workZone: string;
  isAvailable: boolean;
  role: 'courier';
  accountStatus: AccountStatus;
  notificationsEnabled: boolean;
  pushSoundEnabled: boolean;
  fcmTokenStatus: 'unregistered' | 'pending' | 'registered';
  createdAtIso: string;
  updatedAtIso: string;
}

export interface DeliveryMission {
  missionId: string;
  orderNumber: string;
  courierId: string;
  dataSource: DataSource;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryZone: string;
  pickupName: string;
  pickupAddress: string;
  gpsLat?: number;
  gpsLng?: number;
  itemsSummary: MissionItem[];
  itemCount: number;
  paymentMode: 'cod' | 'prepaid';
  codAmount: number;
  estimatedFee: number;
  instructions: string;
  status: MissionStatus;
  proofCode?: string;
  proofNote?: string;
  recipientName?: string;
  failureReason?: string;
  events: MissionEvent[];
  createdAtIso: string;
  updatedAtIso: string;
}

export interface CourierNotification {
  notificationId: string;
  courierId: string;
  dataSource: DataSource;
  category: NotificationCategory;
  title: string;
  body: string;
  missionId?: string;
  isRead: boolean;
  createdAtIso: string;
  readAtIso?: string;
}

export interface ProofSubmission {
  recipientName: string;
  proofCode?: string;
  proofNote?: string;
  codCollectedConfirmed?: boolean;
  proofId?: string;
  photoStoragePath?: string;
  photoUploadVerified?: boolean;
  gpsLat?: number;
  gpsLng?: number;
}

export type GpsPermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface GpsPositionSnapshot {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  recordedAtIso: string;
}

export interface AdminFleetDriverPosition {
  driverId: string;
  driverFirebaseUid: string;
  driverName: string;
  driverPhone: string;
  vehicleType: VehicleType;
  workZone: string;
  isAvailable: boolean;
  activeDeliveryId: string | null;
  orderNumber: string | null;
  deliveryStatus: MissionStatus | null;
  deliveryZone: string | null;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  headingDeg: number | null;
  recordedAtIso: string;
  updatedAtIso: string;
}

export type PushSupportState =
  | 'ready'
  | 'permission_prompt'
  | 'permission_denied'
  | 'vapid_missing'
  | 'unsupported';

