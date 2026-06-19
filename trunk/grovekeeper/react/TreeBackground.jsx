// =============================================================================
// TreeBackground.jsx — React wrapper around the grovekeeper core
//
// A fixed, full-viewport, pointer-events:none canvas that renders the growing
// tree BEHIND all UI. Defaults to the "groveSubtle" preset: transparent sky so
// the app background shows through, dim, gentle wind, low quality + capped fps,
// reduced-motion aware — so it never competes with foreground content.
//
//   import TreeBackground from 'grovekeeper/react/TreeBackground';
//   <TreeBackground />                                  // subtle defaults
//   <TreeBackground params={{ windStrength: 1 }} opacity={0.5} quality="medium" />
// =============================================================================
import { useEffect, useRef } from 'react';
import { TreeRenderer } from '../src/TreeRenderer.js';
import { PRESETS } from '../src/index.js';

export default function TreeBackground({
  params = {},
  toggles = {},
  quality,
  opacity = 0.85,
  zIndex = -1,
  style = {},
  paused = false,
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);

  // create once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preset = PRESETS.groveSubtle;
    const renderer = new TreeRenderer(
      canvas,
      { ...preset.params, ...params },
      { quality: quality || preset.quality, respectReducedMotion: true,
        toggles: { ...preset.toggles, ...toggles } },
    );
    rendererRef.current = renderer;

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => renderer.resize());
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', renderer.resize.bind(renderer));
    }

    // pause when the tab is hidden — no reason to render an unseen background
    const onVis = () => (document.hidden ? renderer.stop() : !paused && renderer.start());
    document.addEventListener('visibilitychange', onVis);

    if (!paused) renderer.start();

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      ro ? ro.disconnect() : window.removeEventListener('resize', renderer.resize);
      renderer.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live param updates without recreating the renderer
  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.setParams({ ...PRESETS.groveSubtle.params, ...params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r && quality) r.setQuality(quality);
  }, [quality]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.setToggles({ ...PRESETS.groveSubtle.toggles, ...toggles });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(toggles)]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    paused ? r.stop() : r.start();
  }, [paused]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        display: 'block',
        pointerEvents: 'none',
        zIndex,
        opacity,
        ...style,
      }}
    />
  );
}
