import { useSyncExternalStore } from 'react';
import s from '../glass/Workbench.module.css';

export const mistPoster = '/backgrounds/mist.jpg';
const reducedMotion = '(prefers-reduced-motion: reduce)';

function shouldPlay() {
  return !document.hidden && !window.matchMedia(reducedMotion).matches;
}

function subscribe(onChange: () => void) {
  const preference = window.matchMedia(reducedMotion);
  preference.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    preference.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

export function MistWallpaper() {
  const play = useSyncExternalStore(subscribe, shouldPlay);
  return (
    <div className={s.mistWallpaper} aria-hidden="true" style={{ backgroundImage: `url(${mistPoster})` }}>
      {play && <video src="/backgrounds/mist.webm" poster={mistPoster} muted autoPlay loop playsInline />}
    </div>
  );
}
