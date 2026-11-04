// A small raindrop for "rain likely during work hours" marks. Decorative: the text next to it
// (or the label of what it marks) says what it means.
export function RainIcon({ size = 12 }: { size?: number }) {
  return (
    <svg className="rain-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5C8 1.5 3.5 6.8 3.5 9.8A4.5 4.5 0 0 0 12.5 9.8C12.5 6.8 8 1.5 8 1.5Z" fill="currentColor" />
    </svg>
  );
}
