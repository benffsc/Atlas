"use client";

export function MapTopBar() {
  return (
    <header className="map-top-bar">
      <div className="map-top-bar__search" id="map-search-portal" />
      <div className="map-top-bar__spacer" />
      <div className="map-top-bar__basemap" id="map-basemap-portal" />
      <div className="map-top-bar__actions" id="map-actions-portal" />
    </header>
  );
}
