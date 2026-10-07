# BuildBox

BuildBox models one property and its existing condition, renovation alternatives, designed items, and coordinated views as a portable project.

## Language

**Project**:
The complete portable record for one property, including its floors, existing model, design options, item designs, plan images, and supporting assets.
_Avoid_: Workspace, cabinet project, property file

**Floor**:
A distinct, independently modelled building level within a project, with its own spatial context and optional plan image.
_Avoid_: Plan image, floor plan image, storey drawing, layout alternative

**Plan Image**:
An optional calibrated reference image attached to a floor and displayed beneath editable model data. It is evidence for modelling, not canonical geometry.
_Avoid_: Floor, floor plan model, underlay

**Existing Model**:
The single shared representation of the property as surveyed before proposed renovation work. Corrections to it are visible to every design option.
_Avoid_: Base option, original design, existing layer

**Building Element**:
A fixed part of the property represented in the existing model or introduced by a design option, such as a wall, opening, beam, skirting, or documented pipe.
_Avoid_: Item, annotation, furniture

**Room**:
A named spatial area on one floor, represented in the existing model or changed by a design option.
_Avoid_: Building element, floor, annotation, wall enclosure

**Room Outline**:
The closed measured boundary that defines a room's floor-local area.
_Avoid_: Wall, partition, fill, visual overlay

**Design Option**:
A named, project-wide renovation alternative containing demolition and proposed changes relative to the shared existing model. A project may have no design options.
_Avoid_: Design, version, floor variant, layer

**Item Design**:
A project-owned definition of a designed or selected item, such as a cabinet, that can be reused by multiple placements.
_Avoid_: Item instance, template, global catalog item

**Item Footprint**:
The closed measured plan boundary of an item design in its local coordinates.
_Avoid_: Plan symbol, placed-item bounding box, icon

**Item Origin**:
The local reference point of an item design used to position and rotate its placed items.
_Avoid_: Floor origin, visual center, placement position

**Placed Item**:
A placement of an item design on a floor and within a design option. It owns placement context, not a copy of the item design.
_Avoid_: Item design, cabinet project

**Project Backup**:
A complete, user-owned `.buildbox` file from which one project and all of its assets can be restored independently of browser storage.
_Avoid_: Export, local save, workspace JSON

**Recovery Point**:
A bounded local snapshot used to return a project to an earlier valid state. It is browser-managed recovery history, not a project backup.
_Avoid_: Backup, design option, undo step

**Floor Datum**:
The vertical reference plane for a floor, normally its finished floor surface, from which floor-relative elevations are measured.
_Avoid_: Ground level, project zero, floor height

**Vertical Extent**:
The bottom-to-top interval occupied by an entity relative to its floor datum.
_Avoid_: Height, elevation

**Plan View Range**:
The vertical interval that a plan view presents as its primary visible content, with relevant content above or below shown as context.
_Avoid_: Layer, floor bounds, clipping plane

**Plan View**:
A saved 2D projection of one floor, with its own presentation and visibility context.
_Avoid_: Floor, plan image, design option

**Elevation View**:
A named orthographic 2D projection of one floor, defined from a plan viewing line, direction, and finite depth.
_Avoid_: 3D view, multi-floor view, side image, item preview

**Clearance Envelope**:
An explicit user- or manufacturer-supplied volume that should remain free around an entity.
_Avoid_: Building-code rule, structural check, visual padding
