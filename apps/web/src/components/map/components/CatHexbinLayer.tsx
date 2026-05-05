"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import * as d3 from "d3";
import { hexbin as d3Hexbin } from "d3-hexbin";
import type { AtlasPin } from "@/components/map";

type Bin = ReturnType<ReturnType<typeof d3Hexbin>>["0"];

interface Tooltip {
  x: number;
  y: number;
  count: number;
}

export interface HexBinSelection {
  /** Pins that fall within the clicked hexagon */
  pins: AtlasPin[];
  /** Center of the hexagon in lat/lng */
  center: { lat: number; lng: number };
}

interface CatHexbinLayerProps {
  pins: AtlasPin[];
  enabled: boolean;
  hexRadius?: number;
  mode?: "density" | "intact" | "disease";
  /** Called when user clicks a hexagon */
  onHexClick?: (selection: HexBinSelection) => void;
  /** Currently selected hex center (for highlight ring) */
  selectedCenter?: { lat: number; lng: number } | null;
  /** When true, render risk score labels on each hex cell */
  showInsights?: boolean;
}

/**
 * D3 hexbin density overlay rendered inside Google Maps' own overlay pane
 * system. By injecting the SVG into the `overlayLayer` pane, it sits
 * between the map tiles and the marker/InfoWindow panes — so pins and
 * info windows naturally render on top of the hexagons.
 *
 * The SVG is pointer-events:none; tooltip hover is driven by a mousemove
 * listener on the parent container with manual hit-testing.
 */
/**
 * Compute hex radius from zoom level.
 * Larger hexes at low zoom for overview, smaller at high zoom for detail.
 */
function hexRadiusForZoom(zoom: number): number {
  if (zoom <= 8) return 40;
  if (zoom <= 10) return 34;
  if (zoom <= 12) return 28;
  if (zoom <= 14) return 22;
  if (zoom <= 16) return 18;
  return 14;
}

export function CatHexbinLayer({ pins, enabled, hexRadius: hexRadiusProp, mode = "density", onHexClick, selectedCenter, showInsights = false }: CatHexbinLayerProps) {
  const map = useMap();
  // Dynamic hex radius: use prop override if provided, otherwise derive from zoom
  const [zoomDerivedRadius, setZoomDerivedRadius] = useState(26);
  const hexRadius = hexRadiusProp ?? zoomDerivedRadius;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const binsRef = useRef<Bin[]>([]);
  /** Maps each bin (by index in binsRef) to the unique AtlasPin[] that contributed points */
  const binPinsMapRef = useRef<Map<Bin, AtlasPin[]>>(new Map());
  const overlayRef = useRef<google.maps.OverlayView | null>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // Inject SVG into Google Maps overlay pane (between tiles and markers)
  useEffect(() => {
    if (!map || !enabled) {
      // Tear down existing overlay
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current = null;
      }
      return;
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.pointerEvents = "none";
    svgRef.current = svg;

    const overlay = new google.maps.OverlayView();

    overlay.onAdd = function () {
      // overlayLayer sits below markerLayer and floatPane (InfoWindows)
      const pane = this.getPanes()?.overlayLayer as HTMLElement | undefined;
      if (pane) {
        pane.style.pointerEvents = "none";
        pane.appendChild(svg);
      }
    };

    overlay.draw = function () {
      // Position the SVG to cover the full map viewport
      const projection = this.getProjection();
      if (!projection) return;

      const div = map.getDiv();
      const w = div.offsetWidth;
      const h = div.offsetHeight;

      // Get the top-left of the viewport in pixel coords
      const bounds = map.getBounds();
      if (!bounds) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const topLeftPx = projection.fromLatLngToDivPixel(new google.maps.LatLng(ne.lat(), sw.lng()));
      if (!topLeftPx) return;

      svg.style.left = `${topLeftPx.x}px`;
      svg.style.top = `${topLeftPx.y}px`;
      svg.setAttribute("width", String(w));
      svg.setAttribute("height", String(h));

      setDims({ width: w, height: h });
    };

    overlay.onRemove = function () {
      svg.parentNode?.removeChild(svg);
    };

    overlay.setMap(map);
    overlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
      overlayRef.current = null;
      svgRef.current = null;
    };
  }, [map, enabled]);

  // Project lat/lng to pixel coords relative to the SVG origin
  const project = useCallback(
    (lat: number, lng: number): [number, number] | null => {
      if (!map) return null;
      const proj = map.getProjection();
      if (!proj) return null;
      const bounds = map.getBounds();
      if (!bounds) return null;

      const scale = Math.pow(2, map.getZoom()!);
      const ne = proj.fromLatLngToPoint(bounds.getNorthEast())!;
      const sw = proj.fromLatLngToPoint(bounds.getSouthWest())!;
      const pt = proj.fromLatLngToPoint(new google.maps.LatLng(lat, lng))!;

      return [(pt.x - sw.x) * scale, (pt.y - ne.y) * scale];
    },
    [map],
  );

  // Weight function based on mode
  const getWeight = useCallback(
    (pin: AtlasPin): number => {
      if (mode === "disease") return pin.disease_count || 0;
      if (mode === "intact") return Math.max(pin.cat_count - (pin.total_altered || 0), 0);
      return Math.max(pin.cat_count, 1);
    },
    [mode],
  );

  // Draw hexbins
  const drawHexbins = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !map || !enabled) return;

    const { width, height } = dims;
    if (width === 0 || height === 0) return;

    // Build weighted points AND track which pin each point came from
    const weightedPoints: [number, number][] = [];
    const pointPinIndex: number[] = []; // parallel array: weightedPoints[i] came from pins[pointPinIndex[i]]
    for (let pi = 0; pi < pins.length; pi++) {
      const pin = pins[pi];
      if (!pin.lat || !pin.lng) continue;
      const pt = project(pin.lat, pin.lng);
      if (!pt) continue;
      const w = getWeight(pin);
      for (let i = 0; i < w; i++) {
        weightedPoints.push(pt);
        pointPinIndex.push(pi);
      }
    }

    const hexbinGen = d3Hexbin<[number, number]>()
      .extent([
        [0, 0],
        [width, height],
      ])
      .radius(hexRadius);

    const bins = hexbinGen(weightedPoints);
    binsRef.current = bins;

    // Build bin → unique pins mapping
    const binPinsMap = new Map<Bin, AtlasPin[]>();
    // d3-hexbin preserves point indices — bins[b] contains the original [x,y] tuples
    // We need to match them back. Since we built weightedPoints in order, we can
    // iterate all points per bin and look up the original index.
    const pointToBinMap = new Map<string, Bin>();
    for (const bin of bins) {
      for (const pt of bin) {
        pointToBinMap.set(`${pt[0]},${pt[1]}`, bin);
      }
    }
    for (let i = 0; i < weightedPoints.length; i++) {
      const key = `${weightedPoints[i][0]},${weightedPoints[i][1]}`;
      const bin = pointToBinMap.get(key);
      if (!bin) continue;
      let arr = binPinsMap.get(bin);
      if (!arr) { arr = []; binPinsMap.set(bin, arr); }
      const pin = pins[pointPinIndex[i]];
      if (!arr.includes(pin)) arr.push(pin);
    }
    binPinsMapRef.current = binPinsMap;

    const maxCount = d3.max(bins, (d) => d.length) ?? 1;

    const gradient =
      mode === "disease"
        ? d3.interpolateReds
        : mode === "intact"
          ? d3.interpolateOranges
          : d3.interpolateYlOrRd;

    const densityColorScale = d3.scaleSequential(gradient).domain([0, maxCount]);

    // Risk color scale: green (1) → yellow (4) → orange (6) → red (10)
    const riskColorScale = d3.scaleLinear<string>()
      .domain([1, 4, 7, 10])
      .range(["#16a34a", "#eab308", "#ea580c", "#dc2626"])
      .clamp(true);

    // Pre-compute risk score per bin (used for insights coloring + labels)
    const binRiskScores = new Map<Bin, number>();
    if (showInsights) {
      for (const bin of bins) {
        const hexPins = binPinsMap.get(bin);
        if (!hexPins || hexPins.length === 0) { binRiskScores.set(bin, 1); continue; }
        const totalCats = hexPins.reduce((s, p) => s + p.cat_count, 0);
        const totalAltered = hexPins.reduce((s, p) => s + (p.total_altered || 0), 0);
        const altRate = totalCats > 0 ? totalAltered / totalCats : 0;
        const intact = Math.max(totalCats - totalAltered, 0);
        let risk = 0;
        if (altRate < 0.3) risk += 3;
        else if (altRate < 0.5) risk += 2;
        else if (altRate < 0.75) risk += 1;
        if (intact > 20) risk += 2;
        else if (intact > 10) risk += 1;
        if (hexPins.filter(p => p.disease_risk).length >= 3) risk += 2;
        else if (hexPins.some(p => p.disease_risk)) risk += 1;
        binRiskScores.set(bin, Math.min(10, Math.max(1, risk)));
      }
    }

    // Check if there's a selected hex to highlight
    let selectedBinPx: [number, number] | null = null;
    if (selectedCenter) {
      selectedBinPx = project(selectedCenter.lat, selectedCenter.lng);
    }

    const svgSel = d3.select(svg);

    svgSel
      .selectAll<SVGPathElement, Bin>("path.hexbin")
      .data(bins)
      .join(
        (enter) => enter.append("path").attr("class", "hexbin"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("d", hexbinGen.hexagon())
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .attr("fill", (d) => showInsights ? riskColorScale(binRiskScores.get(d) ?? 1) : densityColorScale(d.length))
      .attr("fill-opacity", 0.72)
      .attr("stroke", "rgba(255,255,255,0.3)")
      .attr("stroke-width", 0.8);

    // Selection highlight ring
    svgSel.selectAll("path.hexbin-selected").remove();
    if (selectedBinPx) {
      // Find the bin closest to the selected center
      let closestBin: Bin | null = null;
      let minDist = hexRadius + 2;
      for (const bin of bins) {
        const dist = Math.hypot(bin.x - selectedBinPx[0], bin.y - selectedBinPx[1]);
        if (dist < minDist) { minDist = dist; closestBin = bin; }
      }
      if (closestBin) {
        svgSel
          .append("path")
          .attr("class", "hexbin-selected")
          .attr("d", hexbinGen.hexagon())
          .attr("transform", `translate(${closestBin.x},${closestBin.y})`)
          .attr("fill", "none")
          .attr("stroke", "var(--primary, #3b82f6)")
          .attr("stroke-width", 3)
          .attr("stroke-opacity", 0.9);
      }
    }

    // Insights labels — show risk score on each hex
    svgSel.selectAll("text.hexbin-label").remove();
    if (showInsights) {
      for (const bin of bins) {
        const risk = binRiskScores.get(bin);
        if (risk == null) continue;

        svgSel
          .append("text")
          .attr("class", "hexbin-label")
          .attr("x", bin.x)
          .attr("y", bin.y + 1)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", Math.max(9, hexRadius * 0.4))
          .attr("font-weight", "700")
          .attr("fill", "white")
          .attr("stroke", "rgba(0,0,0,0.4)")
          .attr("stroke-width", 2)
          .attr("paint-order", "stroke")
          .attr("pointer-events", "none")
          .text(risk);
      }
    }
  }, [dims, project, hexRadius, pins, map, enabled, getWeight, mode, selectedCenter, showInsights]);

  // Redraw on dependency changes
  useEffect(() => {
    if (!enabled) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("path.hexbin").remove();
      binsRef.current = [];
      return;
    }
    drawHexbins();
  }, [drawHexbins, enabled]);

  // Redraw on map idle (pan/zoom) — also triggers overlay.draw() for repositioning
  // Update hex radius based on zoom level
  useEffect(() => {
    if (!map || !enabled) return;
    const listener = map.addListener("idle", () => {
      const zoom = map.getZoom();
      if (zoom != null && !hexRadiusProp) {
        setZoomDerivedRadius(hexRadiusForZoom(zoom));
      }
      overlayRef.current?.draw();
      drawHexbins();
    });
    return () => google.maps.event.removeListener(listener);
  }, [map, drawHexbins, enabled, hexRadiusProp]);

  // Unproject pixel coords back to lat/lng
  const unproject = useCallback(
    (px: number, py: number): { lat: number; lng: number } | null => {
      if (!map) return null;
      const proj = map.getProjection();
      if (!proj) return null;
      const bounds = map.getBounds();
      if (!bounds) return null;

      const scale = Math.pow(2, map.getZoom()!);
      const ne = proj.fromLatLngToPoint(bounds.getNorthEast())!;
      const sw = proj.fromLatLngToPoint(bounds.getSouthWest())!;

      const worldPt = new google.maps.Point(
        px / scale + sw.x,
        py / scale + ne.y,
      );
      const latLng = proj.fromPointToLatLng(worldPt);
      if (!latLng) return null;
      return { lat: latLng.lat(), lng: latLng.lng() };
    },
    [map],
  );

  // Find closest bin to a pixel coordinate
  const findClosestBin = useCallback(
    (mx: number, my: number): Bin | null => {
      let closest: Bin | null = null;
      let minDist = hexRadius + 2;
      for (const bin of binsRef.current) {
        const dist = Math.hypot(bin.x - mx, bin.y - my);
        if (dist < minDist) { minDist = dist; closest = bin; }
      }
      return closest;
    },
    [hexRadius],
  );

  // Tooltip + click via mousemove/click on the parent map container
  useEffect(() => {
    if (!map || !enabled) return;
    const container = map.getDiv().closest(".map-container-v2") as HTMLElement | null;
    if (!container) return;

    const onMouseMove = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;

      const rect = map.getDiv().getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const closest = findClosestBin(mx, my);

      const sel = d3.select(svg).selectAll<SVGPathElement, Bin>("path.hexbin");
      if (closest) {
        setTooltip({ x: e.clientX, y: e.clientY, count: closest.length });
        sel
          .attr("fill-opacity", (d) => (d === closest ? 0.95 : 0.65))
          .attr("stroke-width", (d) => (d === closest ? 2 : 0.8));
      } else {
        setTooltip(null);
        sel.attr("fill-opacity", 0.72).attr("stroke-width", 0.8);
      }
    };

    const onClick = (e: MouseEvent) => {
      if (!onHexClick) return;
      // Don't intercept clicks on map controls, buttons, or other UI overlays
      const target = e.target as HTMLElement;
      if (target.closest(".map-control-btn, .map-controls, .map-zoom-controls, .map-bottom-controls, .map-layer-panel, .map-basemap-menu, .map-add-point-menu, button, a, input, select")) return;
      const rect = map.getDiv().getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const closest = findClosestBin(mx, my);
      if (!closest) return;

      const hexPins = binPinsMapRef.current.get(closest) || [];
      if (hexPins.length === 0) return;

      const center = unproject(closest.x, closest.y);
      if (!center) return;

      onHexClick({ pins: hexPins, center });
    };

    const onMouseLeave = () => {
      setTooltip(null);
      if (svgRef.current) {
        d3.select(svgRef.current).selectAll("path.hexbin").attr("fill-opacity", 0.72).attr("stroke-width", 0.8);
      }
    };

    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);
    container.addEventListener("click", onClick);
    return () => {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", onMouseLeave);
      container.removeEventListener("click", onClick);
    };
  }, [map, enabled, hexRadius, onHexClick, findClosestBin, unproject]);

  if (!enabled) return null;

  const modeLabel = mode === "disease" ? "disease signals" : mode === "intact" ? "intact cats" : "cat sightings";

  return (
    <>
      {/* Tooltip — rendered outside the map panes so it's always on top */}
      {tooltip && (
        <div
          style={{
            position: "fixed",
            zIndex: 20,
            left: tooltip.x + 14,
            top: tooltip.y - 36,
            background: "rgba(15,15,30,0.92)",
            color: "#f1f5f9",
            fontSize: 12,
            fontFamily: "system-ui, sans-serif",
            padding: "6px 12px",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          <strong>{tooltip.count}</strong> {modeLabel}
        </div>
      )}
    </>
  );
}
