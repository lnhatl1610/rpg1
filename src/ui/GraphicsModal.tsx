import React from 'react';
import { Sliders, Sparkles, X } from 'lucide-react';
import { GraphicsSettings, QualityPreset } from '../types';

interface Props {
  settings: GraphicsSettings;
  onSelectPreset: (preset: QualityPreset) => void;
  onUpdate: (partial: Partial<GraphicsSettings>) => void;
  onClose: () => void;
}

export const GraphicsModal: React.FC<Props> = ({
  settings,
  onSelectPreset,
  onUpdate,
  onClose,
}) => {
  return (
    <div className="celestial-panel pointer-auto">
      <div className="panel-header">
        <div className="panel-title">
          <Sliders size={17} />
          <span>Độ Sắc Nét & Đồ Họa</span>
        </div>
        <button className="panel-close" onClick={onClose} title="Đóng">
          <X size={18} />
        </button>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Cấu hình tổng thể</span>
          <span className="field-val">{settings.preset.toUpperCase()}</span>
        </div>
        <div className="seg-row">
          <button
            className={`seg-btn ${settings.preset === 'medium' ? 'selected' : ''}`}
            onClick={() => onSelectPreset('medium')}
          >
            Mượt (Medium)
          </button>
          <button
            className={`seg-btn ${settings.preset === 'high' ? 'selected' : ''}`}
            onClick={() => onSelectPreset('high')}
          >
            Cao (High)
          </button>
          <button
            className={`seg-btn ${settings.preset === 'ultra' ? 'selected' : ''}`}
            onClick={() => onSelectPreset('ultra')}
          >
            Ultra Sắc Nét
          </button>
        </div>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Độ phân giải Render (Supersampling)</span>
          <span className="field-val">{settings.renderScale.toFixed(2)}x</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={0.85}
          max={2.0}
          step={0.05}
          value={settings.renderScale}
          onChange={(e) => onUpdate({ renderScale: Number(e.target.value) })}
        />
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Làm sắc sảo chi tiết (CAS Sharpen)</span>
          <span className="field-val">{Math.round(settings.sharpness * 100)}%</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={0}
          max={1.0}
          step={0.02}
          value={settings.sharpness}
          onChange={(e) => onUpdate({ sharpness: Number(e.target.value) })}
        />
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Độ long lanh ánh sáng (HDR Bloom)</span>
          <span className="field-val">{Math.round(settings.bloomIntensity * 100)}%</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={0}
          max={0.85}
          step={0.02}
          value={settings.bloomIntensity}
          onChange={(e) => onUpdate({ bloomIntensity: Number(e.target.value) })}
        />
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Mật độ thảm cỏ GPU</span>
          <span className="field-val">{(settings.grassCount / 1000).toFixed(0)}k ngọn</span>
        </div>
        <div className="seg-row">
          {[75000, 145000, 220000].map((cnt) => (
            <button
              key={cnt}
              className={`seg-btn ${settings.grassCount === cnt ? 'selected' : ''}`}
              onClick={() => onUpdate({ grassCount: cnt })}
            >
              {cnt / 1000}k
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Độ mảnh nét viền Anime (Outline)</span>
          <span className="field-val">{settings.outlineThickness.toFixed(2)}x</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={0}
          max={1.8}
          step={0.05}
          value={settings.outlineThickness}
          onChange={(e) => onUpdate({ outlineThickness: Number(e.target.value) })}
        />
      </div>

      <button
        className={`seg-btn ${settings.infiniteStamina ? 'selected' : ''}`}
        style={{ width: '100%', padding: '10px' }}
        onClick={() => onUpdate({ infiniteStamina: !settings.infiniteStamina })}
      >
        <Sparkles size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {settings.infiniteStamina
          ? 'Bay tự do vô hạn thể lực (Đang bật)'
          : 'Giới hạn thể lực kiểu Genshin'}
      </button>
    </div>
  );
};
