# HINexT

**HINexT** is a free, open-source, browser-based tool for **Pinch Analysis** and **Heat Exchanger Network (HEN) design**.

It is a modern successor to HINT (Heat INTegration), the well-loved teaching tool that no longer runs on today's 64-bit computers. The name keeps both ideas: **HINT** + **NEXT**.

> **Status:** early development. Nothing is ready to use yet. Watch or star the repository to follow progress.

## Why HINexT?

- **Runs in your browser.** No installation and no login.
- **Your data stays with you.** Projects are saved locally in your browser.
- **Works offline** once loaded.
- **Built for teaching and practice.** Useful in the classroom and for real process integration studies.
- **Free and open source** under the MIT License.

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

## Contributing

Contributions are welcome, from bug reports and test cases to code and documentation. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

HINexT is released under the [MIT License](LICENSE). © 2026 Weda-SL
