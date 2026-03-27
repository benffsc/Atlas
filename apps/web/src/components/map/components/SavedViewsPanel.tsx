import { SYSTEM_VIEWS, type MapView } from "@/lib/map-views";

interface Props { customViews: MapView[]; activeViewId: string | null; onApplyView: (view: MapView) => void; onSaveView: (name: string) => void; onDeleteView: (id: string) => void; }

export function SavedViewsPanel({ customViews, activeViewId, onApplyView, onSaveView, onDeleteView }: Props) {
  return (
    <div className="map-layer-panel__views">
      <div className="map-layer-panel__zone-label">Quick Views</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {SYSTEM_VIEWS.map((view) => (<button key={view.id} onClick={() => onApplyView(view)} className="map-view-chip" data-active={activeViewId === view.id || undefined}>{view.name}</button>))}
      </div>
      {customViews.length > 0 && (<>
        <div className="map-layer-panel__zone-label" style={{ marginTop: 4 }}>My Views</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
          {customViews.map((view) => (<span key={view.id} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}><button onClick={() => onApplyView(view)} className="map-view-chip" data-active={activeViewId === view.id || undefined}>{view.name}</button><button onClick={() => onDeleteView(view.id)} className="map-view-chip-delete" title="Delete view">×</button></span>))}
        </div>
      </>)}
      <button onClick={() => { const name = window.prompt("View name:"); if (name?.trim()) onSaveView(name.trim()); }} className="map-view-save-btn">+ Save Current View</button>
    </div>
  );
}
