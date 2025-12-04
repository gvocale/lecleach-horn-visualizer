# LeCleac'h Horn Visualizer

A web-based calculator and visualizer for LeCleac'h acoustic horn profiles. This tool helps audio enthusiasts and speaker builders design horns with specific cutoff frequencies and expansion characteristics.

## Features

- **Interactive Visualization**: Real-time rendering of the horn profile.
- **Adjustable Parameters**:
  - **Cutoff Frequency (Fc)**: Define the acoustic low-frequency limit (e.g., 340Hz).
  - **Expansion Factor (T)**: Adjust the flare rate (default 1.0).
  - **Throat Diameter (d0)**: Match your compression driver exit size.
  - **Rollback Angle**: Visualize or restrict the mouth rollback (up to full spiral).
- **Constraints**: Option to lock maximum mouth diameter.
- **Export**:
  - **CSV**: Export profile coordinates for CAD software (e.g., Fusion 360).
  - **Log**: Get detailed profile data.

## Usage

1.  Adjust the sliders or input values for Fc, T, and Throat Diameter.
2.  Observe the horn profile and calculated dimensions (Mouth Diameter, Depth).
3.  Click "Export CSV" to download the point cloud.

## Development

Parameters are synced to the URL, making it easy to share specific designs.

### Tech Stack

- React
- TypeScript
- Vite
- Recharts
- Tailwind CSS

### Run Locally

```bash
npm install
npm run dev
```

## License

MIT
