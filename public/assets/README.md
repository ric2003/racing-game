# Racing models

The GLBs in `racing/` come from the user's Blender asset pack at
`/home/ric/blender-projects/arcade-racing-pack/`. Its manifest records the source
dimensions and asset inventory. The editable source remains outside this repo.

`cars/race-car.glb` comes from `/home/ric/blender-projects/race-car/race-car.blend`.
All supplied car variants share this geometry. The game clones its paint material
to match the authoritative player color rather than downloading duplicate geometry.
The authored number 27 remains on the shared car.

To regenerate the car export from the repository root:

```sh
blender --background --python scripts/export-car.py -- /home/ric/blender-projects/race-car/race-car.blend public/assets/cars/race-car.glb
```

The exporter excludes the studio, joins body components, preserves four wheel
pivots, and rotates the car to face game +Z. It never saves over the Blender source.
The runtime scales the car to 88% to fit the existing kart footprint. Race physics
and collision dimensions are unchanged.

Each race scene owns a model library. Repeated scenery uses spatial instance
batches with geometry merged by material. Gantry lamps retain separate materials
for countdown animation. Failed asset loading leaves the procedural visuals active.
Roadside props are decorative. Moving hazards render as suspended iron wrecking balls;
the server retains its existing cross-track motion, collision radius, and impact effect.
The internal network type remains `moving-barrier` for compatibility.

`racing/cannonball.glb` is a new Blender model with its origin at the sphere center.
The runtime scales it to each hazard's collision radius. A constant-length cable
suspends it from a 14 m gantry. The posts and foundations stay outside the full
circuit, and the overhead beam leaves the road clear. The server's cross-track
position determines the pendulum angle; the ball rises naturally toward each end
of its swing. The gantry and cable use code geometry to fit each hazard's location. Rebuild it with:

```sh
blender --background --python scripts/build-cannonball.py -- public/assets/racing/cannonball.glb /home/ric/blender-projects/arcade-racing-pack/cannonball.blend
```
