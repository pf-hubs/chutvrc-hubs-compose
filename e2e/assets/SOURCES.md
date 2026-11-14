# Assets: sources and licences

Files under `assets/` are served to the browsers at `https://hubs.local:3001/<path>` by the `assets` service. Generated and downloaded files are not committed (see `.gitignore`); this list says how to get each back.

| File | Source | Licence | How to get it |
| --- | --- | --- | --- |
| `clips/<slot>.wav` | generated: band-limited pink noise chopped into syllables, with a 250 ms pilot beep every second at the slot's frequency (`media.ts`) | made here, no restriction | `npx tsx assets/generate.ts` |
| `clips/<slot>.y4m` | generated: 640 x 360, 15 fps, the slot's colour with its letter and pilot frequency | made here, no restriction | `npx tsx assets/generate.ts` |
| `scenes/crater.glb`, `scenes/crater.jpg` | the Crater terrain `services/spoke/test/fixtures/test-assets/crater.glb` (Mozilla, Spoke repository), with a sun, sky, hemisphere light, shadows and eight spawn points added the way Spoke exports them; the thumbnail is the terrain's colour texture | MPL 2.0 (Spoke repository) | `npx tsx assets/generate.ts`; published as the scene "Crater e2e" by `setup/create-fixtures.ts` |
| `avatars/VRM1_Constraint_Twist_Sample.vrm` | `vrm-c/vrm-specification`, `samples/VRM1_Constraint_Twist_Sample` (© 2022 pixiv Inc.), VRM 1.0, 54 humanoid bones | VRM Public License 1.0; its metadata allows avatar use by everyone, redistribution and modification | download from the `vrm-c/vrm-specification` repository on GitHub into `assets/avatars/` |
| `scenes/nimpro.glb`, `scenes/nimpro.jpg` | the Crater scene above with the N-impro set: a node `N-impro` holding five occupiable, clickable waypoints `N-impro-seat-01` to `-05` and the question slide (`QuestionSlide` with `media/questions.pdf` as scene media) | MPL 2.0 (Spoke repository) for the terrain; the rest made here | `npx tsx assets/generate.ts scenes`; published as "N-impro e2e" by `setup/create-fixtures.ts` |
| `media/pages.pdf`, `media/questions.pdf` | generated: coloured pages with a title each, written as plain PDF | made here, no restriction | `npx tsx assets/generate.ts media` |
| `media/clock.mp4` | generated: 60 s, 640 x 360, the time in large digits on yellow, with a 440 Hz tone | made here, no restriction | `npx tsx assets/generate.ts media` |
