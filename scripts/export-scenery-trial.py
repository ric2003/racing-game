"""Export the selected Quaternius sources: blender -b --python this.py -- SOURCE OUTPUT."""
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
output.mkdir(parents=True, exist_ok=True)
for name in ['ruin_arch', 'ruin_column', 'ruin_wall', 'train_engine', 'train_wagon', 'rail_straight']:
    bpy.ops.wm.open_mainfile(filepath=str((source / (name + '.blend')).resolve()), use_scripts=False)
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in objects:
        # The wall includes texture-based leaf cards. Use its modeled vines and
        # our existing understory instead of importing transparent cards.
        leaves = {i for i, m in enumerate(obj.data.materials) if m and m.name == 'Leaf_Texture'}
        if leaves:
            mesh = bmesh.new()
            mesh.from_mesh(obj.data)
            bmesh.ops.delete(mesh, geom=[f for f in mesh.faces if f.material_index in leaves], context='FACES')
            mesh.to_mesh(obj.data)
            mesh.free()
    for mat in bpy.data.materials:
        color = tuple(mat.diffuse_color)
        if mat.use_nodes:
            diffuse = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_DIFFUSE'), None)
            if diffuse:
                color = tuple(diffuse.inputs['Color'].default_value)
        if mat.name == 'Glass':
            color = (.06, .13, .17, 1)
        mat.use_nodes = True
        mat.node_tree.nodes.clear()
        shader = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        shader.inputs['Base Color'].default_value = color
        shader.inputs['Roughness'].default_value = .85
        out = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
        mat.node_tree.links.new(shader.outputs['BSDF'], out.inputs['Surface'])
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if name.startswith('train_') or name == 'rail_straight':
        obj.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    minimum = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    maximum = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    offset = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
    for vertex in obj.data.vertices:
        vertex.co -= offset
    obj.name = name
    bpy.ops.export_scene.gltf(filepath=str((output / (name + '.glb')).resolve()),
        export_format='GLB', use_selection=True, export_cameras=False, export_lights=False)
