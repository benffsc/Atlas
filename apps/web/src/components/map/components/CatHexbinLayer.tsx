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

interface CatHexbinLayerProps {
  pins: AtlasPin[];
  enabled: boolean;
  hexRadius?: number;
  mode?: "density" | "intact" | "disease";
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
export function CatHexbinLayer({ pins, enabled, hexRadius = 26, mode = "density" }: CatHexbinLayerProps) {
  const map = useMap();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const binsRef = useRef<Bin[]>([]);
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

    const weightedPoints: [number, number][] = [];
    for (const pin of pins) {
      if (!pin.lat || !pin.lng) continue;
      const pt = project(pin.lat, pin.lng);
      if (!pt) continue;
      const w = getWeight(pin);
      for (let i = 0; i < w; i++) weightedPoints.push(pt);
    }

    const hexbinGen = d3Hexbin<[number, number]>()
      .extent([
        [0, 0],
        [width, height],
      ])
      .radius(hexRadius);

    const bins = hexbinGen(weightedPoints);
    binsRef.current = bins;

    const maxCount = d3.max(bins, (d) => d.length) ?? 1;

    const gradient =
      mode === "disease"
        ? d3.interpolateReds
        : mode === "intact"
          ? d3.interpolateOranges
          : d3.interpolateYlOrRd;

    const colorScale = d3.scaleSequential(gradient).domain([0, maxCount]);

    d3.select(svg)
      .selectAll<SVGPathElement, Bin>("path.hexbin")
      .data(bins)
      .join(
        (enter) => enter.append("path").attr("class", "hexbin"),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr("d", hexbinGen.hexagon())
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .attr("fill", (d) => colorScale(d.length))
      .attr("fill-opacity", 0.72)
      .attr("stroke", "rgba(255,255,255,0.3)")
      .attr("stroke-width", 0.8);
  }, [dims, project, hexRadius, pins, map, enabled, getWeight, mode]);

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
  useEffect(() => {
    if (!map || !enabled) return;
    const listener = map.addListener("idle", () => {
      overlayRef.current?.draw();
      drawHexbins();
    });
    return () => google.maps.event.removeListener(listener);
  }, [map, drawHexbins, enabled]);

  // Tooltip via mousemove on the parent map container
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

      let closest: Bin | null = null;
      let minDist = hexRadius + 2;

      for (const bin of binsRef.current) {
        const dist = Math.hypot(bin.x - mx, bin.y - my);
        if (dist < minDist) {
          minDist = dist;
          closest = bin;
        }
      }

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

    const onMouseLeave = () => {
      setTooltip(null);
      if (svgRef.current) {
        d3.select(svgRef.current).selectAll("path.hexbin").attr("fill-opacity", 0.72).attr("stroke-width", 0.8);
      }
    };

    container.addEventListener("mousemove", onMouseMove);
    container.addEventListener("mouseleave", onMouseLeave);
    return () => {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [map, enabled, hexRadius]);

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
