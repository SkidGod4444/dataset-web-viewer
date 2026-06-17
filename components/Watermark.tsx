const WATERMARK_TEXT = "@NEUROSCAPE IMAGING PVT LTD.";

// A repeating, rotated SVG tile used as a CSS background so it covers any size.
// Neutral gray reads faintly on both light backgrounds and dark video.
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><text x="6" y="150" transform="rotate(-30 180 120)" fill="#888888" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="15" font-weight="600" letter-spacing="0.4">${WATERMARK_TEXT}</text></svg>`;

const BACKGROUND = `url("data:image/svg+xml,${encodeURIComponent(TILE)}")`;

/**
 * Low-opacity tiled watermark overlay. Place inside a `relative` container; it
 * fills it, sits above the content, and lets clicks/scroll pass through.
 */
export function Watermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-30 select-none opacity-[0.10]"
      style={{ backgroundImage: BACKGROUND, backgroundRepeat: "repeat" }}
    />
  );
}
