# Scenery trial credits

Selected models by **Quaternius**, licensed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

- [Ultimate Modular Ruins](https://quaternius.com/packs/ultimatemodularruins.html): Arch_Gothic, Column_Round_Short, Curve_1_Overgrown.
- [Modular Train Pack](https://quaternius.com/packs/modulartrain.html): CargoTrain_Front, CargoTrain_Wagon, RailwayTrack_Straight.

Sources and SHA-256 checksums are recorded in `scenery-trial-manifest.json`.
The original Blender files are stored at `/home/ric/blender-projects/scenery-asset-trial/`.
Export with `blender --background --python scripts/export-scenery-trial.py -- /home/ric/blender-projects/scenery-asset-trial public/assets/racing`.
The exporter disables Blender scripts, converts legacy materials to solid PBR materials,
grounds and centers each asset, and turns train models to game +Z. Texture-based
leaf cards are removed from the wall; modeled vines and the game's foliage remain.
Sources are left unchanged.

## Volcano Island Lowpoly

[Volcano Island Lowpoly](https://sketchfab.com/3d-models/volcano-island-lowpoly-4a6591dc9fee40d8bfda8350683af9af)
by [Animateria](https://sketchfab.com/Animateria), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The GLB was supplied by the user. Its embedded asset metadata records the same author, source, and license.
The game preserves the geometry and textures, hides the ocean plane, removes imported lights/cameras,
adjusts material response, scales the island uniformly, hides the authored clouds, adds animated smoke and subtle lava glow, and blends the buried island into the horizon.
The procedural volcano remains only as a loading/error fallback.
Player-facing credit is linked from the landing page at `/asset-credits.html`.

## License supplied with the train pack

------------------------------------------------------
LowPoly Models by @Quaternius
Consider supporting me on Patreon, even $1 helps me a lot!

https://www.patreon.com/quaternius
-------------------------------------------------------

License:
CC0 1.0 Universal (CC0 1.0)
Public Domain Dedication
https://creativecommons.org/publicdomain/zero/1.0/


## Harbor scenery

- Cruise liner: Quaternius Ships Pack, https://quaternius.com/packs/ships.html,
  CC0 1.0. Exported from CruiseShip.blend with its Windows.png texture using
  scripts/export-harbor-ship.py. Rebuilt legacy materials, centered the model and
  scaled it uniformly at runtime. Used only on Neon Harbor.
- Warehouse, factory and large storage tank: Kenney City Kit (Industrial) 2.0,
  https://kenney.nl/assets/city-kit-industrial, CC0 1.0. Original building-i.glb,
  building-m.glb and detail-tank-large.glb with Textures/colormap.png. Used only
  on Harbor Grand Prix. Runtime placement uses uniform scale.
- Basin, quay, breakwaters, bollards and concrete yards: project-generated geometry.

Sources retrieved 2026-09-17. Both packs permit personal and commercial use.
