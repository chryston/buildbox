# HDB BTO dimensions for BuildBox presets

**Date:** 2026-10-30  
**Issue:** [#33 — Research common HDB BTO dimensions for presets](https://github.com/chryston/buildbox/issues/33)  
**Audience:** BuildBox homeowners experimenting with layouts, not design professionals.

**Question.** What are the common HDB BTO flat dimensions BuildBox should ship as editable starter presets? Cover floor-to-ceiling height (confirm 2600 mm), internal/partition and external/structural wall thicknesses, door openings per room type (main entrance, bedroom, bathroom/WC, kitchen, household shelter), common window/opening sizes and sill heights, and household-shelter constraints.

All values are millimetres unless noted. Each value carries a source reference and a confidence label:

| Confidence | Meaning |
|---|---|
| **High** | Stated outright in an HDB, BCA, or SCDF primary document. |
| **Medium** | Derived from a primary dimension, or stated only as a range / one HDB design. |
| **Low** | Industry convention or secondary-source consensus, not codified by HDB/BCA/SCDF. Measure the actual flat before relying on it. |

The short answer to "confirm 2600 mm": **2600 mm is the right homeowner default**, but the structural clear height in HDB's standard precast design is **2625 mm** (2800 mm floor-to-floor minus a 175 mm slab). Floor finishes and screed reduce it; HDB permits up to 50 mm of floor build-up. HDB's own guidance treats 2400 mm as the minimum usable ceiling clearance, and BCA's statutory minimum is also 2400 mm.

---

## 1. Recommended preset pack

These are the values to ship in a **"HDB BTO (typical)"** starter pack. Preset names are deliberately plain-language; technical detail sits in sections 2–6.

### 1.1 Walls and height

| Homeowner preset | Default | Also offer | Confidence | Primary basis |
|---|---:|---:|---|---|
| Wall / ceiling height (whole flat) | **2600** | 2625 (structural clear), 2400 (minimum) | High | HDB precast guide §1.5 + Figure 1A; BCA AD C.3.3.1 |
| Internal wall (drywall / lightweight partition) | **100** | 63 (hollow block), 80 (glass block), 120 (kitchen wall) | Medium | HDB renovation guidelines "Walls"; HDB precast guide Figure 2A; BCA COP drywall mandate |
| Kitchen wall | **120** | 100 | High | HDB precast guide Figure 2A |
| External wall / façade | **150** | 100 (bathroom, service-yard and corridor-facing façade) | High | HDB precast guide Figure 2A |
| Gable-end wall | **175** | — | High | HDB precast guide Figure 2A |
| Party / shared wall with neighbour | **200** | — | Low | Industry convention; HDB plans vary. Treat as structural. |
| Structural RC wall (locked) | **150–200** | 175 / 250 | Low–Medium | HDB precast guide Figure 2A (150 façade, 175 gable); RC wall thickness varies by design |
| Household-shelter wall (locked) | **250** | 300 (blocks above 40 storeys) | High | HDB precast guide Figure 2A; SCDF TRHS 2.3.1 |

> **Rule for BuildBox:** structural RC walls and household-shelter walls are not editable and cannot be hacked. HDB's renovation rules say RC walls cannot be hacked or tampered with, and any new door frame must sit within the original opening [H3].

### 1.2 Doors (plan opening = wall gap; leaf = door panel)

Homeowners pick doors by leaf size, but a floor plan needs the **opening** (the gap in the wall). Ship both, with the opening used for geometry.

| Homeowner preset | Opening W × H | Typical leaf | Confidence | Primary basis |
|---|---:|---:|---|---|
| Main entrance door | **1000 × 2190** | 900 × 2100 | High (opening) / Medium (leaf) | HDB SOR item 0202 (1000 × 2190); width range 850–1200 × 2100–2200 in items 0199–0201 [H6] |
| Main gate (2-leaf) | **1000 × 2190** | — | High | HDB SOR items 0519/0520 [H6] |
| Main gate (3-leaf) | **1200 × 2190** | — | High | HDB SOR items 0521/0522 [H6] |
| Bedroom door | **900 × 2100** | 800 × 2100 | High (opening width) / Medium (height, leaf) | BCA COP Table 2C (900 standard opening); HDB SOR item 0196 (900–1200 × 2000/2190) [H6] |
| Bathroom / WC door | **800 × 2100** | 700 × 2100 | Low–Medium | HDB EASE treats entrances under 700 as narrow and widens them to at most 900 [H8]; common HDB replacement practice. Measure the actual opening. |
| Kitchen door (sliding) | **850 × 2190** | — | High (when a door exists) | HDB SOR item 0203 (single sliding door 850 × 2190) [H6]; many BTO kitchens are open or have no door |
| Balcony / service-yard sliding door | **1750 × 2190** (2-panel) or **2750 × 2190** (3-panel) | — | High | HDB SOR items 0204/0205 [H6] |
| Household-shelter door | **700 × 1900** clear opening | Steel HS door | High | SCDF TRHS 2.5.1(a) [S3] |

Door-related constraints:

- Main entrance door/frame on a fire escape route must be **half-hour fire-rated**, with a self-closing device and accreditor's label [H3].
- Digital locksets must be certified to **SS 332 / EN 1634-1** with a local Certificate of Conformity [H3].
- New internal door frames must be **within the original opening**; repositioning an internal entrance is allowed only if the new opening is not cut through RC walls [H3].
- Sliding or folding doors on bathroom/WC/kitchen entrances are allowed without removing an RC lintel/hanger [H3].
- HDB replacement gates must keep the **original width, number of panels and swing** [H3].

### 1.3 Windows

| Homeowner preset | Default | Confidence | Primary basis |
|---|---:|---|---|
| Standard bedroom window (sill / height / head) | **1050 / 1250 / 2300** | High | HDB precast guide Figure 1A section: 1050 sill + 1250 window + 325 to ceiling = 2625 clear |
| Full-height window (parapet / railing) | **300** parapet + railing to barrier height | High | HDB June 2026 BTO brochure window legend: W1 = full-height with railing, approx. 300 high parapet [H7] |
| Three-quarter-height window (parapet) | **550** | High | Same brochure legend: W2 = three-quarter height, approx. 550 high parapet [H7] |
| Minimum window cill | **1000** | High | HDB General Technical Requirements A1(b) [H2]; BCA barrier height H.3.2.1(a) [B2] |
| Casement leaf maximum width | **700** | High | HDB window works requirements [H5] |
| Sliding window panel maximum width | **1200** | High | HDB window works requirements [H5] |
| Typical bedroom window width | **1200–1400** | Low | Derived from 2 casement leaves × 700 max; not standardised |
| Typical living-room window width | **1500–2400** | Low | Derived from sliding-panel limits and published plans; not standardised |
| Typical kitchen window | **900–1200 × 1250** | Low | Common plan practice; not standardised |
| Typical bathroom window | **600 × 600 louvre**, sill ~1500 | Low | Common plan practice; not standardised |

Window-related constraints:

- Replacement/installation requires a **BCA Approved Window Contractor** listed with HDB, and a renovation permit [H5].
- Replacement of **full-height windows** (including ¾-height and bay windows) is **strictly not allowed** except where a damaged frame needs complete replacement [H5].
- The 300/550 parapet values describe the wall below the glass, not the safety barrier. BCA requires a barrier of at least **1000 mm** from finished floor level, which is why full-height and ¾-height windows come with railings [B2].
- Window widths are the least standardised item here. Ship ranges, let the homeowner type the measured width, and do not present a width as code-compliant.

### 1.4 Household shelter (fixed object, never a normal room)

| Property | Value | Confidence | Source |
|---|---:|---|---|
| Minimum internal floor area (GFA 75–140 m², typical 4-room) | **2.8 m²** | High | SCDF TRHS Table 2.2.1(b); BCA COP Table 2A |
| Standard internal dimensions | **1450 × 1950** (or 1650 × 1700) | High | BCA COP Table 2A |
| Wall thickness | **250** (300 above 40 storeys) | High | SCDF TRHS 2.3.1; HDB precast guide Figure 2A |
| Clear height | **2625** typical; **2400** minimum; 3900 maximum | High | HDB precast guide Figure 1A (2625); SCDF TRHS 2.2.2 |
| Door clear opening | **700 × 1900** | High | SCDF TRHS 2.5.1(a) |
| RC nib beside door frame | **≥150** (300 each side for precast Type 1) | High | SCDF TRHS 2.5.2 |
| Slab outside HS door | **≥125** thick, structurally connected | High | SCDF TRHS 2.5.3 |
| Footprint including walls | approx. **1950 × 2450** for a 1450 × 1950 internal HS | Medium | Arithmetic: internal + 250 wall each side |

Household-shelter rules that affect a floor planner:

- HS **reinforced walls, floor slab, ceiling and steel door must not be tampered with** [H3].
- **No hacking** of HS walls, floor or ceiling; drilling into the internal face is allowed only to **50 mm depth**, for non-metallic inserts and removable screws [H3].
- Floor finish + screed must not exceed **50 mm**; adhesive fixing and a second layer of floor finish are not allowed; skirting is limited to **100 mm high** [H3].
- No cornices or false ceiling inside the HS; false ceiling outside/below ventilation sleeves needs **600 × 600** perforated access panels [H3].
- Fixtures that cannot be removed quickly in an emergency should not be placed in the HS; fixtures on the internal face must be removable within 48 hours [H3].
- Ventilation sleeves must remain usable: at least **25%** of the total area of the two openings left uncovered in peacetime [H3].
- Do not model the HS as an editable room; model it as a locked block with a 700 × 1900 door and 250 walls.

---

## 2. Floor-to-ceiling height — detail

**Recommended default: 2600 mm. Structural clear height: 2625 mm. Statutory minimum: 2400 mm.**

HDB's *Precast Pictorial Guide* states [H1, §1.5, p.2]:

> "Floor-to-floor height is usually 3.6m from 1st to 2nd storey, and typical floor-to-floor height shall be 2.8m."

The same guide's section (Figure 1A, p.3) dimensions a typical storey as:

- **2800 mm** floor-to-floor
- **175 mm** slab
- **2625 mm** clear height in bedroom and household shelter
- **325 mm** from window head to underside of slab (with a minimum of 300 mm)
- **1050 mm** window sill + **1250 mm** window height = **2300 mm** head height

So 2600 mm is not arbitrary: it is the 2625 mm structural clear height rounded down to the nearest 100 mm, allowing roughly 25 mm for floor finish. HDB permits floor finishes and screed up to **50 mm** total [H3], which puts the finished clear height in the range **2575–2625 mm**. Use 2600 as the nominal preset and let users adjust.

Statutory and HDB minima:

- BCA Approved Document C.3.3.1: ceiling height of rooms and spaces **shall not be less than 2.4 m**, measured from finished floor level to the underside of any slab, false ceiling, or suspended ceiling, whichever is lower [B2].
- HDB false-ceiling rules: minimum clearance **2.4 m** from finished floor level; **not applicable to toilets and bathrooms**. Pelmet clearance at least **2.1 m** [H3].

This means a 2400 mm bathroom or a 2400 mm false-ceiling zone is legal and common. Presets should therefore allow **2400 mm** without warning, and warn below 2400 mm.

---

## 3. Wall thickness — detail

HDB's precast guide Figure 2A labels the components of a standard HDB residential unit (p.5) [H1]:

| Component | Thickness | Notes from figure |
|---|---:|---|
| Precast infill wall (living/dining side) | **100** | Between living/dining areas |
| Precast infill wall (kitchen side) | **120** | Between kitchen/kitchen and kitchen/living-dining |
| Precast façade (K1F) | **150** | General external façade |
| Precast façade at bathroom (K1HF) | **100** | Bathroom external wall |
| Precast façade facing access corridor (K1HF) | **100** | Corridor-facing wall |
| Precast façade at service yard (KP) | **100** | Service-yard wall |
| Precast gable-end wall (KGW) | **175** | Gable end |
| Precast household-shelter wall (HW) | **250** below/at 40 storeys; **300** above 40 storeys | Reinforced |
| Façade acting as non-structural column clad | **120** | Not a structural wall |

HDB's renovation guidelines add the lightweight options owners may actually build [H4, "Walls"]:

- **63 mm** hollow block wall (one layer only)
- **80 mm** glass block wall (one layer only)
- **Gypsum partition** (drywall)
- An RC lintol is required over any opening in a hollow-block wall (window or door)
- Only one layer of 63 mm hollow block or 80 mm glass block may be erected

BCA's buildability rules require **drywall for all internal dry areas**, excluding party walls, toilet walls and kitchen walls [B3]. That is why a 100 mm internal partition is the right default: it is a drywall/lightweight assembly, not a 100 mm structural wall.

**Party walls.** The precast guide does not label the separating wall between two units in Figure 2A. HDB party walls are normally reinforced concrete and commonly modelled at **200 mm**, but this is not confirmed by the documents reviewed. Mark the preset **Low confidence** and lock it as structural; the actual flat's plan wins. Do not derive "not structural" from a thin wall: a 100 mm precast infill can still be a party element, and HDB's rule is categorical — RC walls cannot be hacked [H3].

**Structural status is a separate axis from thickness.** BuildBox should store both `thickness` and `structural: true/false`, and only allow editing non-structural walls.

---

## 4. Doors — detail and reasoning

### 4.1 Opening vs leaf

HDB and BCA documents generally state **opening sizes**, while door vendors quote **leaf sizes**. A typical relationship is:

```
opening width ≈ leaf width + frame + installation tolerance (≈ 100 mm)
opening height ≈ leaf height + frame + threshold (≈ 90 mm)
```

That is why the main entrance is **1000 × 2190** as an opening but is commonly sold as a **900 × 2100** leaf. BuildBox should use the opening for the wall gap and display the leaf as a secondary field.

### 4.2 What the primary documents actually fix

| Door | Fixed by primary source? | Value |
|---|---|---|
| Main entrance | Yes — common standard opening | **1000 × 2190** [H6, item 0202]; other HDB rate items cover 850–1200 × 2100–2200 |
| Main gate | Yes — standard gate opening | **1000 × 2190** (2-leaf) or **1200 × 2190** (3-leaf) [H6, items 0519–0522] |
| Bedroom | Partly — standard structural opening width | **900** minimum standard width [B3, Table 2C]; HDB rate item range 900–1200 × 2000/2190 [H6, item 0196] |
| Bathroom/WC | No fixed HDB dimension found; EASE treats <700 as narrow | Use **800 × 2100** opening / **700 × 2100** leaf as an editable default (Low–Medium) |
| Kitchen | Only if a door is fitted; 850 single sliding door is an HDB rate item | **850 × 2190** (High when present); default to **no door** for open BTO kitchens |
| Household shelter | Yes — clear opening | **700 × 1900** [S3, 2.5.1(a)] |
| Balcony/yard sliding | Yes — HDB rate items | **1750 × 2190** (2-panel), **2750 × 2190** (3-panel) [H6, items 0204–0205] |

BCA Table 2C lists standard **door structural openings** of 900, 1000, 1100, 1200, 1250, 1500 and 2000 mm, and makes adopting up to three of these sizes mandatory for residential non-landed projects [B3]. The 900 and 1000 sizes are the ones that correspond to typical bedroom and main-entrance openings respectively (this mapping is an inference from HDB practice, not stated in Table 2C); the larger sizes are for special/wide openings, not ordinary room doors. Do not treat the full list as room-door presets.

### 4.3 Door constraints worth surfacing in the UI

- **Main entrance on an escape route:** half-hour fire-rated door and frame, self-closing device, accreditor's label; digital lock must be SS 332 / EN 1634-1 certified [H3].
- **Gate:** width, panel count and swing must match what HDB provided [H3].
- **Internal doors:** the new frame must be within the original opening; do not cut a new opening through RC walls [H3].
- **Bathroom/kitchen:** sliding or folding doors may be installed without removing an RC lintel/hanger [H3].
- **Household shelter:** the steel door is part of the shelter and must not be modified, removed or covered [H3].

---

## 5. Windows — detail and reasoning

### 5.1 Sill heights

Three different HDB conditions exist, and a floor planner needs all three:

| Condition | Sill / parapet | Head | Source |
|---|---:|---:|---|
| Standard bedroom window | **1050** | **2300** (window 1250 high) | HDB precast guide Figure 1A section [H1] |
| Three-quarter-height window | **550** (parapet wall) + railing | full height/2300 | HDB BTO brochure window legend [H7] |
| Full-height window | **300** (parapet wall) + railing | ceiling (≈2600) | HDB BTO brochure window legend [H7] |
| Minimum cill / barrier | **1000** | — | HDB General Technical Requirements A1(b) [H2]; BCA AD H.3.2.1(a) [B2] |

The apparent contradiction is resolved by the safety barrier: the window glass can start at 300 or 550 mm, but a railing/barrier must still provide protection to at least 1000 mm above finished floor level. BCA's requirement is a barrier height of not less than 1.0 m [B2]. HDB's own technical requirement separately says window cill height shall be not less than 1.0 m [H2]; the low-parapet window types are the designed exceptions with railings.

For presets:

- **"Standard window"**: sill 1050, height 1250, head 2300.
- **"Full-height window"**: opening from 300 to ceiling, with a railing/barrier to 1000.
- **"¾-height window"**: opening from 550 to 2300 (or ceiling), with a railing/barrier to 1000.
- Warn if a new window sill is below 1000 without a barrier.

### 5.2 Widths

Widths are the weakest data point. HDB does not publish a standard window-width schedule in the documents reviewed; BTO brochures draw windows to scale but label only the type (W1/W2) and parapet height, not width. The only hard limits are:

- Casement window leaf **maximum 700 mm** wide [H5].
- Sliding window panel **maximum 1200 mm** wide [H5].

Therefore:

- A 2-leaf casement window is at most **1400 mm** wide.
- A 2-panel sliding window is at most **2400 mm** wide; a 3-panel is at most **3600 mm**.
- Practical defaults: bedroom **1400 × 1250**, living **1800 × 1250** or **2400 × 1250**, kitchen **1000 × 1250**, bathroom **600 × 600 louvre** high on the wall.
- Mark all widths **Low confidence** and make them editable. Do not claim a width is HDB-standard.

### 5.3 Replacement constraints

- Engage a **BCA Approved Window Contractor** from HDB's directory; apply for an HDB renovation permit [H5].
- Replacement of **full-height, ¾-height and bay windows is not allowed** except for a damaged frame requiring complete replacement [H5].
- Window films must be non-reflective or ≤20% reflectance; grilles/blinds must not block ventilation [H5].

---

## 6. Household shelter — detail

The household shelter is a civil-defence structure, not a room. SCDF's *Technical Requirements for Household Shelters 2023* (TRHS) sets the envelope, and HDB's renovation guidelines set what owners may do to it.

### 6.1 Size

SCDF Table 2.2.1(b) [S3]:

| GFA of dwelling | Minimum internal floor area | Minimum internal volume |
|---|---:|---:|
| ≤ 40 m² | 1.44 m² | 3.6 m³ |
| 40–45 m² | 1.60 m² | 3.6 m³ |
| 45–75 m² | 2.20 m² | 5.4 m³ |
| 75–140 m² | **2.80 m²** | 7.2 m³ |
| > 140 m² | 3.40 m² | 9.0 m³ |

A typical 4-room BTO flat is in the **75–140 m² GFA** band, so its HS is **2.8 m²** internal. BCA's industry-standard precast HS table gives these allowed internal dimensions for that band [B3, Table 2A]:

```
1.20 × 2.35   1.20 × 2.40   1.25 × 2.30   1.25 × 2.35
1.30 × 2.20   1.35 × 2.10   1.45 × 1.95   1.65 × 1.70
```

**Suggested preset: 1450 × 1950 internal, 250 walls → 1950 × 2450 footprint.** Offer 1650 × 1700 as the alternate.

SCDF also caps the internal length of any floor/roof slab at **4000 mm**, sets a minimum internal width of **1200 mm**, requires dimensions in **50 mm increments**, and caps the internal floor area at **4.8 m²** without special approval [S3, 2.2.1].

### 6.2 Height and walls

- HS clear height: **minimum 2400 mm, maximum 3900 mm** [S3, 2.2.2]. HDB's standard section shows **2625 mm** clear, matching the flat's structural clear height [H1].
- HS wall thickness for non-landed development: **250 mm** for typical storey heights; **300 mm** where clear height exceeds 3200 mm or where the design requires it [S3, 2.3.1]. HDB's guide labels 250 mm up to 40 storeys and 300 mm above [H1].
- The common wall between two adjacent HS is at least **200 mm** [S3, 2.3.1(c)].
- HS slabs: 300 mm ceiling slab at the top-most HS, 175 mm between HS, 200 mm floor slab at the bottom-most HS [S3, 2.3.2].

### 6.3 Door

- Clear opening **700 mm wide × 1900 mm high** [S3, 2.5.1(a)].
- Minimum **150 mm** RC nib beside the vertical edge of the frame; for precast Type 1, **300 mm** each side [S3, 2.5.2].
- The door must open at least **90°** and sit above finished floor level [S3, 2.5.2(e)].
- The RC ceiling slab immediately outside the HS wall with the door is at least **125 mm** thick and structurally connected [S3, 2.5.3].

### 6.4 What owners may not do (HDB renovation rules)

- Hacking or tampering with reinforced walls, floor slab, ceiling or steel door [H3].
- Hacking HS walls to form a key for tiling, on either internal or external face [H3].
- Drilling deeper than **50 mm** into the internal face; only non-metallic inserts and removable screws are allowed [H3].
- Laying floor finishes with adhesive, a second layer, or more than **50 mm** total build-up [H3].
- Skirting higher than **100 mm** [H3].
- Installing cornices or a false ceiling inside the HS; false ceilings below ventilation sleeves need 600 × 600 access panels [H3].
- Modifying, removing or covering the HS door notice, locking bolts, door seal, ventilation sleeves, fragmentation plates or their bolts [H3].
- Placing fixtures that cannot be removed quickly in an emergency; internal fixtures must be removable within 48 hours [H3].
- Blocking ventilation: at least **25%** of the total area of the two ventilation openings must remain uncovered in peacetime [H3].

---

## 7. Implications for BuildBox presets

1. **Ship one "HDB BTO (typical)" pack, not a hundred project-specific packs.** The dimensions above cover the common case. HDB projects vary (a published plan in the review sample shows room dimensions such as 3288, 3700, 4788 and 1500), so every preset must be editable and the UI should say "starting point — check your HDB floor plan."

2. **Separate geometry from semantics.** A wall needs `thickness` and `structural`; a door needs `opening` and `leaf`; a window needs `sill`, `height`, `head` and `barrier`. Collapsing these into one number creates wrong plans and misleading warnings.

3. **Lock structural walls and the HS by default.** Do not let a homeowner drag or delete a 250 mm HS wall or an RC wall. Show a plain-language badge ("Structural — cannot be removed") rather than a technical code reference.

4. **Use 2600 mm as the nominal height, 2400 mm as the warning threshold.** 2600 matches the rounded structural clear height and the common "2.6 m HDB ceiling" belief. 2400 is both HDB's false-ceiling minimum and BCA's statutory minimum.

5. **Do not present window widths as standard.** Sill heights and maximum leaf/panel widths are hard data; overall window widths are not. Default to sensible ranges and ask the homeowner to measure.

6. **Bathroom doors are the main soft spot.** HDB's EASE programme treats toilet entrances below 700 mm as narrow and widens them to at most 900 mm, but no current HDB standard fixes a BTO bathroom door at 700 or 800 mm. Use 800 opening / 700 leaf as an editable default and label it "typical, verify."

7. **Kitchens often have no door.** Default the kitchen preset to an open opening; offer 850 × 2190 sliding and folding options.

8. **Use the HS as a fixed placement object.** A 1950 × 2450 footprint (1450 × 1950 internal + 250 walls) is a useful default; the shelter cannot be resized, opened up, or have its door moved.

---

## 8. Sources

Primary documents reviewed on 2026-10-30. Page/clause numbers refer to the documents as published.

| Ref | Source |
|---|---|
| **H1** | Housing & Development Board, *Precast Pictorial Guide* (2014), hosted by BCA: <https://www.bca.gov.sg/publications/BuildabilitySeries/others/HDB_Precast_pictorial_guide_BCA.pdf> — §1.5 (floor-to-floor 2.8 m), Figure 1A (2800/175/2625; window 1050 sill + 1250 height + 2300 head; 325 min 300 above), Figure 2A (wall thicknesses: 100/120/150/175/250/300). |
| **H2** | HDB, *General Technical Requirements* (HDB(ARCH), 15 Mar 2012, v3): <https://www.hdb.gov.sg/-/media/business-partners/building-professionals-bgbiz/submitting-building-plans/documents-and-checklists/hdb-arch-technical-requirements.pdf> — A1(b): window cill height not less than 1.0 m. |
| **H3** | HDB, *Renovation Guidelines for Building Works*: <https://www.hdb.gov.sg/managing-my-home/renovation-and-maintenance/renovation/renovation-guidelines/building-works> — Walls (63 mm hollow block / 80 mm glass block / gypsum partition; RC lintol over openings), False ceiling (2.4 m clearance, not applicable to toilets/bathrooms; pelmet 2.1 m), Floor/Wall finishes (≤50 mm / ≤13 mm), Kitchen, Bathroom, Household shelters (tamper/drilling/finish/ventilation rules), Door and gate (gate must match HDB width/panels/swing; new frame within original opening; RC walls cannot be hacked; repositioning internal doors not through RC; sliding/folding bathroom/kitchen doors allowed; main door on escape route half-hour fire-rated; SS 332/EN 1634-1 digital locks). |
| **H5** | HDB, *Renovation Guidelines for Window Works*: <https://www.hdb.gov.sg/managing-my-home/renovation-and-maintenance/renovation/renovation-guidelines/window-works> — casement leaf max 700 mm; sliding panel max 1.2 m; safety devices; BCA Approved Window Contractor and HDB permit; full-height/¾-height/bay replacement not allowed except damaged frame; window films ≤20% reflectance. |
| **H6** | HDB, *Standard Schedule of Rates for Building Tradesmen and Repair Works* (Jan 2020): <https://service.meettaiwan.com/gpa/media/attachments/41c8b519-ee6e-4f1e-b56c-74523813cf0d/08a_SOR%20HMG201201BUILDING%202020.pdf> — items 0196 (bedroom/bath door opening 900–1200 × 2000/2190), 0199–0202 (main entrance 850–1200 × 2100–2200; item 0202 1000 × 2190), 0203–0205 (sliding doors 850/1750/2750 × 2190), 0519–0522 (gates 1000/1200 × 2190). This is an HDB-authored rates schedule (not a design standard); it is used to corroborate common sizes. |
| **H7** | HDB, *June 2026 BTO sales brochure — Berlayar Rise*: <https://assets.hdb.gov.sg/residential/buying-a-flat/finding-a-flat/sales-brochure/26JUNBTO_pdf_selection/berlayar_rise.pdf> — window legend: W1 full-height window with railing (approx. 300 mm high parapet wall), W2 three-quarter-height window (approx. 550 mm high parapet wall), all other windows "standard height"; flat specifications: entrance laminated timber door and metal gate, bathroom/WC laminated UPVC folding door, household shelter steel door. |
| **H8** | HDB, *Enhancement for Active Seniors (EASE)*: <https://www.hdb.gov.sg/managing-my-home/upgrading-and-redevelopment/enhancement-for-active-seniors-ease> — toilet/bathroom entrance width criterion: existing entrance less than 700 mm; widened to a maximum of 900 mm. |
| **B2** | BCA, *Approved Document* (Building Control Regulations, v7.02A, Sep 2019): <https://www.bca.gov.sg/publications/BuildingControlAct/others/Approveddocument.pdf> — C.3.3.1 ceiling height ≥2.4 m (p.21); H.3.2.1(a) barrier height ≥1.0 m. |
| **B3** | BCA, *Code of Practice on Buildability* (2022): <https://isomer-user-content.by.gov.sg/338/7aecf16a-f0bf-4eca-8735-dd9c81b4510a/cop-on-buildability-20220f6b47e85361460a975ce6e3b54156ac.pdf> — Table 2A (industry-standard precast HS: 2.8 m², internal dimensions, 250/300 walls); Table 2B (industry-standard PBU internal dimensions); Table 2C (standard door structural openings 900–2000 mm); drywall mandate for internal dry areas excluding party/toilet/kitchen walls. |
| **S3** | SCDF, *Technical Requirements for Household Shelters 2023*: <https://www.scdf.gov.sg/home/civil-defence-shelter/acts-and-requirements/technical-requirements-for-household-shelters-2023> — clause 2.2 (size, 2.8 m² for GFA 75–140, 2400–3900 clear height, 50 mm increments, 4.8 m² max), 2.3 (wall 250/300, slabs), 2.5 (door 700 × 1900, 150 mm nib, 125 mm slab outside). |

---

## 9. Uncertainty register

Items to keep editable and out of any "validated/code-compliant" claim:

| Item | Why uncertain | What to do |
|---|---|---|
| 2600 mm ceiling | Structural clear is 2625 mm; finished height depends on screed/tiles (up to 50 mm) and false ceiling | Default 2600; allow 2625/2400; warn below 2400 |
| Party wall 200 mm | Not labelled in HDB precast guide; varies by block and structural system | Lock as structural; label "check plan" |
| Bathroom door 800/700 | No current HDB standard dimension found; EASE only says <700 is narrow | Editable; label typical, verify |
| Bedroom door leaf 800 | Primary sources fix the 900 opening, not the leaf | Derive leaf from opening; let user override |
| Window widths | HDB publishes types and maximum leaf/panel widths, not overall widths | Ship ranges; require measurement |
| Bathroom window | Not dimensioned in reviewed sources | Ship 600 × 600 high-level louvre as a low-confidence default |
| HS footprint | Depends on GFA band and chosen standard internal size | Offer 1450 × 1950 and 1650 × 1700; 250 walls |
| Wall "structural" status | Thickness alone does not determine it; RC walls cannot be hacked | Store structural flag separately; default to locked when in doubt |
