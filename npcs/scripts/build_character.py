"""Original Komorebi voxel character. Run with Blender --background --factory-startup.

All model coordinates below are integer voxels in the exported Y-up, +Z-forward
basis. Surface-only greedy meshing retains the grid without thousands of cubes.
"""
import bpy, math, json, bmesh
from mathutils import Vector, Matrix, Quaternion
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
U = .025
C = Matrix.Rotation(math.pi / 2, 3, 'X')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.actions): bpy.data.actions.remove(block)
scene = bpy.context.scene
scene.name = 'Komorebi_Character_Workshop'
scene.unit_settings.system = 'METRIC'
scene.render.fps = 30
asset = bpy.data.collections.new('COL_NPC_Export')
scene.collection.children.link(asset)
stage = bpy.data.collections.new('COL_Presentation')
scene.collection.children.link(stage)

def linear(v):
    v = int(v, 16) / 255
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

PALETTE = {'Skin':'dca477', 'Hair':'463b35', 'Top':'5c7f89', 'Accent':'d5af72',
           'Trousers':'354654', 'Shoes':'28333d', 'Cream':'f3e7cd', 'Ink':'282632',
           'Bag':'9b6548', 'Cheek':'c87867'}
mats = {}
for key, color in PALETTE.items():
    mat = bpy.data.materials.new('MAT_NPC_' + key)
    rgba = (*[linear(color[i:i+2]) for i in (0,2,4)], 1)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = rgba
    p.inputs['Roughness'].default_value = .86
    mats[key] = mat

# Every bone has the same rest orientation, making the baked rigid FK rig easy to edit.
bones = {
 'root':((0,0,0),None), 'hips':((0,30,0),'root'),
 'spine':((0,32,0),'hips'), 'chest':((0,44,0),'spine'),
 'head':((0,53,0),'chest'),
 'L_upperArm':((14,49,0),'chest'), 'L_forearm':((14,38,0),'L_upperArm'),
 'L_hand':((14,29,0),'L_forearm'),
 'R_upperArm':((-14,49,0),'chest'), 'R_forearm':((-14,38,0),'R_upperArm'),
 'R_hand':((-14,29,0),'R_forearm'),
 'L_thigh':((5,30,0),'hips'), 'L_shin':((5,17,0),'L_thigh'), 'L_foot':((5,4,0),'L_shin'),
 'R_thigh':((-5,30,0),'hips'), 'R_shin':((-5,17,0),'R_thigh'), 'R_foot':((-5,4,0),'R_shin'),
 'socket_head':((0,72,0),'head'), 'socket_hand_L':((14,27,2),'L_hand'),
 'socket_hand_R':((-14,27,2),'R_hand'), 'socket_voice':((0,58,10),'head')
}
arm = bpy.data.armatures.new('ARM_Komorebi')
rig = bpy.data.objects.new('ARM_Komorebi', arm)
asset.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,(position,parent) in bones.items():
    b = arm.edit_bones.new(name)
    b.head = C @ (Vector(position) * U)
    b.tail = b.head + Vector((0,0,.1))
    if parent: b.parent = arm.edit_bones[parent]
    b.use_deform = not name.startswith('socket')
bpy.ops.object.mode_set(mode='OBJECT')
rig.show_in_front = True
rig['units'] = 'metres'
rig['forward'] = '+Z after GLB export'
rig['voxel_size'] = U
rig['animation_motion'] = 'in-place'
rig['schema_version'] = 1

class Part:
    def __init__(self, name, slot=None, option=None):
        self.name, self.slot, self.option = name,slot,option
        self.cells = {}
    def box(self, lo, hi, material, bone):
        for x in range(lo[0],hi[0]):
            for y in range(lo[1],hi[1]):
                for z in range(lo[2],hi[2]):
                    self.cells[x,y,z] = (material,bone)
        return self
    def mesh(self):
        planes = defaultdict(dict)
        for p,(mat,bone) in self.cells.items():
            for axis in range(3):
                a,b = (axis+1)%3,(axis+2)%3
                for sign in (-1,1):
                    neighbor = list(p); neighbor[axis] += sign
                    entry = self.cells.get(tuple(neighbor))
                    if entry and entry[1] == bone: continue
                    plane = p[axis] + (sign>0)
                    planes[axis,sign,plane,mat,bone][p[a],p[b]] = True
        verts,faces,face_mats,weights = [],[],[],[]
        lookup = {}; used_mats = sorted({m for m,b in self.cells.values()})
        for (axis,sign,plane,mat,bone), mask in planes.items():
            a,b = (axis+1)%3,(axis+2)%3
            while mask:
                x,y = min(mask, key=lambda p:(p[1],p[0]))
                w=1
                while (x+w,y) in mask: w+=1
                h=1
                while all((xx,y+h) in mask for xx in range(x,x+w)): h+=1
                for xx in range(x,x+w):
                    for yy in range(y,y+h): del mask[xx,yy]
                face=[]
                for aa,bb in ((x,y),(x+w,y),(x+w,y+h),(x,y+h)):
                    v=[0,0,0]; v[axis]=plane; v[a]=aa; v[b]=bb
                    key=(*v,bone)
                    if key not in lookup:
                        lookup[key]=len(verts); verts.append(C @ (Vector(v)*U)); weights.append(bone)
                    face.append(lookup[key])
                faces.append(face if sign>0 else list(reversed(face)))
                face_mats.append(used_mats.index(mat))
        me=bpy.data.meshes.new(self.name+'_mesh'); me.from_pydata(verts,[],faces); me.update()
        ob=bpy.data.objects.new(self.name,me); asset.objects.link(ob)
        for m in used_mats: me.materials.append(mats[m])
        for p,mi in zip(me.polygons,face_mats): p.material_index=mi
        for bone in sorted(set(weights)):
            group=ob.vertex_groups.new(name=bone)
            group.add([i for i,b in enumerate(weights) if b==bone],1,'REPLACE')
        mod=ob.modifiers.new('Rigid voxel skin','ARMATURE'); mod.object=rig
        ob.parent=rig
        ob['npc_part']='base' if not self.slot else self.slot
        if self.option: ob['npc_option']=self.option
        return ob

body=Part('SM_NPC_Body')
body.box((-9,29,-5),(9,34,5),'Trousers','hips')
body.box((-9,33,-5),(9,45,5),'Cream','spine')
body.box((-9,45,-5),(9,50,5),'Cream','chest')
body.box((-3,50,-3),(3,55,3),'Skin','head')
body.box((-8,53,-6),(8,55,6),'Skin','head')
body.box((-9,55,-7),(9,67,7),'Skin','head')
body.box((-8,67,-6),(8,68,6),'Skin','head')
for s,side in ((1,'L'),(-1,'R')):
    def mirror(lo,hi):
        return (lo,hi) if s==1 else ((-hi[0],lo[1],lo[2]),(-lo[0],hi[1],hi[2]))
    def block(lo,hi,mat,bone): body.box(*mirror(lo,hi),mat,side+'_'+bone)
    block((1,17,-4),(9,30,4),'Trousers','thigh')
    block((1,4,-4),(9,17,4),'Trousers','shin')
    block((1,2,-5),(9,6,8),'Shoes','foot')
    block((1,0,-5),(9,2,8),'Cream','foot')
    block((1,3,5),(9,5,8),'Shoes','foot')
    block((11,38,-3),(18,49,4),'Skin','upperArm')
    block((11,29,-3),(18,38,4),'Skin','forearm')
    block((11,25,-3),(18,30,4),'Skin','hand')
    block((10,26,1),(11,29,4),'Skin','hand')
    body.box(*mirror((9,58,-1),(11,62,3)),'Skin','head')
    body.box(*mirror((6,58,7),(8,59,8)),'Cheek','head')
body.box((-1,59,7),(1,61,9),'Skin','head')
body_ob=body.mesh()

eyes=Part('SM_NPC_Eyes')
for x in (-5,3):
    eyes.box((x-1,61,7),(x+3,64,8),'Cream','head')
    eyes.box((x,61,8),(x+2,64,9),'Ink','head')
eyes_ob=eyes.mesh(); eyes_ob.shape_key_add(name='Basis')
blink=eyes_ob.shape_key_add(name='Blink')
for v in blink.data: v.co.z = 62*U+(v.co.z-62*U)*.08
blink.value=0
mouth=Part('SM_NPC_Mouth').box((-2,56,7),(2,57,8),'Ink','head').mesh()
mouth.shape_key_add(name='Basis'); mouth_open=mouth.shape_key_add(name='MouthOpen')
for v in mouth_open.data: v.co.z = 57*U+(v.co.z-57*U)*3
mouth_open.value=0

# Three interchangeable hair silhouettes. Voxel seams are merged, not individual cube objects.
for style in ('crop','bob','topknot'):
    hair=Part('SM_NPC_Hair_'+style,'hair',style)
    hair.box((-10,64,-8),(10,69,8),'Hair','head')
    hair.box((-8,69,-7),(8,70,6),'Hair','head')
    hair.box((-10,61,-7),(-8,67,5),'Hair','head')
    hair.box((8,62,-7),(10,67,5),'Hair','head')
    hair.box((-9,59,-8),(9,66,-6),'Hair','head')
    if style=='crop':
        hair.box((-9,64,6),(-2,67,8),'Hair','head')
        hair.box((-9,62,6),(-6,65,8),'Hair','head')
        hair.box((-2,65,6),(8,67,8),'Hair','head')
        hair.box((-7,70,-3),(3,71,5),'Hair','head')
    elif style=='bob':
        hair.box((-10,55,-8),(-8,65,6),'Hair','head')
        hair.box((8,55,-8),(10,65,6),'Hair','head')
        hair.box((-9,54,-8),(9,64,-6),'Hair','head')
        hair.box((-9,65,6),(9,67,8),'Hair','head')
        hair.box((-8,64,6),(-3,65,8),'Hair','head')
        hair.box((2,64,6),(8,65,8),'Hair','head')
    else:
        hair.box((-9,65,6),(-4,67,8),'Hair','head')
        hair.box((-4,66,6),(9,68,8),'Hair','head')
        hair.box((-4,69,-5),(4,74,2),'Hair','head')
        hair.box((-3,74,-4),(3,75,1),'Hair','head')
        hair.box((-4,70,-5),(4,71,2),'Accent','head')
    hair.mesh()

for outfit in ('jacket','apron','haori'):
    cloth=Part('SM_NPC_Outfit_'+outfit,'outfit',outfit)
    cloth.box((-10,33,-6),(10,44,6),'Top','spine')
    cloth.box((-10,44,-6),(10,51,6),'Top','chest')
    cloth.box((-2,34,6),(2,44,7),'Cream','spine')
    cloth.box((-2,44,6),(2,50,7),'Cream','chest')
    for s,side in ((1,'L'),(-1,'R')):
        x0,x1=(10,19) if s==1 else (-19,-10)
        cloth.box((x0,39,-4),(x1,50,5),'Top',side+'_upperArm')
        if outfit=='haori':
            x0,x1=(9,20) if s==1 else (-20,-9)
            cloth.box((x0,38,-5),(x1,44,6),'Top',side+'_upperArm')
        else:
            cloth.box((x0,36,-4),(x1,39,5),'Accent',side+'_forearm')
    if outfit=='jacket':
        cloth.box((-10,32,-6),(10,34,6),'Accent','spine')
        cloth.box((-8,38,6),(-4,42,7),'Accent','spine')
        cloth.box((4,38,6),(8,42,7),'Top','spine')
        cloth.box((-8,41,7),(-4,42,8),'Cream','spine')
        for y in (36,40,44): cloth.box((0,y,7),(1,y+1,8),'Accent','spine' if y<44 else 'chest')
        # Readable back panel in third person, with a tiny stitched cross.
        cloth.box((-7,36,-7),(7,46,-6),'Top','spine')
        cloth.box((-1,41,-8),(1,45,-7),'Accent','spine')
        cloth.box((-3,42,-8),(3,44,-7),'Accent','spine')
    elif outfit=='apron':
        cloth.box((-7,33,6),(7,44,8),'Accent','spine')
        cloth.box((-6,44,6),(6,48,8),'Accent','chest')
        cloth.box((-8,29,6),(8,33,8),'Accent','hips')
        cloth.box((-5,35,8),(5,38,9),'Cream','spine')
        cloth.box((-10,38,-7),(10,40,-6),'Accent','spine')
        cloth.box((-4,37,-8),(4,41,-7),'Accent','spine')
        cloth.box((-6,47,6),(-4,50,8),'Accent','chest')
        cloth.box((4,47,6),(6,50,8),'Accent','chest')
    else:
        cloth.box((-10,29,-6),(10,33,6),'Top','hips')
        cloth.box((-4,38,6),(-2,49,8),'Cream','spine')
        cloth.box((2,38,6),(4,49,8),'Cream','spine')
        cloth.box((-10,35,-7),(10,38,8),'Accent','spine')
        cloth.box((-3,41,-7),(3,45,-6),'Cream','spine')
        cloth.box((-1,40,-7),(1,46,-6),'Cream','spine')
    cloth.mesh()

glasses=Part('SM_NPC_Glasses','glasses','on')
for x in (-7,2):
    glasses.box((x,60,9),(x+5,61,10),'Ink','head')
    glasses.box((x,64,9),(x+5,65,10),'Ink','head')
    glasses.box((x,61,9),(x+1,64,10),'Ink','head')
    glasses.box((x+4,61,9),(x+5,64,10),'Ink','head')
glasses.box((-2,63,9),(2,64,10),'Ink','head')
glasses.box((-10,63,0),(-9,64,10),'Ink','head')
glasses.box((9,63,0),(10,64,10),'Ink','head')
glasses.mesh()
bag=Part('SM_NPC_Bag','bag','on')
bag.box((-7,34,-11),(7,46,-6),'Bag','spine')
bag.box((-6,46,-10),(6,48,-6),'Bag','chest')
bag.box((-6,41,-12),(6,45,-11),'Accent','spine')
bag.box((-2,39,-13),(2,42,-12),'Cream','spine')
for x in (-7,5):
    bag.box((x,42,6),(x+2,49,7),'Bag','chest')
    bag.box((x,49,-7),(x+2,52,7),'Bag','chest')
bag.mesh()

def rotate(name, x=0,y=0,z=0):
    pb=rig.pose.bones[name]
    # Angles are canonical game-space radians. Transform into the bone rest basis.
    q=Quaternion((1,0,0),x) @ Quaternion((0,1,0),y) @ Quaternion((0,0,1),z)
    world=C @ q.to_matrix() @ C.inverted()
    basis=pb.bone.matrix_local.to_3x3()
    pb.rotation_mode='QUATERNION'
    pb.rotation_quaternion=(basis.inverted() @ world @ basis).to_quaternion()

def translate(name, p):
    pb=rig.pose.bones[name]
    pb.location=pb.bone.matrix_local.to_3x3().inverted() @ (C @ Vector(p))

def neutral():
    for pb in rig.pose.bones:
        pb.rotation_mode='QUATERNION'; pb.rotation_quaternion=(1,0,0,0); pb.location=(0,0,0)

def legs(side, forward, lift, hip_drop):
    l=.325
    dy=.65-hip_drop-lift
    d=min(2*l-.00001,math.hypot(dy,forward))
    bend=math.acos(max(-1,min(1,d/(2*l))))
    thigh=math.atan2(-forward,dy)-bend
    shin=2*bend
    rotate(side+'_thigh',thigh)
    rotate(side+'_shin',shin)
    rotate(side+'_foot',-thigh-shin)

actions={}
for name,frames in [('Idle',90),('Walk',30),('Run',20),('Wave',60),('Bow',66),('Talk',90),('Listen',90)]:
    neutral()
    action=bpy.data.actions.new('AN_NPC_'+name)
    action.use_fake_user=True
    rig.animation_data_create(); rig.animation_data.action=action
    for f in range(frames+1):
        t=f/frames; w=2*math.pi*t
        neutral()
        if name in ('Walk','Run'):
            running=name=='Run'
            drop=.065 if running else .04
            drop += .007*math.cos(2*w)
            translate('hips',(0,-drop,0))
            for side,offset in [('L',0),('R',.5)]:
                phase=(t+offset)%1
                stride=.22 if running else .18
                if phase<.5:
                    forward=stride*(1-4*phase); lift=0
                else:
                    u=(phase-.5)*2
                    forward=-stride+2*stride*(u*u*(3-2*u))
                    lift=(.18 if running else .115)*math.sin(math.pi*u)**2
                legs(side,forward,lift,drop)
                swing=math.cos(w+offset*2*math.pi)
                rotate(side+'_upperArm',(.8 if running else .45)*swing,z=(-.055 if side=='L' else .055))
                rotate(side+'_forearm',-1 if running else -.13)
            rotate('chest',.09 if running else .02,y=.055*math.cos(w))
            rotate('head',-.04 if running else -.01)
        elif name=='Bow':
            envelope=math.sin(math.pi*t)**2
            rotate('spine',.50*envelope); rotate('head',.13*envelope)
            rotate('L_upperArm',-.18*envelope,z=.04*envelope)
            rotate('R_upperArm',-.18*envelope,z=-.04*envelope)
        elif name=='Wave':
            envelope=math.sin(math.pi*min(1,t/.22)/2)**2 * math.sin(math.pi*min(1,(1-t)/.22)/2)**2
            rotate('R_upperArm',-.25*envelope,z=-2.15*envelope)
            rotate('R_forearm',-.35*envelope,z=.22*math.sin(6*w)*envelope)
            rotate('head',y=-.08*envelope,z=-.03*envelope)
        elif name=='Talk':
            rotate('chest',.016*math.sin(w)); rotate('head',.025*math.sin(2*w),y=.065*math.sin(w))
            rotate('L_upperArm',-.15-.1*math.sin(w),z=-.12)
            rotate('L_forearm',-.4-.14*math.sin(2*w))
            rotate('R_upperArm',-.05+.1*math.sin(w),z=.07)
            rotate('R_forearm',-.2+.07*math.sin(2*w))
        elif name=='Listen':
            rotate('head',.04+.03*math.sin(2*w),y=.02*math.sin(w),z=.04)
            rotate('L_upperArm',z=-.04); rotate('R_upperArm',z=.04)
        else:
            rotate('chest',.009*math.sin(w)); rotate('head',y=.035*math.sin(w))
            rotate('L_upperArm',.025*math.sin(w),z=-.035)
            rotate('R_upperArm',-.025*math.sin(w),z=.035)
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_quaternion',frame=f,group=pb.name)
            if pb.name=='hips': pb.keyframe_insert('location',frame=f,group=pb.name)
    track=rig.animation_data.nla_tracks.new(); track.name=name
    strip=track.strips.new(action.name,0,action); strip.name=name
    track.mute=True
    actions[name]=action
rig.animation_data.action=None
neutral(); scene.frame_set(0)

# Gate before export. Greedy surfaces are flat; UVs are unnecessary for solid colours.
stats=[]
for ob in asset.objects:
    if ob.type!='MESH': continue
    me=ob.data
    assert tuple(ob.scale)==(1,1,1)
    assert all(math.isfinite(c) for v in me.vertices for c in v.co)
    assert all(len(v.groups)==1 and abs(v.groups[0].weight-1)<1e-6 for v in me.vertices)
    assert all(p.area>1e-10 for p in me.polygons)
    stats.append({'name':ob.name,'triangles':sum(len(p.vertices)-2 for p in me.polygons),'vertices':len(me.vertices),'materials':len(me.materials)})
assert sum(s['triangles'] for s in stats)<5000, stats
ROOT.joinpath('exports').mkdir(exist_ok=True)
ROOT.joinpath('qa').mkdir(exist_ok=True)
ROOT.joinpath('qa/source.json').write_text(json.dumps({'verdict':'PASS','blender':bpy.app.version_string,'grid_metres':U,'triangles':sum(s['triangles'] for s in stats),'bones':len(bones),'parts':stats,'actions':list(actions),'rigid_weights':True},indent=2))

bpy.ops.object.select_all(action='DESELECT')
for ob in asset.objects: ob.select_set(True)
bpy.context.view_layer.objects.active=rig
# Actions mode exports each stored armature action. Facial shape keys are runtime layers.
bpy.ops.export_scene.gltf(filepath=str(ROOT/'exports/komorebi_npc.glb'),
    export_format='GLB',use_selection=True,export_yup=True,export_extras=True,
    export_cameras=False,export_lights=False,export_animations=True,
    export_animation_mode='ACTIONS',export_anim_single_armature=True,
    export_force_sampling=True,export_frame_step=1,export_morph=True,
    export_morph_animation=False,export_skins=True,export_all_influences=False,
    export_def_bones=False,export_optimize_animation_size=True)

# The .blend opens in a tidy lit character scene; all alternatives remain editable.
for ob in asset.objects:
    if ob.get('npc_part')=='hair': ob.hide_render=ob.get('npc_option')!='crop'
    if ob.get('npc_part')=='outfit': ob.hide_render=ob.get('npc_option')!='jacket'
    if ob.get('npc_part')=='glasses': ob.hide_render=True
    ob.hide_set(ob.hide_render)
rig.animation_data.action=actions['Idle']
scene.frame_start=0; scene.frame_end=90; scene.frame_set(0)

def stage_object(ob):
    for col in list(ob.users_collection): col.objects.unlink(ob)
    stage.objects.link(ob)

floor_mat=bpy.data.materials.new('MAT_Studio_Clay'); floor_mat.diffuse_color=(.22,.27,.25,1)
floor_mat.use_nodes=True; floor_mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.22,.27,.25,1)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.01))
floor=bpy.context.object; floor.name='SM_Studio_Floor'; floor.data.materials.append(floor_mat); stage_object(floor)
for name,loc,power,size in [('Key',(3,-4,6),450,4),('Fill',(-4,-2,3),250,4),('Rim',(1,3,4),600,3)]:
    data=bpy.data.lights.new('LIGHT_'+name,'AREA'); data.energy=power; data.shape='DISK'; data.size=size
    ob=bpy.data.objects.new('LIGHT_'+name,data); stage.objects.link(ob); ob.location=loc
    ob.rotation_euler=(Vector((0,0,1))-ob.location).to_track_quat('-Z','Y').to_euler()
cam_data=bpy.data.cameras.new('CAM_Portrait'); cam=bpy.data.objects.new('CAM_Portrait',cam_data); stage.objects.link(cam)
cam.location=(3,-5,2.65); cam.rotation_euler=(Vector((0,0,.94))-cam.location).to_track_quat('-Z','Y').to_euler()
cam_data.type='ORTHO'; cam_data.ortho_scale=2.75; scene.camera=cam
scene.render.engine='CYCLES'; scene.cycles.samples=32
scene.render.resolution_x=900; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.world.color=(.22,.22,.22)
scene.view_settings.view_transform='AgX'
bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active=rig
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        area.spaces.active.region_3d.view_distance=3.6
        area.spaces.active.region_3d.view_location=(0,0,.95)
        area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
        area.spaces.active.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'komorebi_npc.blend'))
scene.render.filepath=str(ROOT/'qa/blender-hero.png'); bpy.ops.render.render(write_still=True)
print('NPC_BUILD_COMPLETE',json.dumps({'triangles':sum(s['triangles'] for s in stats),'actions':list(actions)}))
