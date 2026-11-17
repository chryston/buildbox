import { expectTypeOf, it } from 'vitest'
import type {
  Accessory,
  AccessoryType,
  Annotation,
  AnnotationType,
  CabinetMaterialId,
  CabinetNode,
  CabinetSceneUnit,
  CustomTemplate,
  Design,
  Divider,
  DrawerConfig,
  ElementType,
  FloorPlanData,
  FloorPlanImage,
  FloorPlanObject,
  FloorPlanObjectType,
  GlobalSettings,
  SlideType,
  SplitAxis,
  ToeKick,
  Unit,
} from '../types'
import type {
  LegacyAccessory,
  LegacyAccessoryType,
  LegacyAnnotation,
  LegacyAnnotationType,
  LegacyCabinetMaterialId,
  LegacyCabinetNode,
  LegacyCabinetSceneUnit,
  LegacyCustomTemplate,
  LegacyDesign,
  LegacyDivider,
  LegacyDrawerConfig,
  LegacyElementType,
  LegacyFloorPlanData,
  LegacyFloorPlanImage,
  LegacyFloorPlanObject,
  LegacyFloorPlanObjectType,
  LegacyGlobalSettings,
  LegacySlideType,
  LegacySplitAxis,
  LegacyToeKick,
  LegacyUnit,
} from '../package'

/**
 * #40 §1: `package/legacy` copies the shapes in `src/types` instead of importing them —
 * `src/types` is deleted at the S4 cutover and the reader lives on. A copy that drifts is
 * a reader that quietly stops matching stored data, so the two are pinned together for as
 * long as both exist. Delete this file with `src/types`.
 */
it('copies the v3 vocabulary word for word', () => {
  expectTypeOf<LegacyUnit>().toEqualTypeOf<Unit>()
  expectTypeOf<LegacySplitAxis>().toEqualTypeOf<SplitAxis>()
  expectTypeOf<LegacyCabinetMaterialId>().toEqualTypeOf<CabinetMaterialId>()
  expectTypeOf<LegacyElementType>().toEqualTypeOf<ElementType>()
  expectTypeOf<LegacySlideType>().toEqualTypeOf<SlideType>()
  expectTypeOf<LegacyAccessoryType>().toEqualTypeOf<AccessoryType>()
  expectTypeOf<LegacyAnnotationType>().toEqualTypeOf<AnnotationType>()
  expectTypeOf<LegacyFloorPlanObjectType>().toEqualTypeOf<FloorPlanObjectType>()
})

it('copies the v3 shapes word for word', () => {
  expectTypeOf<LegacyToeKick>().toEqualTypeOf<ToeKick>()
  expectTypeOf<LegacyDrawerConfig>().toEqualTypeOf<DrawerConfig>()
  expectTypeOf<LegacyGlobalSettings>().toEqualTypeOf<GlobalSettings>()
  expectTypeOf<LegacyAccessory>().toEqualTypeOf<Accessory>()
  expectTypeOf<LegacyDivider>().toEqualTypeOf<Divider>()
  expectTypeOf<LegacyFloorPlanObject>().toEqualTypeOf<FloorPlanObject>()
  expectTypeOf<LegacyAnnotation>().toEqualTypeOf<Annotation>()
  expectTypeOf<LegacyFloorPlanImage>().toEqualTypeOf<FloorPlanImage>()
  expectTypeOf<LegacyCustomTemplate>().toEqualTypeOf<CustomTemplate>()
  expectTypeOf<LegacyFloorPlanData>().toEqualTypeOf<FloorPlanData>()
})

// The three shapes the reader cannot copy exactly: a frozen node also describes the
// `material` field that persist v2 dropped, and it appears inside the unit and the Design.
it('stays interchangeable with src/types where it keeps an older field', () => {
  expectTypeOf<LegacyCabinetNode>().toMatchTypeOf<CabinetNode>()
  expectTypeOf<CabinetNode>().toMatchTypeOf<LegacyCabinetNode>()
  expectTypeOf<LegacyCabinetSceneUnit>().toMatchTypeOf<CabinetSceneUnit>()
  expectTypeOf<CabinetSceneUnit>().toMatchTypeOf<LegacyCabinetSceneUnit>()
  expectTypeOf<LegacyDesign>().toMatchTypeOf<Design>()
  expectTypeOf<Design>().toMatchTypeOf<LegacyDesign>()
})
