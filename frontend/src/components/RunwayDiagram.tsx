// Schematic of KLAX's four parallel runways (~070/250), rotated to roughly match the
// real orientation, with the active arrival runways + landing direction highlighted.

import { CAT } from "../lib/colors";

interface Props {
  flow: "west" | "east";
}

// North -> south: outboard north, inboard north, inboard south, outboard south.
const RUNWAYS = [
  { y: -54, west: "24R", east: "06L", complex: "N", outboard: true },
  { y: -34, west: "24L", east: "06R", complex: "N", outboard: false },
  { y: 30, west: "25R", east: "07L", complex: "S", outboard: false },
  { y: 50, west: "25L", east: "07R", complex: "S", outboard: false },
];
// outboard south is 07R/25L (last); fix flag:
RUNWAYS[3].outboard = true;

export default function RunwayDiagram({ flow }: Props) {
  const arrivalColor = CAT.approach;
  // West flow lands toward the left (250); east flow toward the right (070).
  const arrowDir = flow === "west" ? -1 : 1;

  return (
    <svg viewBox="-150 -90 300 180" className="rwy-diagram" role="img" aria-label="KLAX runway diagram">
      <g transform="rotate(-20)">
        {RUNWAYS.map((r, i) => {
          const isArrival = r.outboard; // arrivals use the outboard runways
          const label = flow === "west" ? r.west : r.east;
          return (
            <g key={i}>
              <rect
                x={-120}
                y={r.y - 4}
                width={240}
                height={8}
                rx={2}
                style={{ fill: isArrival ? arrivalColor : "var(--rwy-inactive)" }}
                opacity={isArrival ? 1 : 0.9}
              />
              {/* threshold-direction label */}
              <text
                x={arrowDir < 0 ? -132 : 132}
                y={r.y + 4}
                textAnchor={arrowDir < 0 ? "end" : "start"}
                className={isArrival ? "rwy-label active" : "rwy-label"}
              >
                {label}
              </text>
            </g>
          );
        })}
        {/* landing-direction arrow across the field */}
        <line
          x1={arrowDir < 0 ? 90 : -90}
          y1={-8}
          x2={arrowDir < 0 ? -90 : 90}
          y2={-8}
          stroke={arrivalColor}
          strokeWidth={2}
          markerEnd="url(#arrow)"
          opacity={0.9}
        />
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={arrivalColor} />
          </marker>
        </defs>
      </g>
      <text x={0} y={80} textAnchor="middle" className="rwy-caption">
        {flow === "west"
          ? "WEST flow · land 24/25 · arrivals from the EAST"
          : "EAST flow · land 06/07 · arrivals from the WEST"}
      </text>
    </svg>
  );
}
