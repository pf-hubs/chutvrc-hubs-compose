# Exports one example of Hubs Foundation's blender-behavior-graph-examples (a .blend file) to a GLB with its
# Hubs components (MOZ_hubs_components) and its behavior graph (MOZ_behavior), for the bitecs room of T6.7.
#
# Run headless, with both add-ons loaded for this run only (nothing is installed into Blender's own profile):
#   set BLENDER_USER_SCRIPTS=<folder holding addons/io_hubs_addon and addons/behavior_graphs>
#   blender.exe -b --factory-startup --python export.py -- <example.blend> <out.glb>
# README.md in this folder says where the add-ons and the example come from.
import sys

import addon_utils
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
if len(args) != 2:
    raise SystemExit("usage: blender -b --factory-startup --python export.py -- <example.blend> <out.glb>")
blend, out = args

# The Hubs exporter has to be loaded before the behavior graph add-on (its readme says so)
for module in ("io_hubs_addon", "behavior_graphs"):
    loaded, enabled = addon_utils.check(module)
    if not enabled:
        addon_utils.enable(module, default_set=True, persistent=True)
    loaded, enabled = addon_utils.check(module)
    print(f"[export] add-on {module}: loaded {loaded}, enabled {enabled}")
    if not enabled:
        raise SystemExit(f"add-on {module} could not be enabled; is BLENDER_USER_SCRIPTS set?")

# Opened after the add-ons, so their load handlers (the behavior graph add-on's migrations) run on the file
bpy.ops.wm.open_mainfile(filepath=blend)
print(f"[export] opened {blend}: {len(bpy.data.objects)} objects, {len(bpy.data.node_groups)} node groups")
for group in bpy.data.node_groups:
    print(f"[export] node group {group.name!r} ({group.bl_idname}), {len(group.nodes)} nodes")

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_extras=False,
    export_cameras=False,
    export_lights=True,
    export_apply=False,
    export_animations=True,
)
print(f"[export] wrote {out}")
