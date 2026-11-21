# HINexT

**HINexT** is a free, open-source, browser-based tool for **Pinch Analysis** and **Heat Exchanger Network (HEN) design**.

It is a modern successor to HINT (Heat INTegration), the well-loved teaching tool that no longer runs on today's 64-bit computers. The name keeps both ideas: **HINT** + **NEXT**.

> **Status:** Stage 1A (targeting) — v0.1.0. MER design on the grid diagram (1B), network evolution (1C) and the public v1.0 (1D) follow. Watch or star the repository to follow progress.

## Why HINexT?

- **Runs in your browser.** No installation and no login.
- **Your data stays with you.** Projects are saved locally in your browser.
- **Works offline** once loaded.
- **Built for teaching and practice.** Useful in the classroom and for real process integration studies.
- **Free and open source** under the MIT License.

## What works now (Stage 1A — targeting)

- **Stream table:** name, supply and target temperature, CP *or* heat load (the other is derived), film coefficient h, optional individual ΔT contribution. Hot/cold is flagged from the temperatures.
- **Utilities:** any number of hot and cold utilities, isothermal (steam) or non-isothermal (hot oil, cooling water), each with a cost in $/kW·yr.
- **Problem Table Algorithm** and **heat cascade**, shown as tables with the pinch highlighted.
- **Curves:** composite, shifted composite, grand composite (with utility levels placed on it) and balanced composite curves, each exportable as SVG or PNG.
- **ΔTmin slider** with live update of every target and curve.
- **Targets:** QH,min / QC,min, pinch temperatures, multiple-utility duties, minimum units (overall and MER), area (Bath formula), capital, operating and total annual cost.
- **Capital cost models:** power law `a + b·A^c`, linear `a + b·A`, separate parameters for exchangers / heaters / coolers, or a user-defined expression in `A`; annualised with interest rate and plant life.
- **Supertargeting:** total annual cost vs ΔTmin with the optimum marked.
- **Units:** °C or K, kW or MW (all maths in SI internally).
- **Saving:** autosave in the browser, `.pinch` file save/open (also drag-and-drop), undo/redo with named steps.

## Validation

The calculation module is covered by automated tests (`npm test`). Energy targets are checked against published values:

| Case | ΔTmin | QH,min | QC,min | Pinch (hot / cold) |
|---|---|---|---|---|
| Four-stream problem (Kemp, 2007; Linnhoff et al., 1982) | 10 K | 20 kW | 60 kW | 90 / 80 °C |
| Linnhoff & Hindmarsh (1983) | 20 K | 107.5 kW | 40 kW | 90 / 70 °C |
| Smith (2016), two-reactor process | 10 K | 750 kW | 1000 kW | 150 / 140 °C |

Other tests check the Problem Table interval balances and cascade, composite and GCC end points, multiple-utility placement, the Bath formula against hand calculations, the minimum-units target, annualisation, every capital cost model, supertargeting, threshold problems, individual ΔT contributions and the `.pinch` file round trip.

Utility temperatures, utility costs and film coefficients in the built-in examples are **illustrative**, so their area and cost figures are not published benchmarks.

## Method notes

- **Shifting:** hot streams shift down and cold streams up by their ΔT contribution (default ΔTmin/2). Utilities shift the same way.
- **Multiple utilities:** hot utilities are used coldest-first, each taking as much duty as lowers the remaining hot demand one-for-one; cold utilities are used warmest-first, each taking as much as the cascade can feed without a negative heat flow. Demand no utility can meet is reported.
- **Minimum units:** Euler, U = N − 1 per region, with the pinch(es) splitting the problem into independent regions for the MER target.
- **Area:** Bath formula over the balanced composite curves, A = Σₖ (1/ΔT_LM,k) Σᵢ qᵢ,ₖ/hᵢ. The exchanger / heater / cooler split is approximate and used only by the "separate" cost model.
- **Capital:** the area target is shared equally between the minimum number of units.

## Planned features

### Stage 1: local-first app
- Stream data entry (supply/target temperatures, heat capacity flow rates, ΔT<sub>min</sub>)
- Problem Table Algorithm and pinch temperature
- Minimum hot and cold utility targets
- Composite Curves and Grand Composite Curve
- Grid diagram for HEN design
- Loop breaking and network simplification
- Save and load projects in the browser
- Export diagrams and HEN designs (PNG, PDF)

### Stage 2: collaboration (later)
- Optional accounts
- Real-time collaboration on shared projects

The architecture is designed from the start so Stage 2 can be added without rewriting Stage 1.

## Trying it out

A hosted test version will be published on Netlify once the first working build is ready. The link will appear here.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # calculation and state tests
npm run build      # production build in dist/
```

Stack: React + TypeScript + Vite, tested with Vitest. No runtime dependencies beyond React.

```
src/core/      pure pinch maths (no UI): streams, cascade, utilities, composites, area, units, costs, analyse
src/state/     named actions, undo/redo history, storage interface (save/load), .pinch files
src/ui/        React components; all diagrams are SVG
src/examples/  benchmark cases
tests/         Vitest suites
```

Netlify builds from `netlify.toml`: it runs the tests, then `npm run build`, and publishes `dist/`.

## Contributing

Contributions are welcome, from bug reports and test cases to code and documentation. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

HINexT is released under the [MIT License](LICENSE). © 2026 Weda-SL
