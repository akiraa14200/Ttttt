import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { showToast } from '../components/Extras';

/**
 * App-style back navigation for the Android app.
 *
 * Hardware/gesture back now works like other apps instead of closing everything:
 *  1. closes the top-most open layer (menu, sheet, fullscreen video),
 *  2. otherwise walks back along the exact path you took (Home → Browse → Title → …),
 *     using the router's own history stack, so every screen keeps its scroll position,
 *  3. on a main tab with no earlier path, returns to Home first,
 *  4. on Home, a second back press within 2 s exits ("Press back again to exit").
 * On the web the browser's own back button already behaves this way, so nothing changes there.
 */

type Layer = () => void;
const layers: Layer[] = [];

/** Register a closable layer while `open` is true; back closes the most recent one first. */
export function useBackLayer(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const layer: Layer = () => closeRef.current();
    layers.push(layer);
    return () => { const i = layers.lastIndexOf(layer); if (i >= 0) layers.splice(i, 1); };
  }, [open]);
}

/** Mount once inside the router. */
export function useAppBackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  const lastBack = useRef(0);

  useEffect(() => { pathRef.current = location.pathname; }, [location.pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('backButton', () => {
      const top = layers[layers.length - 1];
      if (top) { top(); return; }
      if (document.fullscreenElement) { void document.exitFullscreen?.().catch(() => undefined); return; }
      const idx = window.history.state && typeof window.history.state.idx === 'number' ? window.history.state.idx : 0;
      if (idx > 0) { navigate(-1); return; }
      if (pathRef.current !== '/') { navigate('/', { replace: true }); return; }
      const now = Date.now();
      if (now - lastBack.current < 2000) { void CapApp.exitApp(); return; }
      lastBack.current = now;
      showToast('Press back again to exit');
    });
    return () => { void handle.then(h => h.remove()); };
  }, [navigate]);
}
