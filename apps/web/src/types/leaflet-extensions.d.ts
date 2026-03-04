import "leaflet";

declare module "leaflet" {
  interface MarkerOptions {
    /** Custom property for disease risk flag on map pins */
    diseaseRisk?: boolean;
    /** Custom property for watch list status on map pins */
    watchList?: boolean;
  }

  interface Map {
    /** Custom property: cone marker attached to mini-map for Street View */
    _miniMapConeMarker?: L.CircleMarker;
  }
}
