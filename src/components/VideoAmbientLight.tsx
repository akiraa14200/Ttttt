import { useEffect, type RefObject } from 'react';
import './video-ambient-light.css';

type PlayerInfo = { currentTime?: number; playerState?: number };

const YT_ORIGINS = new Set(['https://www.youtube-nocookie.com', 'https://www.youtube.com']);

function send(target: HTMLIFrameElement, func: string, args: unknown[] = []) {
  try {
    target.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com');
  } catch { /* Cross-origin player may not be ready yet. */ }
}

/**
 * Creates a muted, blurred duplicate YouTube player behind the interactive player.
 * The foreground player remains untouched for controls and audio. The YouTube
 * iframe JS messaging channel keeps the background copy close to the foreground
 * playback position without reading cross-origin pixels.
 */
export function useVideoAmbientLight(hostRef: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    const host = hostRef.current;
    if (!active || !host) return;
    const foreground = host.querySelector<HTMLIFrameElement>('iframe');
    const parent = host.parentElement;
    if (!foreground || !parent) return;

    let foregroundUrl: URL;
    try { foregroundUrl = new URL(foreground.src); } catch { return; }
    if (!/youtube(-nocookie)?\.com$/.test(foregroundUrl.hostname)) return;

    foregroundUrl.searchParams.set('enablejsapi', '1');
    foregroundUrl.searchParams.set('origin', window.location.origin);
    foregroundUrl.searchParams.set('playsinline', '1');
    foreground.src = foregroundUrl.toString();

    const backgroundUrl = new URL(foregroundUrl.toString());
    backgroundUrl.searchParams.set('autoplay', '1');
    backgroundUrl.searchParams.set('mute', '1');
    backgroundUrl.searchParams.set('controls', '0');
    backgroundUrl.searchParams.set('disablekb', '1');
    backgroundUrl.searchParams.set('modestbranding', '1');
    backgroundUrl.searchParams.set('iv_load_policy', '3');

    const layer = document.createElement('div');
    layer.className = 'video-ambient-light';
    layer.setAttribute('aria-hidden', 'true');
    const duplicate = document.createElement('iframe');
    duplicate.src = backgroundUrl.toString();
    duplicate.title = '';
    duplicate.tabIndex = -1;
    duplicate.setAttribute('aria-hidden', 'true');
    duplicate.setAttribute('allow', 'autoplay; encrypted-media');
    duplicate.setAttribute('referrerpolicy', 'origin');
    layer.appendChild(duplicate);

    const parentStyle = getComputedStyle(parent);
    const previousPosition = parent.style.position;
    const previousIsolation = parent.style.isolation;
    if (parentStyle.position === 'static') parent.style.position = 'relative';
    if (parentStyle.isolation !== 'isolate') parent.style.isolation = 'isolate';
    parent.insertBefore(layer, host);

    const place = () => {
      const p = parent.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      // Expand evenly around the player: the previous short top overhang made
      // the glow appear weighted toward the bottom on compact/mobile cards.
      const spreadX = h.width * 0.24;
      const spreadY = h.height * 0.34;
      layer.style.left = `${h.left - p.left + parent.scrollLeft - spreadX}px`;
      layer.style.top = `${h.top - p.top + parent.scrollTop - spreadY}px`;
      layer.style.width = `${h.width + spreadX * 2}px`;
      layer.style.height = `${h.height + spreadY * 2}px`;
      layer.style.setProperty('--video-ambient-blur', `${Math.max(34, Math.min(76, h.width * 0.09))}px`);
    };
    place();
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    resize?.observe(host);
    resize?.observe(parent);
    window.addEventListener('resize', place, { passive: true });

    let ready = false;
    let lastSeek = 0;
    const subscribe = () => {
      try {
        foreground.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'ryko-foreground', channel: 'ryko-ambient' }), 'https://www.youtube-nocookie.com');
        duplicate.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'ryko-background', channel: 'ryko-ambient' }), 'https://www.youtube-nocookie.com');
        foreground.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }), 'https://www.youtube-nocookie.com');
      } catch { /* Player API handshake can be retried on load. */ }
    };
    const onFrameLoad = () => { ready = true; subscribe(); send(duplicate, 'mute'); send(duplicate, 'playVideo'); };
    duplicate.addEventListener('load', onFrameLoad);
    foreground.addEventListener('load', subscribe);
    const onMessage = (event: MessageEvent) => {
      if (!YT_ORIGINS.has(event.origin)) return;
      let payload: any;
      try { payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (payload?.event === 'onReady' && payload.id === 'ryko-background') {
        ready = true;
        send(duplicate, 'mute');
        send(duplicate, 'playVideo');
      }
      if (payload?.event !== 'infoDelivery' || !payload.info || event.source !== foreground.contentWindow) return;
      const info = payload.info as PlayerInfo;
      if (!ready) return;
      if (typeof info.currentTime === 'number' && Math.abs(info.currentTime - lastSeek) > 1.25) {
        lastSeek = info.currentTime;
        send(duplicate, 'seekTo', [info.currentTime, true]);
      }
      if (info.playerState === 1) send(duplicate, 'playVideo');
      else if (info.playerState === 2 || info.playerState === 0) send(duplicate, 'pauseVideo');
    };
    window.addEventListener('message', onMessage);

    // Polling asks the foreground player for its current state. It is much lighter
    // than decoding/capturing a second canvas and keeps scrubbing approximately aligned.
    const poll = window.setInterval(() => {
      if (!document.hidden) {
        try {
          foreground.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'getCurrentTime', args: [] }), 'https://www.youtube-nocookie.com');
          foreground.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'getPlayerState', args: [] }), 'https://www.youtube-nocookie.com');
        } catch { /* Player may have navigated. */ }
      }
    }, 1400);
    subscribe();

    return () => {
      window.clearInterval(poll);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('resize', place);
      foreground.removeEventListener('load', subscribe);
      duplicate.removeEventListener('load', onFrameLoad);
      resize?.disconnect();
      layer.remove();
      parent.style.position = previousPosition;
      parent.style.isolation = previousIsolation;
    };
  }, [active, hostRef]);
}
