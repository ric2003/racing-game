"""Blender: --background --python scripts/build-cannonball.py -- GLB BLEND."""
import math
import sys
from pathlib import Path

import bpy

output, source = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, color, metal, roughness):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metal
    shader.inputs['Roughness'].default_value = roughness
    return result


iron = material('Cannonball forged iron', (.045, .057, .072), .65, .38)
seam = material('Cannonball casting seam', (.15, .18, .21), .7, .48)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1)
ball = bpy.context.object
ball.name = 'cannonball_iron'
ball.data.materials.append(iron)
for polygon in ball.data.polygons:
    polygon.use_smooth = True

# A subtle raised casting seam makes the rolling motion visible.
bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=6,
                               major_radius=.99, minor_radius=.018)
ring = bpy.context.object
ring.name = 'cannonball_casting_seam'
ring.data.materials.append(seam)

# Small foundry marks break up the silhouette without resembling a bomb fuse.
for angle in [0, math.pi / 2, math.pi, math.pi * 1.5]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=.045,
                                       location=(.985 * math.cos(angle), .985 * math.sin(angle), 0))
    bpy.context.object.name = 'cannonball_foundry_mark'
    bpy.context.object.data.materials.append(seam)

bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = ball
bpy.ops.object.join()
ball.name = 'cannonball'
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
Path(source).parent.mkdir(parents=True, exist_ok=True)
Path(output).parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(Path(source).resolve()))
bpy.ops.export_scene.gltf(filepath=str(Path(output).resolve()), export_format='GLB',
                         use_selection=True, export_cameras=False, export_lights=False)
