// src/components/Skeleton.js
// Reusable shimmer placeholder for loading states. Use instead of "Loading…":
//   <Skeleton width={120} height={18} />
//   <Skeleton width="60%" />
// Styling (.skeleton + shimmer keyframes) lives in global.css.

import React from 'react';

export default function Skeleton({ width = '100%', height = 14, radius = 6, style }) {
  return (
    <span
      className="skeleton"
      style={{ display: 'block', width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

// Generic multi-row placeholder for list/table loading states.
export function SkeletonList({ rows = 5 }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="row" style={{ padding: '8px 0', gap: 12 }}>
          <Skeleton width={38} height={38} radius={999} />
          <div style={{ flex: 1 }}>
            <Skeleton width="32%" height={14} style={{ marginBottom: 8 }} />
            <Skeleton width="55%" height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}
