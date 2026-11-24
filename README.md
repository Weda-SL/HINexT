# HINexT

**HINexT** is a free, open-source, browser-based tool for **Pinch Analysis** and **Heat Exchanger Network (HEN) design**.

It is a modern successor to HINT (Heat INTegration), the well-loved teaching tool that no longer runs on today's 64-bit computers. The name keeps both ideas: **HINT** + **NEXT**.

> **Status:** Stage 1A (targeting) is complete; Stage 1B (MER design) and 1C (network evolution) are in development. The public v1.0 (1D) follows. Watch or star the repository to follow progress.

## Why HINexT?

- **Runs in your browser.** No installation and no login.
- **Your data stays with you.** Projects are saved locally in your browser.
- **Works offline** once loaded.
- **Built for teaching and practice.** Useful in the classroom and for real process integration studies.
- **Free and open source** under the MIT License.

## What works now (Stage 1A — targeting)

- **Stream table:** name, supply and target temperature, CP or heat load (type either; the other is calculated), film coefficient h, optional individual ΔT contribution. Hot/cold is flagged from the temperatures.
- **Non-linear streams:** a profile of temperature points with the CP or heat load of each segment between them, per-segment film coefficients, and phase change (a repeated temperature with a heat load). Only the part between the stream's supply and target temperatures is used.
- **Utilities:** any number of hot and cold utilities, isothermal (steam) or non-isothermal (hot oil, cooling water), each with a cost in $/kW·yr.
- **Problem Table Algorithm** and **heat cascade**, shown as tables with the pinch highlighted.
- **Curves:** composite, shifted composite, grand composite (with utility levels placed on it) and balanced composite curves, each downloadable as PDF, SVG or PNG from one Download button.
- **ΔTmin input** with live update of every target and curve.
- **Targets:** QH,min / QC,min, pinch temperatures, multiple-utility duties, minimum units (overall and MER), area (Bath formula), capital, operating and total annual cost.
- **Capital cost models:** power law `a + b·A^c`, linear `a + b·A`, separate parameters for exchangers / heaters / coolers, or a user-defined expression in `A`; annualised with interest rate and plant life.
- **Supertargeting:** total annual cost vs ΔTmin with the optimum marked.
- **Units:** °C or K, kW or MW (all maths in SI internally).
- **Saving:** autosave in the browser, `.pinch` file save/open (also drag-and-drop), undo/redo with named steps.

## In development (Stages 1B and 1C)

- **MER design tab:** grid diagram with the pinch line. Click a hot and then a cold stream to place an exchanger (its load starts at the tick-off value); drag units to reorder them; add heaters and coolers for the remaining duty. Temperatures between units are recalculated from the loads, and the design is checked live: ΔTmin violations and temperature crosses, heat across the pinch, heaters below and coolers above the pinch, the CP rule at the pinch, the stream-count rule, and over-satisfied streams. A design-vs-targets table compares utilities, units, area and total annual cost.
- **Evolution tab:** loop count from Euler's theorem (L = U − N + S), every loop and every hot-to-cold utility path, loop breaking (removes the smallest unit), path relaxation with a solver for the x that restores ΔTmin, a live preview, and a trade-off history table with step-back.
- Stream splits are not yet supported.

## Validation

The calculation module is covered by automated tests (`npm test`). Energy targets are checked against published values:

| Case | ΔTmin | QH,min | QC,min | Pinch (hot / cold) |
|---|---|---|---|---|
| Four-stream problem (Kemp, 2007; Linnhoff et al., 1982) | 10 K | 20 kW | 60 kW | 90 / 80 °C |
| Linnhoff & Hindmarsh (1983) | 20 K | 107.5 kW | 40 kW | 90 / 70 °C |
| Smith (2016), two-reactor process | 10 K | 750 kW | 1000 kW | 150 / 140 °C |

The network tests reproduce the Kemp four-stream MER design (6 units, QH = 20 kW, QC = 60 kW) and its textbook evolution: breaking the Hot 4–Cold 1 loop (x = 30 kW) and relaxing along steam → Cold 1 → Hot 4 → cooling water, where x = 7.5 kW restores ΔTmin (QH = 27.5 kW, QC = 67.5 kW).

Other tests check the Problem Table interval balances and cascade, composite and GCC end points, multiple-utility placement, the Bath formula against hand calculations, the minimum-units target, annualisation, every capital cost model, supertargeting, threshold problems, individual ΔT contributions and the `.pinch` file round trip.

Utility temperatures, utility costs and film coefficients in the built-in examples are **illustrative**, so their area and cost figures are not published benchmarks.

## Method notes

- **Phase change:** heat exchanged at one temperature is handled exactly, as a step in the cascade and the curves, so there is no infinite CP and no division by zero.
- **Shifting:** hot streams shift down and cold streams up by their ΔT contribution (default ΔTmin/2). Utilities shift the same way.
- **Multiple utilities:** hot utilities are used coldest-first, each taking as much duty as lowers the remaining hot demand one-for-one; cold utilities are used warmest-first, each taking as much as the cascade can feed without a negative heat flow. A user can limit any utility's duty; the rest passes to the next hotter (or colder) utility. Demand no utility can meet is reported.
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
src/core/      pure pinch maths (no UI): streams, cascade, utilities, composites, area, units, costs, analyse,
              network (1B design checks), evolution (1C loops, paths, shifts)
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
