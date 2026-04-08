/**
 * Converts a hex color to a soft background + text style.
 * Returns inline style object for bg (with alpha) and text color.
 */
function colorStyles(hex) {
  if (!hex) return null;
  // Parse hex to RGB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.15)`,
    color: hex,
  };
}

export default function Badge({ children, color }) {
  const styles = colorStyles(color);
  if (styles) {
    return (
      <span
        className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
        style={styles}
      >
        {children || "Pendiente"}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      {children || "Pendiente"}
    </span>
  );
}
