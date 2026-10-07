# BuildBox

BuildBox models one property and its existing condition, renovation alternatives, designed items, and coordinated views as a portable project.

## Language

**Project**:
The complete portable record for one property, including its floors, existing model, design options, item designs, plan images, and supporting assets.
_Avoid_: Workspace, cabinet project, property file

**Floor**:
A distinct building level within a project.
_Avoid_: Plan image, floor plan image, storey drawing

**Plan Image**:
An optional calibrated reference image attached to a floor and displayed beneath editable model data. It is evidence for modelling, not canonical geometry.
_Avoid_: Floor, floor plan model, underlay

**Existing Model**:
The single shared representation of the property as surveyed before proposed renovation work. Corrections to it are visible to every design option.
_Avoid_: Base option, original design, existing layer

**Building Element**:
A fixed part of the property represented in the existing model or introduced by a design option, such as a wall, opening, beam, skirting, or documented pipe.
_Avoid_: Item, annotation, furniture

**Design Option**:
A named, project-wide renovation alternative containing demolition and proposed changes relative to the shared existing model. A project may have no design options.
_Avoid_: Design, version, floor variant, layer

**Item Design**:
A project-owned definition of a designed or selected item, such as a cabinet, that can be reused by multiple placements.
_Avoid_: Item instance, template, global catalog item

**Placed Item**:
A placement of an item design on a floor and within a design option. It owns placement context, not a copy of the item design.
_Avoid_: Item design, cabinet project

**Project Backup**:
A complete, user-owned `.buildbox` file from which one project and all of its assets can be restored independently of browser storage.
_Avoid_: Export, local save, workspace JSON

**Recovery Point**:
A bounded local snapshot used to return a project to an earlier valid state. It is browser-managed recovery history, not a project backup.
_Avoid_: Backup, design option, undo step
