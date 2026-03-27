import { formatDistance } from "@/components/map/hooks/useMeasurement";

interface Props { points: Array<{ lat: number; lng: number }>; totalDistance: number; onUndo: () => void; onClear: () => void; }

export function MeasurementPanel({ points, totalDistance, onUndo, onClear }: Props) {
  return (
    <div className="map-measure-panel">
      <span className="map-measure-panel__distance">{points.length >= 2 ? formatDistance(totalDistance) : "Click to measure"}</span>
      <span className="map-measure-panel__info">{points.length} point{points.length !== 1 ? "s" : ""}</span>
      {points.length > 0 && (<><button className="map-measure-panel__btn" onClick={onUndo}>Undo</button><button className="map-measure-panel__btn map-measure-panel__btn--danger" onClick={onClear}>Clear</button></>)}
    </div>
  );
}
