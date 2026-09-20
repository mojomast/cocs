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
| [GRAPHICS-LAB.md](GRAPHICS-LAB.md) | Opt-in developer graphics preview, stackable effects and controls. |
| [design/MOTH-GRAPHICS-PLAN.md](design/MOTH-GRAPHICS-PLAN.md) | Extensive Moth API/mothbake research and the material-variety roadmap. |
| [V8.4-IMPROVEMENT-PLAN.md](V8.4-IMPROVEMENT-PLAN.md) | Post-release multi-track audit and prioritized corrective roadmap. |
| [spec/SPEC.md](spec/SPEC.md) | Historical design specification (kept as a record). |
| [spec/DEVPLAN.md](spec/DEVPLAN.md) | Historical development plan (kept as a record). |
| [history/](history/) | Superseded audit and code-review plans. |

## A note on status

This project is verified with deterministic Node test suites, TypeScript, a
production build, SSR/contract checks and tracked Chromium browser harnesses.
The graphics-lab harness also checks actual WebGL shader output. Automated
browser/GPU correctness is distinct from physical-device performance, assistive-
technology listening, and human art/gameplay preference; see release verification
notes for the evidence available for each change.
