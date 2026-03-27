import { formatDistance } from "@/components/map/hooks/useMeasurement";

interface Props {
  points: Array<{ lat: number; lng: number }>;
  totalDistance: number;
  /** Live distance including cursor position (0 when not hovering) */
  cursorDistance?: number;
  onUndo: () => void;
  onClear: () => void;
  onCancel?: () => void;
}

export function MeasurementPanel({ points, totalDistance, cursorDistance, onUndo, onClear, onCancel }: Props) {
  const showLive = cursorDistance && cursorDistance > 0 && points.length >= 1;

  return (
    <div className="map-measure-panel">
      {showLive ? (
        <span className="map-measure-panel__distance" style={{ color: "#3b82f6" }}>
          {formatDistance(cursorDistance)}
        </span>
      ) : (
        <span className="map-measure-panel__distance">
          {points.length >= 2 ? formatDistance(totalDistance) : "Click to measure"}
        </span>
      )}
      <span className="map-measure-panel__info">{points.length} point{points.length !== 1 ? "s" : ""}</span>
      {points.length > 0 && (
        <>
          <button className="map-measure-panel__btn" onClick={onUndo}>Undo</button>
          <button className="map-measure-panel__btn map-measure-panel__btn--danger" onClick={onClear}>Clear</button>
        </>
      )}
      {onCancel && (
        <button className="map-measure-panel__btn" onClick={onCancel} title="Press Esc">
          Cancel
        </button>
      )}
      <span className="map-measure-panel__hint" style={{ fontSize: 10, color: "var(--text-tertiary)", marginLeft: 4 }}>Esc to exit</span>
    </div>
  );
}
