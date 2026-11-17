# Coordination-only documentation; no structural, engineering or compliance analysis

Beams, Skirting and Services are recorded so trades can coordinate around them; crossing into analysis would make BuildBox liable for engineering judgements it is not qualified to make.

1. Beams, Skirting, Services and Vertical Extents are documented for coordination only. Warnings are measured and non-blocking (for example, "Service overlaps this Placed Item by 35 mm."), and acknowledging one marks it "seen".
2. BuildBox provides no structural, load, span, sizing, flow, pressure, electrical, gas, fire, accessibility or building-code checks. This scope exclusion is permanent, not a backlog item.
3. User-facing strings follow the banned-wording rules of #24 and #27: "structural" never appears in Beam labels, properties or warnings; and compliant, safe, rated, approved, code, sized for, must and required never appear in Skirting/Service labels, properties, warnings or export headers. A banned-word scan over the centralised string tables enforces this.

## Consequences

- Warnings report measurements and never verdicts; an acknowledgement records that the user saw a fact, not that it passed.
- The exclusion is enforced by wording, so a future feature cannot quietly imply approval.

**Owning resolutions:** [#15 height and elevation behavior](https://github.com/chryston/buildbox/issues/15#issuecomment-6036200691), [#24 Beam documentation](https://github.com/chryston/buildbox/issues/24#issuecomment-6910428859), [#27 Skirting and documented Services](https://github.com/chryston/buildbox/issues/27#issuecomment-6910571373).
