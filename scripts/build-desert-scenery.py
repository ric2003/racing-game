"""Bake licensed free packs into the game's desert scene, not a standalone asset library.
blender -b --python scripts/build-desert-scenery.py -- SOURCE_ROOT TRACK_JSON OUTPUT
SOURCE_ROOT contains western/ and oasis/ extracted free downloads.
"""
import json, math, random, sys
from pathlib import Path
import numpy as np
np.bool = np.bool_
np.float = float
np.int = int
import bpy
from mathutils import Vector
root, track_file, output = map(Path, sys.argv[sys.argv.index('--')+1:])
track = json.loads(track_file.read_text())
points = [(p['x'],p['z']) for p in track['points']]
rng = random.Random(9147)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
prototypes = {}
for pack, folder in [('western',root/'western/FREE_VERSION_30_MODELS/GLB'),('oasis',root/'oasis/JellySquish Oasis Pack - Base Version/Models')]:
 for path in sorted(folder.glob('*.glb')):
  before=set(bpy.data.objects)
  bpy.ops.import_scene.gltf(filepath=str(path))
  imported=set(bpy.data.objects)-before
  meshes=[o for o in imported if o.type=='MESH']
  bpy.ops.object.select_all(action='DESELECT')
  for o in meshes:
   o.select_set(True)
   o.matrix_world=o.matrix_world.copy()
  bpy.context.view_layer.objects.active=meshes[0]
  if len(meshes)>1: bpy.ops.object.join()
  obj=bpy.context.view_layer.objects.active
  bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
  lo=Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
  hi=Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
  center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
  for v in obj.data.vertices: v.co-=center
  # glTF Y-up imports to Blender Z-up. Runtime world Z is Blender -Y.
  prototypes[(pack,path.stem)]=(obj.data.copy(),hi-lo)
  for o in imported:
   if o.name in bpy.data.objects: bpy.data.objects.remove(o,do_unlink=True)

def road_distance(x,z):
 best=1e20
 for i,(ax,az) in enumerate(points):
  bx,bz=points[(i+1)%len(points)];dx,dz=bx-ax,bz-az
  t=max(0,min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)))
  best=min(best,math.hypot(x-ax-t*dx,z-az-t*dz))
 return best
placed=[]
def place(pack,name,x,z,length,angle=0):
 mesh,dims=prototypes[(pack,name)]
 scale=length/max(dims.x,dims.y,dims.z)
 radius=math.hypot(dims.x,dims.y)*scale/2
 if road_distance(x,z)<14+radius: return False
 obj=bpy.data.objects.new(pack+'-'+name,mesh);bpy.context.collection.objects.link(obj)
 obj.location=(x,-z,0);obj.scale=(scale,)*3;obj.rotation_euler.z=-angle
 obj['source_pack']=pack;obj['source_model']=name
 placed.append({'pack':pack,'model':name,'x':x,'z':z,'radius':radius})
 return True
natural=[n for p,n in prototypes if p=='western' and any(w in n for w in ['rock','cactus','bush','grass','log','stump','branch','succulent'])]
for i in range(0,len(points),max(1,len(points)//110)):
 x,z=points[i];nx,nz=points[(i+1)%len(points)];heading=math.atan2(nz-z,nx-x)
 for side in [-1,1]:
  for j in range(3):
   name=natural[(i//max(1,len(points)//110)*3+j)%len(natural)]
   distance=side*(22+j*20+rng.random()*16)
   size=rng.uniform(2,5) if 'rock' in name else rng.uniform(1,3)
   if 'big_rock'==name or 'eroded_rock'==name: size=12+j*6
   place('western',name,x-math.sin(heading)*distance,z+math.cos(heading)*distance,size,rng.random()*6.28)
# Settlement outside the entire circuit, near its southern straight.
ox=sum(x for x,z in points)/len(points)
oz=min(z for x,z in points)-95
layout={
 'house_large':(-24,-18,15),'house_small':(22,-18,10),
 'platform_l':(-24,-5,9),'platform_m':(22,-7,7),'platform_s':(7,-24,5),
 'steps':(-24,2,4),'ladder':(-31,-16,6),
 'palm_l':(-18,23,13),'palm_m':(19,19,10),'palm_s':(7,31,8),
 'rocks_1':(-28,22,5),'rocks_2':(28,15,4),'rocks_3':(21,30,4),
 'cactus_large':(-39,-14,4),'cactus_small':(38,-10,2),
 'pot_l':(-14,-13,2),'pot_s':(16,-12,1.3),'basket_large':(-17,-10,1.7),
 'basket_small':(16,-8,1.1),'chest':(9,-21,2.5),
 'grass_1':(-11,23,1.6),'grass_2':(12,20,1.5),'grass_3':(17,27,1.7),
 'blue_grass_large':(-6,30,1.7),'blue_grass_small':(5,25,1.2)}
for name,(x,z,size) in layout.items(): place('oasis',name,ox+x,oz+z,size)
# Small supply groups beside the houses; fences edge the settlement.
supplies={'barrel_1':(-33,-20,2),'box':(-34,-24,1.6),'sack':(-30,-24,1.4),
 'shovel':(-32,-19,2),'pot_1':(17,-17,1.5),'fence':(-40,-8,5),
 'wooden_post':(-42,-13,3),'post':(-42,-4,3),'wooden_plank':(29,-24,3),
 'skull':(41,15,1),'dry_bones_1':(42,19,2)}
for name,(x,z,size) in supplies.items(): place('western',name,ox+x,oz+z,size,rng.random()*.4)
for pack,name in prototypes:
 if pack=='western' and not any(p['pack']==pack and p['model']==name for p in placed):
  place(pack,name,ox-45+rng.random()*90,oz-42,3,rng.random()*6.28)
# A shallow pool and sand banks make the palm cluster read as an oasis.
bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=8,location=(ox,-(oz+20),-0.18))
pool=bpy.context.object;pool.name='oasis-pool';pool.scale=(14,10,.32)
mat=bpy.data.materials.new('oasis-water');mat.diffuse_color=(.025,.32,.36,1);mat.use_nodes=True
mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=mat.diffuse_color
mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.3
pool.data.materials.append(mat)
used={(p['pack'],p['model']) for p in placed}
assert used==set(prototypes),set(prototypes)-used
output.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output.resolve()),export_format='GLB',export_extras=True,export_cameras=False,export_lights=False)
output.with_suffix('.json').write_text(json.dumps({'track':'desert-endurance','models':len(used),'placements':placed,'oasis':{'x':ox,'z':oz}},indent=2)+'\n')
print('BAKED',len(used),'models;',len(placed),'placements')
