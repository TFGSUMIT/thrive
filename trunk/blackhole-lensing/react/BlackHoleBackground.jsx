// =============================================================================
// BlackHoleBackground.jsx — React wrapper around the blackhole-lensing core
//
// A fixed, full-viewport, pointer-events:none canvas that renders the lensed
// black hole BEHIND all UI. Defaults to the "thrive subtle" preset: dim, very
// slow, offset to a corner, low quality + capped fps, reduced-motion aware —
// so it never competes with foreground content or spins up a fan.
//
//   import BlackHoleBackground from 'blackhole-lensing/react/BlackHoleBackground';
//   <BlackHoleBackground />                       // subtle defaults
//   <BlackHoleBackground params={{ palette: 1 }} opacity={0.5} quality="medium" />
// =============================================================================
import { useEffect, useRef } from 'react';
import { BlackHoleRenderer } from '../src/BlackHoleRenderer.js';
import { PRESETS } from '../src/index.js';

export default function BlackHoleBackground({
  params = {},
  toggles = {},            // enable/disable features, e.g. { nebula: false }
  quality,                 // override preset quality ('low' default via preset)
  opacity = 0.85,          // extra CSS dimming on top of params.intensity
  zIndex = -1,             // sit behind app content
  style = {},
  paused = false,          // stop the loop without unmounting
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);

  // create once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const preset = PRESETS.thriveSubtle;
    const renderer = new BlackHoleRenderer(
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

  // live param updates without re-creating the GL context
  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.setParams({ ...PRESETS.thriveSubtle.params, ...params });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r && quality) r.setQuality(quality);
  }, [quality]);

  // live feature toggle changes (recompiles the shader)
  useEffect(() => {
    const r = rendererRef.current;
    if (r) r.setToggles({ ...PRESETS.thriveSubtle.toggles, ...toggles });
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
