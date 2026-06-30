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
