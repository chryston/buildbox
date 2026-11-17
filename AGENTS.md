## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `chryston/buildbox` using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository with root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Implementation sessions

Every implementation session consults the `grilling` and `domain-modeling` skills, uses the canonical vocabulary in `GLOSSARY.md`, and reads the ADRs in `docs/adr/` that touch the area it changes. Decisions live in their owning GitHub issues; ADRs link them and never restate them.
