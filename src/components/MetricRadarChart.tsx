import React from 'react';

export interface MetricRadarChartProps {
  scores: {
    structure?: number;
    color?: number;
    pattern?: number;
    text?: number;
    lighting?: number;
  };
  darkPanel?: boolean;
}

export const MetricRadarChart: React.FC<MetricRadarChartProps> = ({ scores, darkPanel = false }) => {
  const safeScores = scores || {};
  const structure = safeScores.structure ?? 0;
  const color = safeScores.color ?? 0;
  const pattern = safeScores.pattern ?? 0;
  const text = safeScores.text ?? 0;
  const lighting = safeScores.lighting ?? 0;

  const maxVals = { structure: 40, color: 25, pattern: 25, text: 5, lighting: 5 };
  const axes = [
    { label: '结构', val: structure, max: maxVals.structure, key: 'structure' },
    { label: '色彩', val: color, max: maxVals.color, key: 'color' },
    { label: '印花', val: pattern, max: maxVals.pattern, key: 'pattern' },
    { label: '标识', val: text, max: maxVals.text, key: 'text' },
    { label: '光影', val: lighting, max: maxVals.lighting, key: 'lighting' }
  ];

  const width = 360;
  const height = 240;
  const cx = width / 2;
  const cy = height / 2 + 5;
  const r = 85;
  const angles = [-Math.PI / 2, -Math.PI / 2 + (2 * Math.PI) / 5, -Math.PI / 2 + (4 * Math.PI) / 5, -Math.PI / 2 + (6 * Math.PI) / 5, -Math.PI / 2 + (8 * Math.PI) / 5];
  const levels = [0.25, 0.5, 0.75, 1.0];

  const getCoords = (scale: number, angleIndex: number) => {
    const angle = angles[angleIndex];
    return { x: cx + r * scale * Math.cos(angle), y: cy + r * scale * Math.sin(angle) };
  };

  const dataPoints = axes.map((axis, idx) => getCoords(Math.min(Math.max(axis.val / axis.max, 0), 1.0), idx));
  const pointsString = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  const getLabelProps = (idx: number) => {
    const angle = angles[idx];
    const offsetRadius = r + 15;
    const x = cx + offsetRadius * Math.cos(angle);
    const y = cy + offsetRadius * Math.sin(angle);
    let textAnchor = 'middle';
    let dy = '0.35em';
    if (idx === 0) { textAnchor = 'middle'; dy = '-0.4em'; }
    else if (idx === 1) { textAnchor = 'start'; dy = '-0.1em'; }
    else if (idx === 2) { textAnchor = 'start'; dy = '0.8em'; }
    else if (idx === 3) { textAnchor = 'end'; dy = '0.8em'; }
    else if (idx === 4) { textAnchor = 'end'; dy = '-0.1em'; }
    return { x, y, textAnchor, dy };
  };

  const gridEmptyColor = darkPanel ? 'rgba(255, 255, 255, 0.15)' : 'rgba(148, 163, 184, 0.15)';
  const gridMaxColor = darkPanel ? 'rgba(204, 255, 0, 0.35)' : 'rgba(77, 124, 15, 0.25)';
  const polyFill = darkPanel ? 'rgba(204, 255, 0, 0.2)' : 'rgba(132, 204, 22, 0.14)';
  const mainStroke = darkPanel ? '#ccff00' : '#4d7c0f';
  const textColor = darkPanel ? '#ffffff' : '#334155';
  const valColor = darkPanel ? '#ccff00' : '#4d7c0f';

  return (
    <div className="w-full flex items-center justify-center overflow-hidden select-none py-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto max-w-[360px]">
        {levels.map((level, levelIdx) => (
          <polygon key={levelIdx} points={angles.map((_, idx) => `${getCoords(level, idx).x},${getCoords(level, idx).y}`).join(' ')} fill="none" stroke={level === 1.0 ? gridMaxColor : gridEmptyColor} strokeWidth={level === 1.0 ? 1.5 : 1} strokeDasharray={level === 1.0 ? '3 3' : undefined} />
        ))}
        {angles.map((_, idx) => (
          <line key={idx} x1={cx} y1={cy} x2={getCoords(1.0, idx).x} y2={getCoords(1.0, idx).y} stroke={gridEmptyColor} strokeWidth={1} strokeDasharray="2 2" />
        ))}
        <polygon points={pointsString} fill={polyFill} stroke={mainStroke} strokeWidth={2.2} strokeLinejoin="round" />
        {dataPoints.map((point, idx) => (
          <circle key={idx} cx={point.x} cy={point.y} r={3.8} fill={darkPanel ? '#111111' : '#ffffff'} stroke={mainStroke} strokeWidth={1.8} />
        ))}
        {axes.map((axis, idx) => {
          const { x, y, textAnchor, dy } = getLabelProps(idx);
          return (
            <g key={idx}>
              <text x={x} y={y} dy={dy} textAnchor={textAnchor} fill={textColor} className="font-sans font-bold text-[10.5px] tracking-tight selection:bg-transparent">{axis.label}</text>
              <text x={x} y={y} dy={dy === '0.8em' ? '1.85em' : idx === 0 ? '0.7em' : '1.05em'} textAnchor={textAnchor} fill={valColor} className="font-mono text-[9px] font-bold tracking-tight">{axis.val}/{axis.max}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
