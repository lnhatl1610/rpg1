import React from 'react';
import { Clock, Sparkles, X } from 'lucide-react';
import { getActiveTimeSession, TIME_SESSIONS } from '../types';

interface Props {
  timeOfDay: number;
  autoFlow: boolean;
  onChangeTime: (hour: number) => void;
  onToggleAuto: (auto: boolean) => void;
  onClose: () => void;
}

function formatClock(hour: number): string {
  const totalMins = Math.floor((((hour % 24) + 24) % 24) * 60);
  const hh = Math.floor(totalMins / 60)
    .toString()
    .padStart(2, '0');
  const mm = (totalMins % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export const TimeWheelModal: React.FC<Props> = ({
  timeOfDay,
  autoFlow,
  onChangeTime,
  onToggleAuto,
  onClose,
}) => {
  const angleRad = ((timeOfDay - 12) / 24) * Math.PI * 2 - Math.PI / 2;
  const orbX = 95 + Math.cos(angleRad) * 66;
  const orbY = 95 + Math.sin(angleRad) * 66;
  const isNight = timeOfDay < 5.6 || timeOfDay > 18.8;
  const activeSession = getActiveTimeSession(timeOfDay);

  const handleDialClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    let ang = Math.atan2(dy, dx) + Math.PI / 2;
    if (ang < 0) ang += Math.PI * 2;
    const pickedHour = ((ang / (Math.PI * 2)) * 24 + 12) % 24;
    onChangeTime(pickedHour);
  };

  return (
    <div className="celestial-panel pointer-auto">
      <div className="panel-header">
        <div className="panel-title">
          <Clock size={17} />
          <span>Đồng Hồ Thiên Văn (8 Buổi)</span>
        </div>
        <button className="panel-close" onClick={onClose} title="Đóng">
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <svg
          width={184}
          height={184}
          viewBox="0 0 190 190"
          onClick={handleDialClick}
          style={{ cursor: 'pointer' }}
        >
          <defs>
            <radialGradient id="dialGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(46, 68, 118, 0.55)" />
              <stop offset="100%" stopColor="rgba(14, 21, 38, 0.9)" />
            </radialGradient>
          </defs>
          <circle
            cx={95}
            cy={95}
            r={82}
            fill="url(#dialGrad)"
            stroke="#e3c383"
            strokeWidth={1.4}
          />
          <circle
            cx={95}
            cy={95}
            r={66}
            fill="none"
            stroke="rgba(227, 195, 131, 0.35)"
            strokeDasharray="3 4"
          />

          {Array.from({ length: 12 }).map((_, idx) => {
            const a = (idx / 12) * Math.PI * 2;
            const x1 = 95 + Math.cos(a) * 74;
            const y1 = 95 + Math.sin(a) * 74;
            const x2 = 95 + Math.cos(a) * 80;
            const y2 = 95 + Math.sin(a) * 80;
            return (
              <line
                key={idx}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#ffe7ad"
                strokeWidth={idx % 3 === 0 ? 2 : 1}
                opacity={idx % 3 === 0 ? 0.9 : 0.45}
              />
            );
          })}

          <line
            x1={95}
            y1={95}
            x2={orbX}
            y2={orbY}
            stroke="#ffe7ad"
            strokeWidth={1.6}
            opacity={0.75}
          />

          <text
            x={95}
            y={90}
            textAnchor="middle"
            fill="#ffe7ad"
            fontFamily="Cinzel, serif"
            fontSize={22}
            fontWeight={700}
          >
            {formatClock(timeOfDay)}
          </text>
          <text
            x={95}
            y={109}
            textAnchor="middle"
            fill="#ffffff"
            fontSize={11.5}
            fontWeight={600}
          >
            {activeSession.shortLabel}
          </text>
          <text
            x={95}
            y={124}
            textAnchor="middle"
            fill="rgba(248, 244, 234, 0.68)"
            fontSize={9.5}
          >
            {activeSession.subtitle}
          </text>

          <circle
            cx={orbX}
            cy={orbY}
            r={11}
            fill={isNight ? '#8ac2ff' : '#ffd875'}
            stroke="#ffffff"
            strokeWidth={1.5}
          />
        </svg>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Kéo chỉnh giờ tự do (24h)</span>
          <span className="field-val">{formatClock(timeOfDay)}</span>
        </div>
        <input
          className="gold-slider"
          type="range"
          min={0}
          max={23.95}
          step={0.05}
          value={timeOfDay}
          onChange={(e) => onChangeTime(parseFloat(e.target.value))}
        />
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Chọn nhanh 8 buổi trong ngày</span>
        </div>
        <div className="seg-row-2">
          {TIME_SESSIONS.map((s) => (
            <button
              key={s.id}
              className={`seg-btn ${activeSession.id === s.id ? 'selected' : ''}`}
              onClick={() => onChangeTime(s.hour)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <button
        className={`seg-btn ${autoFlow ? 'selected' : ''}`}
        style={{ width: '100%', padding: '10px' }}
        onClick={() => onToggleAuto(!autoFlow)}
      >
        <Sparkles size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {autoFlow ? 'Đang trôi thời gian tự động (Bật)' : 'Tự động trôi qua 8 buổi trong ngày'}
      </button>
    </div>
  );
};
