"""blender -b --python scripts/export-harbor-ship.py -- SOURCE_DIRECTORY OUTPUT_GLB"""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.open_mainfile(filepath=str(source / 'CruiseShip.blend'), use_scripts=False)
for material in bpy.data.materials:
    color = tuple(material.diffuse_color)
    textured = material.name == 'Texture'
    material.use_nodes = True
    material.node_tree.nodes.clear()
    shader = material.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Roughness'].default_value = 0.85
    if textured:
        image = material.node_tree.nodes.new('ShaderNodeTexImage')
        image.image = bpy.data.images.load(str(source / 'Windows.png'))
        material.node_tree.links.new(image.outputs['Color'], shader.inputs['Base Color'])
    out = material.node_tree.nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(shader.outputs['BSDF'], out.inputs['Surface'])
bpy.ops.object.select_all(action='DESELECT')
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in objects: o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
o = bpy.context.object
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
minimum = Vector(tuple(min(v.co[i] for v in o.data.vertices) for i in range(3)))
maximum = Vector(tuple(max(v.co[i] for v in o.data.vertices) for i in range(3)))
offset = Vector(((minimum.x+maximum.x)/2,(minimum.y+maximum.y)/2,minimum.z))
for v in o.data.vertices: v.co -= offset
o.name = 'cruise-liner'
bpy.ops.export_scene.gltf(filepath=str(output.resolve()), export_format='GLB', use_selection=True)
