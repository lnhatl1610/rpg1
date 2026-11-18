export type QualityPreset = 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  preset: QualityPreset;
  renderScale: number;
  sharpness: number;
  bloomIntensity: number;
  grassCount: number;
  msaaSamples: number;
  outlineThickness: number;
  infiniteStamina: boolean;
}

export type FlightMode = 'grounded' | 'jumping' | 'gliding' | 'flying';

export type AvatarExpression = 'neutral' | 'happy' | 'relaxed' | 'wink' | 'surprised';

export type PhotoPose = 'none' | 'breeze' | 'peace' | 'stargaze' | 'twirl' | 'float';

export interface LandmarkInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  type: 'tree' | 'island' | 'lake' | 'shrine' | 'updraft';
}

export interface HUDState {
  fps: number;
  playerPos: { x: number; y: number; z: number };
  playerHeading: number;
  cameraHeading: number;
  altitude: number;
  speed: number;
  flightMode: FlightMode;
  isBoosting: boolean;
  stamina: number;
  timeOfDay: number;
  autoTimeFlow: boolean;
  nearUpdraft: boolean;
  currentRegionName: string;
  avatarLoaded: boolean;
  avatarName: string;
  audioEnabled: boolean;
}

export const QUALITY_PRESETS: Record<QualityPreset, Omit<GraphicsSettings, 'infiniteStamina'>> = {
  medium: {
    preset: 'medium',
    renderScale: 1.0,
    sharpness: 0.45,
    bloomIntensity: 0.32,
    grassCount: 75000,
    msaaSamples: 2,
    outlineThickness: 1.0,
  },
  high: {
    preset: 'high',
    renderScale: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1.5, 1.65),
    sharpness: 0.58,
    bloomIntensity: 0.36,
    grassCount: 145000,
    msaaSamples: 4,
    outlineThickness: 1.0,
  },
  ultra: {
    preset: 'ultra',
    renderScale: Math.min(typeof window !== 'undefined' ? Math.max(window.devicePixelRatio, 1.75) : 2.0, 2.0),
    sharpness: 0.68,
    bloomIntensity: 0.4,
    grassCount: 220000,
    msaaSamples: 8,
    outlineThickness: 1.0,
  },
};

export interface TimeSessionDef {
  id: string;
  label: string;
  shortLabel: string;
  subtitle: string;
  hour: number;
}

export const TIME_SESSIONS: TimeSessionDef[] = [
  { id: 'predawn',   label: 'Tinh Mơ (04:50)',    shortLabel: 'Tinh Mơ',    subtitle: 'Sương Sớm Sao Mai',      hour: 4.85  },
  { id: 'dawn',      label: 'Bình Minh (06:20)',  shortLabel: 'Bình Minh',  subtitle: 'Nắng Hồng Anh Đào',      hour: 6.33  },
  { id: 'morning',   label: 'Ban Mai (08:30)',    shortLabel: 'Ban Mai',    subtitle: 'Trời Xanh Trong Trẻo',   hour: 8.50  },
  { id: 'noon',      label: 'Giữa Trưa (12:00)',  shortLabel: 'Giữa Trưa',  subtitle: 'Nắng Rực Thiên Thanh',   hour: 12.00 },
  { id: 'afternoon', label: 'Xế Chiều (15:45)',   shortLabel: 'Xế Chiều',   subtitle: 'Nắng Mật Vàng Óng',      hour: 15.75 },
  { id: 'sunset',    label: 'Hoàng Hôn (17:40)',  shortLabel: 'Hoàng Hôn',  subtitle: 'Ráng Chiều Đỏ Rực',      hour: 17.67 },
  { id: 'twilight',  label: 'Chạng Vạng (18:35)', shortLabel: 'Chạng Vạng', subtitle: 'Giờ Chập Choạng Tím',    hour: 18.58 },
  { id: 'midnight',  label: 'Đêm Khuya (22:45)',  shortLabel: 'Đêm Khuya',  subtitle: 'Đêm Ngân Hà & Cực Quang', hour: 22.75 },
];

export function getActiveTimeSession(hour: number): TimeSessionDef {
  const h = ((hour % 24) + 24) % 24;
  let best = TIME_SESSIONS[0];
  let bestDist = 999;
  for (const s of TIME_SESSIONS) {
    let d = Math.abs(h - s.hour);
    if (d > 12) d = 24 - d;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}
