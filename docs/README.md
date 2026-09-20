# COCS documentation

The [README](../README.md) is the front door. Everything below is the deeper
reference.

| Document | What it covers |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | Every release from the original MVP to the current build. |
| [SYSTEMS.md](SYSTEMS.md) | Deep reference for each game system, with the code and tests that own it. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map, data flow, invariants and the extension guide. |
| [TESTING.md](TESTING.md) | How the project is verified and how to run the suites. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Hosting, the build/restart rule and deployment verification. |
| [VERIFICATION.md](VERIFICATION.md) | Dated release evidence and the remaining validation gaps. |
| [V8.4-IMPROVEMENT-PLAN.md](V8.4-IMPROVEMENT-PLAN.md) | Post-release multi-track audit and prioritized corrective roadmap. |
| [spec/SPEC.md](spec/SPEC.md) | Historical design specification (kept as a record). |
| [spec/DEVPLAN.md](spec/DEVPLAN.md) | Historical development plan (kept as a record). |
| [history/](history/) | Superseded audit and code-review plans. |

## A note on status

This project is verified with deterministic Node test suites, TypeScript, a
production build and an SSR/contract test layer. There is **no browser/GPU
verification in this environment**: renderer and audio claims are build- and
geometry-verified, not frame-paced on hardware. That limitation is stated
honestly in each release's verification notes.
