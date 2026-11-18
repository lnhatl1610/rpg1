import React, { useState } from 'react';
import { Camera, Download, Pause, Play, Smile, X } from 'lucide-react';
import { AvatarExpression, PhotoPose } from '../types';

interface Props {
  onPoseChange: (pose: PhotoPose) => void;
  onExpressionChange: (expr: AvatarExpression) => void;
  onLensChange: (fov: number, vignette: number, panX: number, panY: number) => void;
  onFreezeChange: (frozen: boolean) => void;
  onCapture: () => void;
  onClose: () => void;
}

const POSES: Array<{ id: PhotoPose; label: string }> = [
  { id: 'none', label: 'Tự Nhiên' },
  { id: 'breeze', label: 'Đón Gió' },
  { id: 'peace', label: 'Dáng Chữ V' },
  { id: 'stargaze', label: 'Ngắm Trời' },
  { id: 'twirl', label: 'Khiêu Vũ' },
  { id: 'float', label: 'Tiên Nữ' },
];

const EXPRESSIONS: Array<{ id: AvatarExpression; label: string }> = [
  { id: 'happy', label: 'Mỉm Cười' },
  { id: 'relaxed', label: 'Dịu Dàng' },
  { id: 'wink', label: 'Nháy Mắt' },
  { id: 'surprised', label: 'Long Lanh' },
  { id: 'neutral', label: 'Thanh Tao' },
];

export const PhotoModePanel: React.FC<Props> = ({
  onPoseChange,
  onExpressionChange,
  onLensChange,
  onFreezeChange,
  onCapture,
  onClose,
}) => {
  const [pose, setPose] = useState<PhotoPose>('peace');
  const [expr, setExpr] = useState<AvatarExpression>('happy');
  const [fov, setFov] = useState(40);
  const [vignette, setVignette] = useState(0.22);
  const [panX, setPanX] = useState(0);
  const [frozen, setFrozen] = useState(false);

  const pickPose = (p: PhotoPose) => {
    setPose(p);
    onPoseChange(p);
  };

  const pickExpr = (e: AvatarExpression) => {
    setExpr(e);
    onExpressionChange(e);
  };

  const updateLens = (nextFov: number, nextVig: number, nextPanX: number) => {
    setFov(nextFov);
    setVignette(nextVig);
    setPanX(nextPanX);
    onLensChange(nextFov, nextVig, nextPanX, 0);
  };

  const toggleFreeze = () => {
    const next = !frozen;
    setFrozen(next);
    onFreezeChange(next);
  };

  return (
    <div className="celestial-panel pointer-auto">
      <div className="panel-header">
        <div className="panel-title">
          <Camera size={17} />
          <span>Máy Ảnh Tinh Tú</span>
        </div>
        <button className="panel-close" onClick={onClose} title="Thoát chế độ chụp">
          <X size={18} />
        </button>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Tư thế nhân vật</span>
        </div>
        <div className="seg-row">
          {POSES.map((p) => (
            <button
              key={p.id}
              className={`seg-btn ${pose === p.id ? 'selected' : ''}`}
              onClick={() => pickPose(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>
            <Smile size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Biểu cảm gương mặt
          </span>
        </div>
        <div className="seg-row">
          {EXPRESSIONS.map((item) => (
            <button
              key={item.id}
              className={`seg-btn ${expr === item.id ? 'selected' : ''}`}
              onClick={() => pickExpr(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Tiêu cự ống kính (FOV)</span>
          <span className="field-val">{fov}°</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={24}
          max={75}
          step={1}
          value={fov}
          onChange={(e) => updateLens(Number(e.target.value), vignette, panX)}
        />
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Bố cục lệch khung hình</span>
          <span className="field-val">{panX.toFixed(2)}m</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={-0.8}
          max={0.8}
          step={0.05}
          value={panX}
          onChange={(e) => updateLens(fov, vignette, Number(e.target.value))}
        />
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Viền tối nghệ thuật (Vignette)</span>
          <span className="field-val">{Math.round(vignette * 100)}%</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={0}
          max={0.65}
          step={0.02}
          value={vignette}
          onChange={(e) => updateLens(fov, Number(e.target.value), panX)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button
          className={`seg-btn ${frozen ? 'selected' : ''}`}
          style={{ flex: 1, padding: '9px' }}
          onClick={toggleFreeze}
        >
          {frozen ? <Play size={14} style={{ verticalAlign: -2, marginRight: 5 }} /> : <Pause size={14} style={{ verticalAlign: -2, marginRight: 5 }} />}
          {frozen ? 'Tiếp tục gió' : 'Đóng băng khoảnh khắc'}
        </button>
      </div>

      <button className="primary-gold-btn" onClick={onCapture}>
        <Download size={16} />
        <span>Chụp & Tải Ảnh PNG Sắc Nét</span>
      </button>
    </div>
  );
};
