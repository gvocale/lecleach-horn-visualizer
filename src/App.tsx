import { useState, useMemo, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Download,
  Calculator,
  Info,
  AlertTriangle,
  Lock,
  Activity,
} from "lucide-react";
import { JmlcHornCalculator } from "./lib/jmlc";

// Simple debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}

function App() {
  // State for horn parameters
  const [fc, setFc] = useState(() => {
    const p = new URLSearchParams(window.location.search).get("fc");
    return p ? Number(p) : 340;
  });
  const [T, setT] = useState(() => {
    const p = new URLSearchParams(window.location.search).get("T");
    return p ? Number(p) : 1.0;
  });
  const [d0, setD0] = useState(() => {
    const p = new URLSearchParams(window.location.search).get("d0");
    return p ? Number(p) : 36.0; // Default 36mm throat
  });
  const [roundOver, setRoundOver] = useState(() => {
    const p = new URLSearchParams(window.location.search).get("roundOver");
    return p ? Number(p) : 180;
  });

  // Sync state to URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("fc", fc.toString());
    params.set("T", T.toString());
    params.set("d0", d0.toString());
    params.set("roundOver", roundOver.toString());
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }, [fc, T, d0, roundOver]);

  // New: Mouth Diameter Constraint
  const [maxMouthDiameter, setMaxMouthDiameter] = useState(620);
  const [isDiameterLocked, setIsDiameterLocked] = useState(false);

  // Debounce the heavy parameters
  const debouncedFc = useDebounce(fc, 300);
  const debouncedT = useDebounce(T, 300);
  const debouncedD0 = useDebounce(d0, 300);
  const debouncedRoundOver = useDebounce(roundOver, 300);

  // Derived state: Calculator and Profile Points
  const { points, dimensions, csv, chartData, spiralData, xDomain, yDomain } =
    useMemo(() => {
      const calculator = new JmlcHornCalculator({
        fc: debouncedFc,
        T: debouncedT,
        d0: debouncedD0,
        roundOver: debouncedRoundOver,
      });

      // 1. Heavy Calculation
      // Use finer step size (0.5mm) for better solver stability near 180 deg
      const calculatedPoints = calculator.generateProfile(0.5);
      const csvData = calculator.generateCSV(calculatedPoints);

      // Calculate key dimensions based on bounding box
      let minX = 0,
        maxX = 0,
        maxY = 0;

      if (calculatedPoints.length > 0) {
        minX = calculatedPoints[0].x;
        maxX = calculatedPoints[0].x;
        maxY = calculatedPoints[0].y;

        for (const p of calculatedPoints) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }

      const lastPoint = calculatedPoints[calculatedPoints.length - 1];
      const mouthDiameter = lastPoint ? lastPoint.y * 2 : 0;
      const physicalDepth = maxX;

      // 2. Prepare Visualization Data (Adaptive Downsampling)
      // We clip the tail (last N points) to preserve the rollback detail,
      // while downsampling the long initial body to save performance.
      const totalPoints = calculatedPoints.length;
      const PRESERVED_TAIL_POINTS = 200; // Keep last 200 points (approx 200mm) full res for rollback detail
      const targetBodyPoints = 300; // Target points for the main body

      let chartData: typeof calculatedPoints = [];

      if (totalPoints <= PRESERVED_TAIL_POINTS + targetBodyPoints) {
        // Small enough, keep all
        chartData = calculatedPoints;
      } else {
        const bodyPoints = calculatedPoints.slice(
          0,
          totalPoints - PRESERVED_TAIL_POINTS
        );
        const tailPoints = calculatedPoints.slice(
          totalPoints - PRESERVED_TAIL_POINTS
        );

        const bodyStep = Math.ceil(bodyPoints.length / targetBodyPoints) || 1;
        const downsampledBody = bodyPoints.filter(
          (_, index) => index % bodyStep === 0
        );

        chartData = [...downsampledBody, ...tailPoints];
      }

      // Add mirror data for visualization
      chartData = chartData.map((p) => ({
        ...p,
        negY: -p.y,
      }));

      // 3. Calculate Aspect Ratio Enforced Domains
      const CHART_ASPECT = 2.0;

      // Determine data bounding box dimensions
      const dataWidth = maxX - minX;
      const dataHeight = maxY * 2; // Full height (top to bottom)

      // Center the view on the data
      const centerX = (minX + maxX) / 2;

      let renderWidth = dataWidth;
      let renderHeight = dataHeight;

      const dataAspect = dataWidth / dataHeight;

      if (dataAspect > CHART_ASPECT) {
        renderHeight = renderWidth / CHART_ASPECT;
      } else {
        renderWidth = renderHeight * CHART_ASPECT;
      }

      // Add 10% padding for aesthetics
      renderWidth *= 1.1;
      renderHeight *= 1.1;

      const xDomain = [centerX - renderWidth / 2, centerX + renderWidth / 2];
      const yDomain = [-renderHeight / 2, renderHeight / 2];

      // 4. Downsample for Radial Chart (needs more resolution than linear, but less than full)
      const spiralStep = Math.ceil(totalPoints / 1000) || 1;
      const spiralData = calculatedPoints.filter(
        (_, index) => index % spiralStep === 0 || index === totalPoints - 1
      );

      return {
        points: calculatedPoints, // Full resolution for stats/export
        chartData, // Downsampled for UI
        spiralData,
        csv: csvData,
        dimensions: {
          mouthDiameter,
          depth: physicalDepth,
          minX,
        },
        xDomain,
        yDomain,
      };
    }, [debouncedFc, debouncedT, debouncedD0, debouncedRoundOver]);

  // Handle Diameter Limit Warning / Correction
  const diameterExceeded =
    isDiameterLocked && dimensions.mouthDiameter > maxMouthDiameter;

  const handleDownload = () => {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jmlc-fc${fc}-T${T}-d${d0}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadLog = () => {
    // Generate the log CSV on demand since it's cheap and we have the full points array
    const calculator = new JmlcHornCalculator({
      fc,
      T,
      d0,
      roundOver,
    });
    const logCsv = calculator.generateLog(points);
    const blob = new Blob([logCsv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jmlc-log-fc${fc}-T${T}-d${d0}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8 font-sans">
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Controls */}
        <div className="lg:col-span-1 space-y-8 bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 h-fit">
          <div className="flex items-center gap-3 mb-2">
            <Calculator className="w-8 h-8 text-blue-400" />
            <h1 className="text-2xl font-bold text-white tracking-tight">
              JMLC Calc
            </h1>
          </div>

          <div className="space-y-6">
            {/* Cutoff Frequency Control */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-300">
                  Cutoff (Hz)
                </label>
              </div>
              <div className="flex gap-3">
                <input
                  type="range"
                  min="200"
                  max="2000"
                  step="5"
                  value={fc}
                  onChange={(e) => setFc(Number(e.target.value))}
                  className="flex-1 cursor-pointer accent-blue-500"
                />
                <input
                  type="number"
                  value={fc}
                  onChange={(e) => setFc(Number(e.target.value))}
                  className="w-20 bg-gray-900 border border-gray-600 rounded-lg px-2 text-center text-blue-400 font-mono focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            {/* Expansion Factor T Control */}
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <label className="text-sm font-medium text-gray-300">
                  Expansion (T)
                </label>
              </div>

              <div className="flex gap-3">
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.05"
                  value={T}
                  onChange={(e) => setT(Number(e.target.value))}
                  list="expansion-values"
                  className="flex-1 cursor-pointer accent-green-500"
                />
                <datalist id="expansion-values">
                  <option value="1.0" label="Suggested"></option>
                </datalist>

                <input
                  type="number"
                  step="0.01"
                  value={T}
                  onChange={(e) => setT(Number(e.target.value))}
                  className="w-20 bg-gray-900 border border-gray-600 rounded-lg px-2 text-center text-green-400 font-mono focus:border-green-500 outline-none"
                />
              </div>
            </div>

            {/* Rollback Control */}
            <div className="space-y-2">
              <div className="flex justify-between items-end">
                <label className="text-sm font-medium text-gray-300">
                  Rollback (°)
                </label>
              </div>

              <div className="flex gap-3">
                <input
                  type="range"
                  min="90"
                  max="360"
                  step="0.5"
                  value={roundOver}
                  onChange={(e) => setRoundOver(Number(e.target.value))}
                  list="rollback-values"
                  className="flex-1 cursor-pointer accent-purple-500"
                />
                <datalist id="rollback-values">
                  <option value="180" label="Physical Limit"></option>
                  <option value="360" label="Full Spiral"></option>
                </datalist>

                <input
                  type="number"
                  step="0.1"
                  value={roundOver}
                  onChange={(e) => setRoundOver(Number(e.target.value))}
                  className="w-20 bg-gray-900 border border-gray-600 rounded-lg px-2 text-center text-purple-400 font-mono focus:border-purple-500 outline-none"
                />
              </div>
            </div>

            <div className="h-px bg-gray-700 my-4"></div>

            {/* Throat Diameter Control */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300">
                Throat Ø (mm)
              </label>
              <input
                type="number"
                value={d0}
                onChange={(e) => setD0(Number(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Constraint: Max Mouth Diameter */}
            <div className="bg-gray-750 p-4 rounded-lg border border-gray-700 bg-black/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Lock
                    className={`w-4 h-4 ${
                      isDiameterLocked ? "text-yellow-500" : "text-gray-500"
                    }`}
                  />
                  <label className="text-sm font-medium text-gray-300">
                    Max Diameter
                  </label>
                </div>
                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                  <input
                    type="checkbox"
                    name="toggle"
                    id="diameter-toggle"
                    checked={isDiameterLocked}
                    onChange={(e) => setIsDiameterLocked(e.target.checked)}
                    className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-4 appearance-none cursor-pointer translate-x-1"
                    style={{
                      right: isDiameterLocked ? "2px" : "auto",
                      left: isDiameterLocked ? "auto" : "2px",
                      borderColor: isDiameterLocked ? "#EAB308" : "#4B5563",
                    }}
                  />
                  <label
                    htmlFor="diameter-toggle"
                    className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${
                      isDiameterLocked ? "bg-yellow-900" : "bg-gray-700"
                    }`}
                  ></label>
                </div>
              </div>

              {isDiameterLocked && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex gap-2">
                    <input
                      type="range"
                      min="200"
                      max="1500"
                      step="10"
                      value={maxMouthDiameter}
                      onChange={(e) =>
                        setMaxMouthDiameter(Number(e.target.value))
                      }
                      className="flex-1 cursor-pointer accent-yellow-500 mt-2"
                    />
                    <input
                      type="number"
                      value={maxMouthDiameter}
                      onChange={(e) =>
                        setMaxMouthDiameter(Number(e.target.value))
                      }
                      className="w-16 bg-gray-900 border border-gray-600 rounded px-1 text-center text-yellow-500 text-sm font-mono focus:border-yellow-500 outline-none"
                    />
                  </div>
                  {diameterExceeded && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-900/20 p-2 rounded border border-red-900/50">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <div>Mouth exceeds limit! Increase Cutoff to fit.</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                onClick={handleDownload}
                disabled={diameterExceeded}
                className={`w-full flex items-center justify-center gap-2 font-semibold py-3 px-4 rounded-lg transition-colors focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900
                    ${
                      diameterExceeded
                        ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                        : "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500"
                    }`}
              >
                <Download className="w-5 h-5" />
                Export CSV
              </button>
              <button
                onClick={handleDownloadLog}
                className="w-full mt-3 flex items-center justify-center gap-2 font-semibold py-2 px-4 rounded-lg transition-colors bg-gray-700 hover:bg-gray-600 text-gray-200 focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 border border-gray-600"
              >
                <Activity className="w-4 h-4" />
                Export Log
              </button>
              <p className="text-xs text-center mt-3 text-gray-500">
                Format: X, Y, Z (cm). Ready for Fusion 360 spline import.
              </p>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-3 space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-sm relative overflow-hidden">
              <div className="text-gray-400 text-sm mb-1">Physical Depth</div>
              <div className="text-3xl font-bold text-white relative z-10">
                {dimensions.depth.toFixed(1)}{" "}
                <span className="text-lg text-gray-500 font-normal">mm</span>
              </div>
              <div className="absolute right-0 bottom-0 opacity-5">
                <Calculator size={100} />
              </div>
            </div>
            <div
              className={`bg-gray-800 p-6 rounded-xl border shadow-sm transition-colors duration-300 relative overflow-hidden ${
                diameterExceeded
                  ? "border-red-500 bg-red-900/10"
                  : "border-gray-700"
              }`}
            >
              <div className="text-gray-400 text-sm mb-1">Mouth Diameter</div>
              <div
                className={`text-3xl font-bold relative z-10 ${
                  diameterExceeded ? "text-red-400" : "text-white"
                }`}
              >
                {dimensions.mouthDiameter.toFixed(1)}{" "}
                <span className="text-lg text-gray-500 font-normal">mm</span>
              </div>
              {diameterExceeded && (
                <div className="text-xs text-red-500 font-medium mt-1">
                  Limit: {maxMouthDiameter}mm
                </div>
              )}
            </div>
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-sm">
              <div className="text-gray-400 text-sm mb-1">Point Count</div>
              <div className="text-3xl font-bold text-white">
                {points.length}
              </div>
            </div>
          </div>

          {/* Visualization Graph Container */}
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 flex flex-col h-[600px]">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-blue-400" />
                  <h2 className="text-xl font-semibold text-white">
                    Profile Visualization
                  </h2>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                    <span className="text-gray-400">Profile Wall</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border border-gray-500 rounded-full"></div>
                    <span className="text-gray-500 text-xs">
                      Aspect Ratio Locked 1:1
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 w-full min-h-0 relative">
                <ResponsiveContainer width="100%" height="100%" aspect={2.0}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      label={{
                        value: "Length (mm)",
                        position: "insideBottom",
                        offset: -10,
                        fill: "#9CA3AF",
                      }}
                      stroke="#9CA3AF"
                      domain={xDomain}
                      allowDataOverflow={true}
                    />
                    <YAxis
                      label={{
                        value: "Radius (mm)",
                        angle: -90,
                        position: "insideLeft",
                        fill: "#9CA3AF",
                      }}
                      stroke="#9CA3AF"
                      domain={yDomain}
                      allowDataOverflow={true}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-gray-800 border border-gray-700 p-3 rounded shadow-lg text-sm">
                              <p className="text-gray-400 mb-1">
                                Length: {data.x.toFixed(1)} mm
                              </p>
                              <p className="text-blue-400 font-mono">
                                Radius: {data.y.toFixed(2)} mm
                              </p>
                              <p className="text-purple-400 font-mono mb-1">
                                Angle: {data.angle.toFixed(1)}°
                              </p>
                              <div className="border-t border-gray-700 pt-1 mt-1 text-xs text-gray-400">
                                <p>Δ Angle: {data.deltaAngle.toFixed(3)}°</p>
                                <p>
                                  Growth:{" "}
                                  {(
                                    (data.deltaAngle /
                                      (data.angle - data.deltaAngle || 1)) *
                                    100
                                  ).toFixed(2)}
                                  %
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    {/* Upper Horn Wall */}
                    <Line
                      type="monotone"
                      dataKey="y"
                      stroke="#3B82F6"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 6 }}
                      isAnimationActive={false} // Disable animation for responsiveness
                    />
                    {/* Lower Horn Wall (Mirrored for visualization) */}
                    <Line
                      type="monotone"
                      dataKey="negY"
                      stroke="#3B82F6"
                      strokeWidth={3}
                      dot={false}
                      strokeOpacity={0.3}
                      isAnimationActive={false}
                    />
                    {/* Center Line */}
                    <ReferenceLine
                      y={0}
                      stroke="#4B5563"
                      strokeDasharray="3 3"
                    />

                    {/* Max Diameter visual guide */}
                    {isDiameterLocked && (
                      <>
                        <ReferenceLine
                          y={maxMouthDiameter / 2}
                          stroke="#EAB308"
                          strokeDasharray="5 5"
                          strokeOpacity={0.5}
                        />
                        <ReferenceLine
                          y={-maxMouthDiameter / 2}
                          stroke="#EAB308"
                          strokeDasharray="5 5"
                          strokeOpacity={0.5}
                        />
                      </>
                    )}
                  </LineChart>
                </ResponsiveContainer>

                {/* Aspect Ratio Warning Overlay */}
                <div className="absolute bottom-4 right-4 text-xs text-gray-600 pointer-events-none">
                  * Graph scales pad automatically to maintain geometric
                  proportion
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-900/50 p-4 rounded-lg flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-200">
              <p className="font-semibold mb-1">About JMLC Expansion</p>
              <p>
                The Le Cleac'h expansion features a "rollback" to 180° to ensure
                the acoustic impedance transition is asymptotically smooth. A
                cutoff value ($f_c$) of 340Hz with T=1.0 is a common starting
                point for 1" drivers.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
