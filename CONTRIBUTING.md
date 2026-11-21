# Contributing to HINexT

Thank you for your interest in HINexT! Whether you are a student, a lecturer, a process engineer or a developer, there is a way to help.

## Ways to contribute

- **Report a bug.** Something calculates wrong, looks broken or crashes.
- **Suggest a feature.** Tell us what would make HINexT more useful for teaching or practice.
- **Share test cases.** Textbook or real-world stream data with known answers (pinch temperature, utility targets, number of units) is extremely valuable for verifying results.
- **Improve documentation.** Fix typos, clarify explanations, write tutorials.
- **Write code.** Pick up an open issue or propose your own improvement.

## Reporting bugs and suggesting features

Please use [GitHub Issues](../../issues). Before opening a new issue, check whether one already exists.

For a **bug report**, include:
- What you did (steps to reproduce)
- What you expected to happen
- What actually happened (screenshots help)
- Your browser and operating system
- The stream data, if the bug is in a calculation (you can export your project and attach it)

For a **calculation error**, please give the source of the expected answer (textbook, paper or hand calculation) so it can be checked.

## Contributing code

1. **Discuss first.** For anything larger than a small fix, open an issue to talk about it before you start. This avoids duplicated or wasted work.
2. **Fork** the repository and create a branch from `main` with a descriptive name, e.g. `fix/grand-composite-curve-scaling` or `feature/pdf-export`.
3. **Make your changes.** Keep each pull request focused on one thing.
4. **Test your changes.** Calculation changes should include tests against known results.
5. **Open a pull request** against `main`. Describe what you changed and why, and link the related issue (e.g. "Closes #12").

All changes to `main` go through a pull request and are reviewed by a maintainer before merging.

### Guidelines

- Write clear, readable code. Comment anything non-obvious, especially engineering calculations. Cite the method or reference where helpful.
- Use SI units internally. Unit conversion belongs in the user interface layer.
- Keep calculations independent of the user interface so they can be tested on their own.
- Write commit messages in the imperative mood: "Add PDF export", not "Added PDF export".

### Development setup

```bash
npm install
npm run dev     # start the app at http://localhost:5173
npm test        # run the test suite
npm run build   # type-check and build
```

Pinch calculations live in `src/core/` and must not import anything from `src/ui/`. Every change to a project goes through a named action in `src/state/actions.ts`. Benchmark cases with published answers go in `src/examples/` with a matching test in `tests/`.

## License of contributions

HINexT is released under the [MIT License](LICENSE). By submitting a contribution, you agree that it will be licensed under the same MIT License.

## Code of conduct

Be respectful, constructive and patient. Everyone here is volunteering their time, and many contributors are students who are still learning. Harassment or personal attacks will not be tolerated.

## Questions?

Open an issue with the **question** label and we will help.
