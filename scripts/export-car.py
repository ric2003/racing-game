"""Run with blender --background --python scripts/export-car.py -- SOURCE OUTPUT.

Export the shared car geometry; the game supplies each player's paint color.
Source .blend files are never modified.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

source, output = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=str(Path(source).resolve()))
objects = [o for o in bpy.context.scene.objects
           if o.type in {'MESH', 'FONT'} and o.name != 'Studio floor']
wheel_prefixes = ('Front slick tyre', 'Rear slick tyre', 'Wheel rim',
                  'Brake disc', 'Wheel spoke', 'Orange centre lock', 'Gold tyre')
groups = {'body': []}
centers = {}
rotation = Matrix.Rotation(math.pi / 2, 4, 'Z')
for obj in objects:
    key = 'body'
    if obj.name.startswith(wheel_prefixes):
        x = -1.65 if obj.location.x < 0 else 1.48
        y = -1.13 if obj.location.y < 0 else 1.13
        key = 'wheel_' + ('front' if x < 0 else 'rear') + ('_left' if y < 0 else '_right')
        centers[key] = rotation @ Vector((x, y, .56))
    groups.setdefault(key, []).append(obj)

bpy.ops.object.select_all(action='DESELECT')
exports = []
for name, parts in groups.items():
    for obj in parts:
        obj.select_set(True)
        # Lower bevel tessellation while preserving the authored silhouette.
        for modifier in obj.modifiers:
            if modifier.type == 'BEVEL':
                modifier.segments = 1
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.transform(rotation)
    if name in centers:
        obj.data.transform(Matrix.Translation(-centers[name]))
        obj.location = centers[name]
    exports.append(obj)
    bpy.ops.object.select_all(action='DESELECT')

for obj in exports:
    obj.select_set(True)
Path(output).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(Path(output).resolve()), export_format='GLB',
                         use_selection=True, export_cameras=False, export_lights=False)
