# A Behavior Graph scene for T6.7

T6.7 runs a scene from Hubs Foundation's [blender-behavior-graph-examples](https://github.com/Hubs-Foundation/blender-behavior-graph-examples) (MPL 2.0) in the `bitecs` room. The repository holds only `.blend` files, so one has to be exported to a GLB with two Blender add-ons: the Hubs exporter ([hubs-blender-exporter](https://github.com/Hubs-Foundation/hubs-blender-exporter), module `io_hubs_addon`, writes `MOZ_hubs_components`) and the Behavior Graph editor ([blender-gltf-behavior-graph](https://github.com/Hubs-Foundation/blender-gltf-behavior-graph), writes `MOZ_behavior`; Blender 3.6 to 4.4). `export.py` loads both for one headless run, without installing them into Blender's profile.

Status on this PC: the add-ons and three examples were downloaded (exporter `f93a762`, behavior graph add-on `55ff13d`, `AnimatedDoor.blend`, `MultiPlayer_Trigger.blend`, `Collectibles_networked.blend`), but running Blender with the downloaded add-ons was not permitted in the automated session, so no GLB exists yet and T6.7 reports its graph checks as open. To make it by hand (Git Bash, Blender 3.6 from Steam):

```bash
mkdir -p "$DL" && cd "$DL"                       # DL: an empty folder outside the repository
git clone --depth 1 https://github.com/Hubs-Foundation/hubs-blender-exporter.git exporter
git clone --depth 1 https://github.com/Hubs-Foundation/blender-gltf-behavior-graph.git bg-addon
curl -sLO https://raw.githubusercontent.com/Hubs-Foundation/blender-behavior-graph-examples/main/Blender_Files/AnimatedDoor.blend
mkdir -p scripts/addons/behavior_graphs
cp -r exporter/addons/io_hubs_addon scripts/addons/
cp -r bg-addon/*.py bg-addon/components bg-addon/nodespec.json scripts/addons/behavior_graphs/
BLENDER_USER_SCRIPTS="$(cygpath -w "$DL/scripts")" "<Blender>/blender.exe" -b --factory-startup \
  --python e2e/assets/behavior-graph/export.py -- "$(cygpath -w "$DL/AnimatedDoor.blend")" e2e/assets/scenes/bg-AnimatedDoor.glb
```

What is still to do once a GLB exists: publish it as a scene (as `setup/create-fixtures.ts` publishes the Crater scene), give the `bitecs` room that scene, and write T6.7's graph checks for the chosen example (trigger its interaction on one client, compare the graph's networked state on both). Until then T6.7 records the graph check as not applicable with this reason.
