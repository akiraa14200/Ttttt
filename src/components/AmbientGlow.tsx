import { useEffect, type RefObject } from 'react';
import { createAmbientGlow, type AmbientOptions } from '../lib/ambient';
import './ambient-glow.css';

/**
 * Attaches YouTube-style Ambient Mode behind an existing player box.
 * Adds no markup to the React tree and changes no player styles; the glow layer
 * is created imperatively and fully cleaned up on unmount.
 */
export function useAmbientGlow(
  hostRef: RefObject<HTMLElement>,
  active: boolean,
  options: Omit<AmbientOptions, 'host' | 'media'> & { mediaSelector?: string } = {}
) {
  const frameKey = (options.frames || []).join('|');
  useEffect(() => {
    const host = hostRef.current;
    if (!active || !host) return;
    const media = host.querySelector<HTMLVideoElement | HTMLIFrameElement>(options.mediaSelector || 'video, iframe');
    const handle = createAmbientGlow({ ...options, host, media });
    return () => handle.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, frameKey, options.assumePlaying]);
}
