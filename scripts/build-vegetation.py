"""blender --background --python scripts/build-vegetation.py -- GLB_DIR SOURCE_DIR"""
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

output, source = map(Path, sys.argv[sys.argv.index('--') + 1:])
output.mkdir(parents=True, exist_ok=True)
source.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .95
    return mat


mats = [material('foliage_shadow', (.035, .15, .065)),
        material('foliage_green', (.12, .30, .075)),
        material('foliage_sunlit', (.30, .43, .12)),
        material('flower_cream', (.95, .85, .52)),
        material('flower_lavender', (.42, .22, .62))]
assets = []


def leaf(vertices, faces, indices, root, tip, width, color):
    # A folded, double-sided diamond reads from both sides without alpha cards.
    root, tip = Vector(root), Vector(tip)
    axis = tip - root
    side = axis.cross(Vector((0, 0, 1)))
    if side.length < .001:
        side = Vector((1, 0, 0))
    side.normalize()
    middle = root.lerp(tip, .48)
    ridge = middle + Vector((0, 0, width * .22))
    n = len(vertices)
    vertices.extend([root, middle + side * width, tip, middle - side * width, ridge])
    for a, b, c in [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]:
        faces.extend([(n+a, n+b, n+c), (n+c, n+b, n+a)])
        indices.extend([color, color])


def build(name, kind, seed):
    rng = random.Random(seed)
    vertices, faces, indices = [], [], []
    if kind == 'bush':
        for i in range(7):
            angle = i * math.tau / 7
            size = rng.uniform(.40, .67)
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1,
                location=(math.cos(angle)*.58, math.sin(angle)*.46, size*.7))
            obj = bpy.context.object
            obj.scale = (size, size*.85, size*.85)
            obj.data.materials.append(mats[i % 3])
        # Select only this bush's newly created lobes.
        parts = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith('Icosphere')]
        bpy.ops.object.select_all(action='DESELECT')
        for obj in parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        scene.cursor.location = (0, 0, 0)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    else:
        for i in range(9 if kind == 'fern' else 34):
            angle = rng.uniform(0, math.tau)
            radius = rng.uniform(.05, .85)
            root = Vector((math.cos(angle)*radius, math.sin(angle)*radius, .015))
            height = rng.uniform(.27, .68) * (1.4 if seed == 12 else 1)
            tip = root + Vector((math.cos(angle)*.35, math.sin(angle)*.35, height))
            if kind == 'fern':
                root = Vector((0, 0, .04))
                tip = Vector((math.cos(angle)*1.0, math.sin(angle)*1.0, height))
                leaf(vertices, faces, indices, root, tip, .025, 0)
                sideways = Vector((-math.sin(angle), math.cos(angle), .16))
                for j in range(1, 7):
                    t = j / 8
                    base = root.lerp(tip, t)
                    for sign in [-1, 1]:
                        end = base + sideways * sign * (.29*(1-t)) + (tip-root)*.13
                        leaf(vertices, faces, indices, base, end, .065*(1-t)+.018, 1+j%2)
            else:
                leaf(vertices, faces, indices, root, tip, rng.uniform(.045, .09), i%3)
                if kind == 'flowers' and i % 2 == 0:
                    for petal in range(5):
                        a = petal * math.tau/5
                        end = tip + Vector((math.cos(a)*.13, math.sin(a)*.13, .035))
                        leaf(vertices, faces, indices, tip, end, .055, 3+seed%2)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
        for mat in mats:
            mesh.materials.append(mat)
        for poly, index in zip(mesh.polygons, indices):
            poly.material_index = index
    obj.name = name
    # Keep every exported asset grounded, including the bush's faceted lobes.
    bottom = min(v.co.z for v in obj.data.vertices)
    for vertex in obj.data.vertices:
        vertex.co.z -= bottom
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=str((output / (name+'.glb')).resolve()),
        export_format='GLB', use_selection=True, export_cameras=False, export_lights=False)
    assets.append({'id': name, 'triangles': sum(len(p.vertices)-2 for p in obj.data.polygons),
                   'dimensions_m': list(obj.dimensions)})
    obj.location = ((len(assets)-1)%3*3.2, (len(assets)-1)//3*3.2, 0)


for spec in [('grass_clump_low', 'grass', 11), ('grass_clump_tall', 'grass', 12),
             ('bush_low', 'bush', 13), ('fern_cluster', 'fern', 14),
             ('wildflowers_cream', 'flowers', 16), ('wildflowers_lavender', 'flowers', 17)]:
    build(*spec)

(source / 'vegetation-manifest.json').write_text(json.dumps({'units': 'meters', 'assets': assets}, indent=2)+'\n')
bpy.ops.object.camera_add(location=(10, -12, 12))
camera = bpy.context.object
camera.rotation_euler = (Vector((3.2, 1.6, 0))-camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 12
scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(1, -3, 10))
bpy.context.object.data.energy = 1800
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = 8
scene.world = bpy.data.worlds.new('Vegetation world')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.16, .20, .24, 1)
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = False
scene.render.resolution_x = 1200
scene.render.resolution_y = 800
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str((source / 'vegetation-overview.png').resolve())
bpy.ops.wm.save_as_mainfile(filepath=str((source / 'vegetation-kit.blend').resolve()))
bpy.ops.render.render(write_still=True)
