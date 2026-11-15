// The site has its own light/dark toggle, so the app can't rely on the phone's theme for the status bar and the
// safe-area strips around the WebView. This script (injected into every page) reports the colours actually painted
// at the top and bottom edges of the page, and the app matches them.

export interface ChromeMessage {
  type: 'evade:chrome';
  top: string;
  bottom: string;
}

export const CHROME_REPORTER = `(function () {
  if (window.__evadeChrome) return true;
  window.__evadeChrome = true;
  var probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  // Any CSS colour (oklch(), color-mix(), ...) -> "rgba(r,g,b,a)" by painting one pixel.
  function rgba(c) {
    if (!c || !probe) return '';
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000'; probe.fillStyle = c;
    probe.fillRect(0, 0, 1, 1);
    var d = probe.getImageData(0, 0, 1, 1).data;
    return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255) + ')';
  }
  function paint(el) {
    for (; el && el.nodeType === 1; el = el.parentElement) {
      var c = rgba(getComputedStyle(el).backgroundColor);
      if (c && parseFloat(c.split(',')[3]) >= 0.9) return c; // skip transparent and see-through layers
    }
    return rgba(getComputedStyle(document.documentElement).backgroundColor);
  }
  var last = '';
  function report() {
    if (!document.body || !window.ReactNativeWebView) return;
    var x = Math.round(innerWidth / 2);
    var msg = { type: 'evade:chrome', top: paint(document.elementFromPoint(x, 1)), bottom: paint(document.elementFromPoint(x, innerHeight - 2)) };
    var key = msg.top + '|' + msg.bottom;
    if (key !== last) { last = key; window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
  }
  var pending = null;
  function schedule() { if (!pending) pending = setTimeout(function () { pending = null; report(); }, 150); }
  new MutationObserver(schedule)
    .observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] });
  addEventListener('load', schedule);
  addEventListener('pageshow', schedule);
  setInterval(report, 1500);
  report();
  return true;
})();`;

/** Parses "rgb(…)", "rgba(…)" or "#rrggbb" into 0-255 channels; null when unknown or transparent. */
function channels(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(color.trim());
  if (!rgb) return null;
  if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return null;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** A safe solid colour for a React Native style, or the fallback. */
export function solidColor(color: string | undefined, fallback: string) {
  const c = color ? channels(color) : null;
  return c ? `rgb(${c.map(Math.round).join(',')})` : fallback;
}

/** Dark text (status bar "dark") on light backgrounds, light text on dark ones. */
export function isLight(color: string) {
  const c = channels(color);
  if (!c) return false;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

export function parseChromeMessage(data: string): ChromeMessage | null {
  try {
    const msg = JSON.parse(data) as Partial<ChromeMessage>;
    return msg.type === 'evade:chrome' && typeof msg.top === 'string' && typeof msg.bottom === 'string' ? (msg as ChromeMessage) : null;
  } catch {
    return null;
  }
}
