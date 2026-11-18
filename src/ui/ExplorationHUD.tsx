import React from 'react';
import {
  Camera,
  Clock,
  Compass,
  EyeOff,
  Feather,
  MapPin,
  Moon,
  Sliders,
  Sun,
  Sunset,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getActiveTimeSession, HUDState, LandmarkInfo, TIME_SESSIONS } from '../types';

export type ActiveModal = 'none' | 'time' | 'photo' | 'graphics';

interface Props {
  hud: HUDState;
  landmarks: LandmarkInfo[];
  activeModal: ActiveModal;
  showBanner: boolean;
  onToggleFlight: () => void;
  onAnimateTime: (hour: number) => void;
  onSelectModal: (modal: ActiveModal) => void;
  onTriggerVrmUpload: () => void;
  onToggleAudio: () => void;
  onHideHud: () => void;
  onTeleport: (id: string) => void;
}

export const ExplorationHUD: React.FC<Props> = ({
  hud,
  landmarks,
  activeModal,
  showBanner,
  onToggleFlight,
  onAnimateTime,
  onSelectModal,
  onTriggerVrmUpload,
  onToggleAudio,
  onHideHud,
  onTeleport,
}) => {
  const activeSession = getActiveTimeSession(hud.timeOfDay);
  const mapScale = 0.56;
  const rotDeg = (hud.cameraHeading * 180) / Math.PI;
  const playerArrowDeg = ((hud.playerHeading - hud.cameraHeading) * 180) / Math.PI;

  const isFlying = hud.flightMode === 'flying' || hud.flightMode === 'gliding';
  const showStamina = isFlying || hud.stamina < 99;
  const staminaDash = 132 * (hud.stamina / 100);

  return (
    <div className="hud-layer">
      {/* Top-Left: Genshin Rotating Celestial Minimap & Telemetry */}
      <div className="top-left-cluster pointer-auto">
        <div className="minimap-wrapper" title="Bản đồ khám phá (Bấm địa danh để dịch chuyển)">
          <span className="minimap-cardinal n">N</span>
          <span className="minimap-cardinal s">S</span>
          <span className="minimap-cardinal e">E</span>
          <span className="minimap-cardinal w">W</span>

          <svg width="100%" height="100%" viewBox="-74 -74 148 148" style={{ borderRadius: '50%' }}>
            <defs>
              <clipPath id="mapCircleClip">
                <circle cx={0} cy={0} r={70} />
              </clipPath>
            </defs>

            <g clipPath="url(#mapCircleClip)">
              {/* Meadow background */}
              <circle cx={0} cy={0} r={72} fill="#1f4d46" />

              {/* World features rotated by camera yaw */}
              <g transform={`rotate(${rotDeg})`}>
                {/* Starlight Lake */}
                <ellipse
                  cx={(-2 - hud.playerPos.x) * mapScale}
                  cy={(-20 - hud.playerPos.z) * mapScale}
                  rx={22 * mapScale}
                  ry={18 * mapScale}
                  fill="#2ec7d6"
                  opacity={0.78}
                />

                {/* Landmarks */}
                {landmarks.map((lm) => {
                  const lx = (lm.x - hud.playerPos.x) * mapScale;
                  const lz = (lm.z - hud.playerPos.z) * mapScale;
                  const dist = Math.hypot(lx, lz);
                  const clampedX = dist > 62 ? (lx / dist) * 62 : lx;
                  const clampedZ = dist > 62 ? (lz / dist) * 62 : lz;

                  const color =
                    lm.type === 'island'
                      ? '#ffe28a'
                      : lm.type === 'tree'
                      ? '#7cff9b'
                      : '#9beeff';

                  return (
                    <g
                      key={lm.id}
                      transform={`translate(${clampedX}, ${clampedZ})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onTeleport(lm.id)}
                    >
                      <circle r={4.4} fill={color} stroke="#101a2e" strokeWidth={1.2}>
                        <title>{`${lm.name} (Bấm để dịch chuyển)`}</title>
                      </circle>
                    </g>
                  );
                })}
              </g>

              {/* Camera FOV Wedge (always pointing Up on rotating minimap) */}
              <path
                d="M 0 0 L -24 -48 A 54 54 0 0 1 24 -48 Z"
                fill="rgba(255, 231, 173, 0.16)"
              />

              {/* Player Golden Arrow */}
              <g transform={`rotate(${180 - playerArrowDeg})`}>
                <polygon
                  points="0,-8 6,6 0,3 -6,6"
                  fill="#ffe7ad"
                  stroke="#182238"
                  strokeWidth={1.3}
                />
              </g>
            </g>
          </svg>
        </div>

        <div className="player-badge-col">
          <div className="genshin-pill">
            <span className="gold-dot">✦</span>
            <span>{hud.avatarName}</span>
          </div>
          <div className="telemetry-row">
            <span className="telemetry-tag">Độ cao: {Math.round(hud.altitude)}m</span>
            <span className="telemetry-tag">{hud.fps} FPS</span>
          </div>
          <div className="telemetry-row">
            <span className="telemetry-tag" style={{ color: '#ffe7ad' }}>
              <Compass size={11} style={{ verticalAlign: -1.5, marginRight: 4 }} />
              {hud.currentRegionName}
            </span>
          </div>
        </div>
      </div>

      {/* Top-Center: 8-Session Celestial Time Bar */}
      <div
        className="top-center-sessions pointer-auto"
        title="Chọn nhanh 8 buổi trong ngày (Phím N để chuyển buổi kế tiếp)"
      >
        {TIME_SESSIONS.map((s) => (
          <button
            key={s.id}
            className={`time-chip-btn ${activeSession.id === s.id ? 'active' : ''}`}
            onClick={() => onAnimateTime(s.hour)}
            title={`${s.label} — ${s.subtitle}`}
          >
            <span>{s.shortLabel}</span>
          </button>
        ))}
        <span className="key-hint-mini" style={{ marginLeft: 4, marginRight: 6 }}>
          N
        </span>
      </div>

      {/* Center Genshin Area Discovery Banner */}
      <div className={`region-banner ${showBanner ? '' : 'hidden'}`}>
        <div className="region-subtitle">Khu Vực Khám Phá</div>
        <div className="region-title-row">
          <span className="region-line" />
          <h1 className="region-title">{hud.currentRegionName}</h1>
          <span className="region-line" />
        </div>
      </div>

      {/* Top-Right Celestial Action Buttons */}
      <div className="top-right-bar pointer-auto">
        <button
          className={`celestial-fly-cta ${hud.flightMode === 'flying' ? 'flying-on' : ''}`}
          onClick={onToggleFlight}
          title="Bật / Tắt chế độ Bay Tự Do xuyên mây (Phím F)"
        >
          <Feather size={16} />
          <span>{hud.flightMode === 'flying' ? 'Đang Bay Trên Trời' : 'Cất Cánh Bay'}</span>
          <span className="key-hint-mini">F</span>
        </button>

        <button
          className={`celestial-icon-btn ${activeModal === 'time' ? 'active' : ''}`}
          onClick={() => onSelectModal(activeModal === 'time' ? 'none' : 'time')}
          title="Đồng hồ Thời gian Ngày / Hoàng hôn / Đêm sao (Phím T)"
        >
          <Clock size={18} />
        </button>

        <button
          className={`celestial-icon-btn ${activeModal === 'photo' ? 'active' : ''}`}
          onClick={() => onSelectModal(activeModal === 'photo' ? 'none' : 'photo')}
          title="Máy Ảnh Tinh Tú - Tạo dáng & Chụp ảnh PNG (Phím P)"
        >
          <Camera size={18} />
        </button>

        <button
          className="celestial-icon-btn"
          onClick={onTriggerVrmUpload}
          title="Đổi model nhân vật nữ Anime (.VRM bất kỳ)"
        >
          <Upload size={18} />
        </button>

        <button
          className={`celestial-icon-btn ${hud.audioEnabled ? 'active' : ''}`}
          onClick={onToggleAudio}
          title="Bật / Tắt tiếng gió đồng cỏ & đàn Harp thư giãn (Phím M)"
        >
          {hud.audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>

        <button
          className={`celestial-icon-btn ${activeModal === 'graphics' ? 'active' : ''}`}
          onClick={() => onSelectModal(activeModal === 'graphics' ? 'none' : 'graphics')}
          title="Độ sắc nét & Cài đặt đồ họa (Phím G)"
        >
          <Sliders size={18} />
        </button>

        <button
          className="celestial-icon-btn"
          onClick={onHideHud}
          title="Ẩn toàn bộ giao diện để ngắm cảnh (Phím H)"
        >
          <EyeOff size={18} />
        </button>
      </div>

      {/* Genshin Curved Wind Energy / Stamina Ring */}
      <div className="stamina-arc-box" style={{ opacity: showStamina ? 1 : 0 }}>
        <svg width={56} height={110} viewBox="0 0 56 110">
          <path
            d="M 14 14 A 44 44 0 0 1 14 96"
            fill="none"
            stroke="rgba(15, 24, 42, 0.55)"
            strokeWidth={6}
            strokeLinecap="round"
          />
          <path
            d="M 14 14 A 44 44 0 0 1 14 96"
            fill="none"
            stroke={hud.isBoosting ? '#7ceeff' : '#7ef7c4'}
            strokeWidth={4.2}
            strokeLinecap="round"
            strokeDasharray={`${staminaDash} 140`}
          />
        </svg>
      </div>

      {/* Updraft Toast */}
      {hud.nearUpdraft && hud.flightMode !== 'flying' && (
        <div className="updraft-toast">
          ✦ Luồng Gió Phong Thần — Nhấn <b>Space</b> để bung Cánh Ánh Sáng bay lên!
        </div>
      )}

      {/* Bottom-Left: Quick Scenic Landmark Teleport */}
      <div className="bottom-left-bar pointer-auto">
        <div className="quick-travel-label">✦ Dịch Chuyển Ngắm Cảnh Nhanh</div>
        <div className="quick-travel-list">
          {landmarks.map((lm) => (
            <button
              key={lm.id}
              className="landmark-chip"
              onClick={() => onTeleport(lm.id)}
            >
              <MapPin size={12} color="#ffe7ad" />
              <span>{lm.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom-Right: Clean Keybind Legend */}
      <div className="bottom-right-controls">
        <span className="ctrl-item">
          <span className="kbd">WASD</span> Di chuyển
        </span>
        <span className="ctrl-item">
          <span className="kbd">Kéo Chuột / Lăn</span> Xoay & Zoom nét mặt
        </span>
        <span className="ctrl-item">
          <span className="kbd">Space</span> Nhảy / Lượn
        </span>
        <span className="ctrl-item">
          <span className="kbd">F</span> Bay xuyên mây
        </span>
        <span className="ctrl-item">
          <span className="kbd">Shift</span> Boost lướt gió
        </span>
        {hud.flightMode === 'flying' && (
          <span className="ctrl-item">
            <span className="kbd">C</span> Hạ cánh
          </span>
        )}
      </div>
    </div>
  );
};
