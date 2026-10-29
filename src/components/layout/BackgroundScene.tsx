"use client";

/**
 * Animated monochromatic background — deep black gradient, slow silver orbs,
 * faint grid, glass sheen and subtle noise. Pure CSS animation, respects
 * prefers-reduced-motion (see globals.css).
 */
export function BackgroundScene() {
  return (
    <div className="bg-scene" aria-hidden="true">
      <div className="bg-grid" />
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="bg-orb orb-3" />
      <div className="bg-sheen" />
      <div className="bg-noise" />
    </div>
  );
}
