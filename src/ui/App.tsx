import React, { useEffect, useRef, useState } from 'react';
import { Eye, Upload } from 'lucide-react';
import { CelestiaEngine } from '../core/Engine';
import {
  GraphicsSettings,
  HUDState,
  LandmarkInfo,
  QUALITY_PRESETS,
  QualityPreset,
} from '../types';
import { ActiveModal, ExplorationHUD } from './ExplorationHUD';
import { TimeWheelModal } from './TimeWheelModal';
import { PhotoModePanel } from './PhotoModePanel';
import { GraphicsModal } from './GraphicsModal';

const INITIAL_HUD: HUDState = {
  fps: 60,
  playerPos: { x: 0, y: 6, z: 18 },
  playerHeading: Math.PI,
  cameraHeading: 0,
  altitude: 0,
  speed: 0,
  flightMode: 'grounded',
  isBoosting: false,
  stamina: 100,
  timeOfDay: 9.85,
  autoTimeFlow: false,
  nearUpdraft: false,
  currentRegionName: 'Cánh Đồng Gió Phong Thần',
  avatarLoaded: false,
  avatarName: 'Lumine Windstrider',
  audioEnabled: false,
};

export const App: React.FC = () => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<CelestiaEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [hud, setHud] = useState<HUDState>(INITIAL_HUD);
  const [landmarks, setLandmarks] = useState<LandmarkInfo[]>([]);
  const [settings, setSettings] = useState<GraphicsSettings>({
    ...QUALITY_PRESETS.high,
    infiniteStamina: true,
  });

  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [hudHidden, setHudHidden] = useState(false);
  const [showRegionBanner, setShowRegionBanner] = useState(true);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const lastRegionRef = useRef<string>('');
  const bannerTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Clear any leftover canvas during HMR
    host.innerHTML = '';

    const engine = new CelestiaEngine(host, (nextHud) => {
      setHud(nextHud);

      if (nextHud.currentRegionName !== lastRegionRef.current) {
        lastRegionRef.current = nextHud.currentRegionName;
        setShowRegionBanner(true);
        if (bannerTimeoutRef.current) {
          window.clearTimeout(bannerTimeoutRef.current);
        }
        bannerTimeoutRef.current = window.setTimeout(() => {
          setShowRegionBanner(false);
        }, 3400);
      }
    });

    engineRef.current = engine;
    setLandmarks(engine.getLandmarks());
    setSettings({ ...engine.settings });

    return () => {
      if (bannerTimeoutRef.current) {
        window.clearTimeout(bannerTimeoutRef.current);
      }
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSelectModal = (next: ActiveModal) => {
    const eng = engineRef.current;
    if (activeModal === 'photo' && next !== 'photo') {
      eng?.setPhotoMode(false);
    }
    if (next === 'photo') {
      eng?.setPhotoMode(true);
      eng?.setPhotoPose('peace');
    }
    setActiveModal(next);
  };

  // Global UI hotkeys (T, P, G, M, H)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }

      if (e.code === 'KeyH') {
        setHudHidden((prev) => !prev);
      } else if (e.code === 'KeyT') {
        handleSelectModal(activeModal === 'time' ? 'none' : 'time');
      } else if (e.code === 'KeyP') {
        handleSelectModal(activeModal === 'photo' ? 'none' : 'photo');
      } else if (e.code === 'KeyG') {
        handleSelectModal(activeModal === 'graphics' ? 'none' : 'graphics');
      } else if (e.code === 'KeyM') {
        engineRef.current?.toggleAudio();
      } else if (e.code === 'KeyN') {
        engineRef.current?.toggleNightMode();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeModal]);

  // Drag & Drop .vrm support
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setIsDraggingFile(false);
      }
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingFile(false);
      const file = e.dataTransfer?.files?.[0];
      if (file && file.name.toLowerCase().endsWith('.vrm')) {
        await engineRef.current?.loadCustomVRM(file);
      }
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await engineRef.current?.loadCustomVRM(file);
      e.target.value = '';
    }
  };

  const handleSelectPreset = (preset: QualityPreset) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.applyPreset(preset);
    setSettings({ ...eng.settings });
  };

  const handleUpdateGraphics = (partial: Partial<GraphicsSettings>) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.updateGraphics(partial);
    setSettings({ ...eng.settings });
  };

  const handleCapturePhoto = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const dataUrl = eng.captureScreenshot();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `celestia-meadow-${Date.now()}.png`;
    a.click();
  };

  return (
    <>
      <div ref={hostRef} className="canvas-host" />

      <input
        ref={fileInputRef}
        type="file"
        accept=".vrm"
        hidden
        onChange={handleFilePicked}
      />

      {isDraggingFile && (
        <div className="dropzone-banner">
          <Upload size={42} color="#ffe7ad" />
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ffe7ad' }}>
            Thả file nhân vật Anime (.VRM) vào đây để thay đổi ngay!
          </div>
        </div>
      )}

      {hudHidden ? (
        <button
          className="celestial-icon-btn restore-hud-btn pointer-auto"
          onClick={() => setHudHidden(false)}
          title="Hiện lại giao diện (Phím H)"
        >
          <Eye size={18} />
        </button>
      ) : (
        <>
          <ExplorationHUD
            hud={hud}
            landmarks={landmarks}
            activeModal={activeModal}
            showBanner={showRegionBanner}
            onToggleFlight={() => engineRef.current?.flight.toggleFreeFlight()}
            onAnimateTime={(h) => engineRef.current?.animateToTime(h)}
            onSelectModal={handleSelectModal}
            onTriggerVrmUpload={() => fileInputRef.current?.click()}
            onToggleAudio={() => engineRef.current?.toggleAudio()}
            onHideHud={() => setHudHidden(true)}
            onTeleport={(id) => engineRef.current?.teleportToLandmark(id)}
          />

          {activeModal === 'time' && (
            <TimeWheelModal
              timeOfDay={hud.timeOfDay}
              autoFlow={hud.autoTimeFlow}
              onChangeTime={(h) => engineRef.current?.setTimeOfDay(h)}
              onToggleAuto={(auto) => engineRef.current?.setAutoTimeFlow(auto)}
              onClose={() => handleSelectModal('none')}
            />
          )}

          {activeModal === 'photo' && (
            <PhotoModePanel
              onPoseChange={(pose) => engineRef.current?.setPhotoPose(pose)}
              onExpressionChange={(expr) => engineRef.current?.setAvatarExpression(expr)}
              onLensChange={(fov, vig, px, py) =>
                engineRef.current?.setPhotoLens(fov, vig, px, py)
              }
              onFreezeChange={(frz) => engineRef.current?.setPhotoFreeze(frz)}
              onCapture={handleCapturePhoto}
              onClose={() => handleSelectModal('none')}
            />
          )}

          {activeModal === 'graphics' && (
            <GraphicsModal
              settings={settings}
              onSelectPreset={handleSelectPreset}
              onUpdate={handleUpdateGraphics}
              onClose={() => handleSelectModal('none')}
            />
          )}
        </>
      )}
    </>
  );
};
