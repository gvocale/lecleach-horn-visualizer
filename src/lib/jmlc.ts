export interface JmlcParams {
  fc: number; // Cutoff frequency in Hz
  T: number; // Expansion factor (usually 0.5 to 2.0)
  d0: number; // Throat diameter in mm
  roundOver: number; // Rollback angle limit in degrees (e.g., 180)
}

export interface Point {
  index: number;
  x: number;
  y: number;
  z?: number;
  length: number; // Path length along the wall
  radius: number; // Theoretical expansion radius
  angle: number; // Wall angle in degrees
  deltaAngle: number; // Change in angle from previous point (degrees)
}

export const C_SOUND = 343200; // Speed of sound in mm/s (dry air approx 20C)

export class JmlcHornCalculator {
  private params: JmlcParams;

  constructor(params: JmlcParams) {
    this.params = params;
  }

  // Calculate the expansion coefficient 'm'
  private getM(): number {
    return (4 * Math.PI * this.params.fc) / C_SOUND;
  }

  // Calculate the target Area at path length 'l' using Hyperbolic-Exponential law
  // S = S0 * (cosh(m * l / 2) + T * sinh(m * l / 2))^2
  private getTargetArea(l: number): number {
    const m = this.getM();
    const r0 = this.params.d0 / 2;
    const s0 = Math.PI * r0 * r0; // Planar throat area
    const term = (m * l) / 2;
    const expansionFactor = Math.cosh(term) + this.params.T * Math.sinh(term);
    return s0 * expansionFactor * expansionFactor;
  }

  public generateProfile(stepSize: number = 1.0): Point[] {
    const points: Point[] = [];
    const m = this.getM();

    // Safety check
    if (m === 0 || this.params.d0 <= 0) return points;

    // Initial state
    let l = 0;
    let x = 0;
    let y = this.params.d0 / 2; // Start at throat radius

    // Initial point
    points.push({
      index: 0,
      x,
      y,
      length: 0,
      radius: y,
      angle: 0,
      deltaAngle: 0,
    });

    // We limit max steps to avoid infinite loops
    const MAX_STEPS = 20000;
    let previousAngle = 0; // Keep track of angle to prevent jitter or help solver
    let previousDelta = 0; // Keep track of rate of change to detect peak growth

    // SPIRAL EXTENSION STATE
    // We detector when the physical expansion rate peaks (usually around 90-100 deg)
    // and switch to forced spiral mode to ensure progressive growth if roundOver > 180.
    let isSpiraling = false;
    let baseDeltaTheta = 0; // The rate of angle change at the moment of transition
    let spiralStepCount = 0;
    const SPIRAL_DETECTION_THRESHOLD_ANGLE = 90; // degrees - start looking for deceleration after this

    for (let i = 0; i < MAX_STEPS; i++) {
      // Increment acoustic path length
      const l_next = l + stepSize;

      // 1. Calculate Target Surface Area for this length
      const S_target = this.getTargetArea(l_next);

      // 2. Determine Wall Angle (theta)
      let theta = 0;

      if (isSpiraling) {
        // ACCELERATED VISUAL SPIRAL
        // To mimic the "tightening" look of the JMLC/Fusion reference, we accelerate the curvature.
        // We use geometric compounding (exponential growth) of the angle increment.
        // This causes the curve to curl tighter and tighter naturally.

        spiralStepCount++;

        // Growth factor per step (0.5%)
        // currentDelta = baseDelta * (1.005 ^ steps)
        const growthRate = 1.005;
        const currentDelta =
          baseDeltaTheta * Math.pow(growthRate, spiralStepCount);

        theta = previousAngle + currentDelta;
      } else {
        // Standard Physical Solver
        // Equation to solve:
        // f(theta) = 2 * PI * (y_prev + step * sin(theta))^2 - S_target * (1 + cos(theta)) = 0

        // We use a Binary Search for stability.
        // Range: [0, 2PI] (Relaxed monotonic constraint to prevent stall at numerical dips)
        let minTheta = 0;
        let maxTheta = 2 * Math.PI;

        // Iteration for solver
        for (let iter = 0; iter < 50; iter++) {
          theta = (minTheta + maxTheta) / 2;

          // Proposed new radius at this theta
          const y_candidate = y + stepSize * Math.sin(theta);

          // Area check
          const S_geometry =
            (2 * Math.PI * y_candidate * y_candidate) / (1 + Math.cos(theta));

          // If Geometry Area < Target Area, we need to OPEN more
          if (S_geometry < S_target) {
            minTheta = theta;
          } else {
            maxTheta = theta;
          }
        }

        // Check if we should switch to forced spiral mode
        // Logic: If user wants a full rollback (>180), we switch when we detect the
        // expansion rate starting to slow down (dip in growth), ensuring it always grows.
        const currentDeg = theta * (180 / Math.PI);
        const currentDelta = theta - previousAngle;

        const isDecelerating =
          currentDelta < previousDelta &&
          currentDeg > SPIRAL_DETECTION_THRESHOLD_ANGLE;

        // Enable accelerated spiral for any deep rollback (>100 degrees) to prevent
        // solver stall/deceleration at large angles (like 179.9 vs 180).
        if (isDecelerating && this.params.roundOver > 100) {
          isSpiraling = true;
          // Use the PREVIOUS (peak) delta as the handover point to maintain momentum
          baseDeltaTheta = previousDelta;
          // Recalculate this step using the spiral logic immediately to prevent the dip
          theta = previousAngle + baseDeltaTheta;
          // We don't increment spiralStepCount here yet, the next loop will start compounding
        }
      }

      const thetaDeg = theta * (180 / Math.PI);
      const deltaDeg = (theta - previousAngle) * (180 / Math.PI);

      // Update tracking for next step
      if (!isSpiraling) {
        previousDelta = theta - previousAngle;
      }

      // 3. Stop Conditions

      // a. Angle Limit (Rollback) - User defined
      // We add a small epsilon to prevent infinite loops when targeting exactly 180 or similar
      // singularities where the solver might get stuck at 179.999...
      const EPSILON = 0.005;
      if (thetaDeg >= this.params.roundOver - EPSILON) {
        break;
      }

      // b. Safety: Stop if spiral curls into the axis (y < 0)
      if (isSpiraling) {
        const nextY = y + stepSize * Math.sin(theta);
        if (nextY <= 0) break;
      }

      // 4. Update State
      const dx = stepSize * Math.cos(theta);
      const dy = stepSize * Math.sin(theta);

      x += dx;
      y += dy;
      l = l_next;
      previousAngle = theta;

      points.push({
        index: i + 1,
        x,
        y,
        length: l,
        radius: Math.sqrt(S_target / Math.PI), // Equivalent planar radius for reference
        angle: thetaDeg,
        deltaAngle: deltaDeg,
      });
    }

    return points;
  }

  public generateCSV(points: Point[]): string {
    let csv = "X (cm),Y (cm),Z (cm)\n";
    points.forEach((p) => {
      // Convert mm to cm by dividing by 10
      csv += `${(p.x / 10).toFixed(4)},${(p.y / 10).toFixed(4)},0.0000\n`;
    });
    return csv;
  }

  public generateLog(points: Point[]): string {
    let csv =
      "Index,Length (mm),Radius (mm),Angle (deg),Delta Angle (deg),Growth (%)\n";
    points.forEach((p) => {
      const growth = (p.deltaAngle / (p.angle - p.deltaAngle || 1)) * 100;
      csv += `${p.index},${p.length.toFixed(2)},${p.y.toFixed(
        2
      )},${p.angle.toFixed(3)},${p.deltaAngle.toFixed(4)},${growth.toFixed(
        4
      )}\n`;
    });
    return csv;
  }
}
