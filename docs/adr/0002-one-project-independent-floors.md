# One self-contained Project per property with independent Floors

A property's record has to travel as one portable unit, and the Floors of a building share no measured geometry that would justify coupling them.

1. A Project is the complete portable record for one property. It owns its Floors, one shared Existing Model, project-wide Design Options, project-owned Item Designs, the Placed Items that reference them, and its assets. It never live-references another Project; cross-Project copies get new IDs.
2. Each Floor is an independent spatial silo with:
   - its own local X/Y;
   - a local Floor Datum at Z = 0;
   - an optional, separately calibrated Plan Image;
   - a manual display order that implies no measured vertical relationship.
3. Cross-Floor alignment, stacking and coordination are deliberately out of scope. A Placed Item may live in the Existing Model or within a Design Option; that glossary conflict is settled in [#20 §15.1](https://github.com/chryston/buildbox/issues/20#issuecomment-6911090101).

**Owning resolutions:** [#13 canonical project model](https://github.com/chryston/buildbox/issues/13#issuecomment-6032793102), [#25 floors, levels, and vertical references](https://github.com/chryston/buildbox/issues/25#issuecomment-6036642096).
