"use client";

/**
 * CityBarChart — Horizontal bar chart comparing cities by economic impact.
 * Custom SVG — no external chart library.
 */

interface CityRow {
  city_name: string;
  total_cost: number;
  cats_altered: number;
}

interface Props {
  cities: CityRow[];
  width?: number;
  onCityClick?: (cityName: string) => void;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

export function CityBarChart({ cities, width = 600, onCityClick }: Props) {
  if (cities.length === 0) return null;

  const barH = 32;
  const gap = 8;
  const labelW = 110;
  const valueW = 80;
  const padR = 10;
  const barAreaW = width - labelW - valueW - padR;
  const height = cities.length * (barH + gap) + gap;
  const maxVal = cities[0]?.total_cost || 1;

  // Color gradient by rank
  const getColor = (i: number) => {
    const opacity = 1 - (i / cities.length) * 0.5;
    return `rgba(37, 99, 235, ${opacity})`;
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      preserveAspectRatio="xMidYMid meet"
    >
      {cities.map((city, i) => {
        const y = gap + i * (barH + gap);
        const barW = Math.max((city.total_cost / maxVal) * barAreaW, 2);

        return (
          <g
            key={city.city_name}
            style={{ cursor: onCityClick ? "pointer" : "default" }}
            onClick={() => onCityClick?.(city.city_name)}
          >
            {/* City name */}
            <text
              x={labelW - 8}
              y={y + barH / 2 + 4}
              textAnchor="end"
              fontSize="12"
              fontWeight="500"
              fill="var(--foreground)"
              fontFamily="inherit"
            >
              {city.city_name}
            </text>

            {/* Bar */}
            <rect
              x={labelW}
              y={y}
              width={barW}
              height={barH}
              rx={4}
              fill={getColor(i)}
            />

            {/* Cat count inside bar (if it fits) */}
            {barW > 60 && (
              <text
                x={labelW + barW - 6}
                y={y + barH / 2 + 4}
                textAnchor="end"
                fontSize="10"
                fill="#fff"
                fontWeight="600"
                fontFamily="inherit"
              >
                {city.cats_altered.toLocaleString()} cats
              </text>
            )}

            {/* Value */}
            <text
              x={labelW + barW + 6}
              y={y + barH / 2 + 4}
              fontSize="12"
              fontWeight="700"
              fill="var(--foreground)"
              fontFamily="inherit"
            >
              {formatCurrency(city.total_cost)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
