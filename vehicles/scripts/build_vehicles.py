"""Original game vehicles; execute inside Blender through its MCP add-on."""
import bpy, math, json, shutil
from pathlib import Path
from mathutils import Vector
BASE=Path(__file__).resolve().parents[1]
WEB=BASE.parent/'web/public/models/vehicles'
ROOT=None
COL=None
M={}

def xyz(v): return Vector((v[0],-v[2],v[1]))
def parent(obj,p=None):
    p=p or ROOT
    if p:
        mat=obj.matrix_world.copy(); obj.parent=p; obj.matrix_world=mat
    return obj

def link(obj):
    for c in list(obj.users_collection): c.objects.unlink(obj)
    COL.objects.link(obj)
    return obj

def finish(obj,name,mat,p=None,smooth=False):
    obj.name=name; link(obj)
    if mat: obj.data.materials.append(M[mat])
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if smooth:
        for poly in obj.data.polygons: poly.use_smooth=True
    return parent(obj,p)

def material(name,col,metal=0,rough=.55,emit=0):
    m=bpy.data.materials.new('MAT_Vehicle_'+name);m.diffuse_color=(*col,1);m.use_nodes=True
    b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*col,1)
    b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=rough
    if emit: b.inputs['Emission Color'].default_value=(*col,1);b.inputs['Emission Strength'].default_value=emit
    M[name]=m

def empty(name,pos=(0,0,0),p=None):
    o=bpy.data.objects.new(name,None);COL.objects.link(o);o.location=xyz(pos)
    o.empty_display_size=.07;o.empty_display_type='PLAIN_AXES';bpy.context.view_layer.update()
    return parent(o,p)

def box(name,pos,dims,mat,bevel=0,p=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object
    o.dimensions=(dims[0],dims[2],dims[1]);finish(o,name,mat,p)
    if bevel:
        b=o.modifiers.new('Rounded crafted edges','BEVEL');b.width=bevel;b.segments=3
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=b.name)
        for f in o.data.polygons:f.use_smooth=True
        n=o.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL');n.keep_sharp=True
        bpy.ops.object.modifier_apply(modifier=n.name)
    return o

def ell(name,pos,dims,mat,p=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,radius=1,location=xyz(pos));o=bpy.context.object
    o.scale=(dims[0],dims[2],dims[1]);return finish(o,name,mat,p,True)

def cylinder(name,pos,r,depth,mat,axis=(1,0,0),p=None,n=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=depth,location=xyz(pos));o=bpy.context.object
    o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(xyz(axis).normalized())
    return finish(o,name,mat,p,True)

def beam(name,a,b,r,mat,p=None):
    return cylinder(name,(Vector(a)+Vector(b))/2,r,(Vector(b)-Vector(a)).length,mat,Vector(b)-Vector(a),p,12)

def torus(name,pos,major,minor,mat,p=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=24,minor_segments=8,location=xyz(pos));o=bpy.context.object
    o.rotation_euler[1]=math.pi/2
    return finish(o,name,mat,p,True)

def mesh(name,verts,faces,mat,p=None,smooth=False):
    me=bpy.data.meshes.new(name);me.from_pydata([xyz(v) for v in verts],[],faces);me.update()
    o=bpy.data.objects.new(name,me);COL.objects.link(o);me.materials.append(M[mat])
    for f in me.polygons:f.use_smooth=smooth
    return parent(o,p)

def fender(name,z,r,width,mat):
    verts=[];faces=[];steps=18
    for i in range(steps+1):
        a=math.pi*.10 + math.pi*.80*i/steps
        for dr,x in [(0,-width),(0,width),(.022,-width),(.022,width)]:
            verts.append((x,.22+math.sin(a)*(r+dr),z+math.cos(a)*(r+dr)))
    for i in range(steps):
        a=i*4;b=a+4
        faces.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),(a+1,b+1,b+3,a+3)])
    faces.extend([(0,1,3,2),(steps*4,steps*4+2,steps*4+3,steps*4+1)])
    return mesh(name,verts,faces,mat,smooth=True)

def join_static(root):
    # Merge only direct mesh children; animated wheel pivots and sockets survive.
    groups={}
    for o in list(root.children):
        if o.type=='MESH':groups.setdefault(o.data.materials[0].name,[]).append(o)
    for mat,objs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:o.select_set(True)
        bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join()
        objs[0].name=root.name+'_'+mat.replace('MAT_Vehicle_','')

def scooter():
    global ROOT,COL
    COL=bpy.data.collections.new('COL_Scooter');bpy.context.scene.collection.children.link(COL)
    ROOT=None;ROOT=empty('Scooter');ROOT['vehicle_kind']='scooter';ROOT['forward_axis']='+Z';ROOT['wheel_radius']=.22
    for label,z in [('Front',.62),('Rear',-.62)]:
        p=empty('Wheel_'+label,(0,.22,z));p['spin_axis']='X'
        torus(label+'_tire',(0,.22,z),.166,.054,'Rubber',p)
        cylinder(label+'_rim',(0,.22,z),.13,.105,'Cream',p=p)
        cylinder(label+'_hub',(0,.22,z),.060,.13,'Chrome',p=p)
        for side in [-1,1]:
            torus(label+'_rim_ring',(side*.056,.22,z),.112,.009,'Chrome',p)
        fender(label+'_fender',z,.252,.114,'Mint')
    box('Footboard',(0,.258,-.02),(.46,.070,.82),'Cream',.03)
    box('Deck_grip',(0,.299,-.03),(.36,.014,.65),'Rubber',.014)
    for x in [-.105,0,.105]:box('Grip_inlay',(x,.307,-.03),(.012,.003,.55),'Tan',.001)
    ell('Rear_body',(0,.48,-.50),(.295,.255,.365),'Mint')
    ell('Rear_lower_panel',(0,.39,-.50),(.26,.125,.32),'Cream')
    box('Seat_trim',(0,.720,-.25),(.48,.065,.61),'Cream',.028)
    box('Seat',(0,.776,-.25),(.47,.112,.60),'Tan',.05)
    box('Seat_seam',(0,.834,-.30),(.34,.004,.018),'Brown',.002)
    # Stepped curved shield as a closed solid, lower footwell is left open.
    profile=[(.28,.24,.18),(.39,.37,.235),(.69,.47,.245),(.96,.53,.18)]
    vs=[]
    for y,z,w in profile:
        vs.extend([(-w,y,z),(w,y,z),(-w,y,z+.075),(w,y,z+.075)])
    fs=[]
    for i in range(3):
        a=i*4;b=a+4;fs.extend([(a,a+1,b+1,b),(a+2,b+2,b+3,a+3),(a,b,b+2,a+2),(a+1,a+3,b+3,b+1)])
    fs.extend([(0,2,3,1),(12,13,15,14)])
    shield=mesh('Leg_shield',vs,fs,'Cream',smooth=True)
    bevel=shield.modifiers.new('Soft panel edges','BEVEL');bevel.width=.025;bevel.segments=3
    bpy.context.view_layer.objects.active=shield;bpy.ops.object.modifier_apply(modifier=bevel.name)
    beam('Shield_spine',(0,.34,.33),(0,.99,.57),.037,'Mint')
    for x in [-.072,.072]:beam('Front_fork',(x,.22,.62),(x,.94,.52),.022,'Chrome')
    ell('Headlamp_cowl',(0,1.075,.54),(.196,.136,.105),'Mint')
    cylinder('Headlamp_bezel',(0,1.075,.642),.084,.022,'Chrome',axis=(0,0,1))
    cylinder('Headlamp_lens',(0,1.075,.657),.070,.018,'Lamp',axis=(0,0,1),n=24)
    beam('Handlebar',(-.29,1.12,.50),(.29,1.12,.50),.018,'Chrome')
    for sign in [-1,1]:
        cylinder('Grip',(sign*.29,1.12,.50),.026,.125,'Rubber')
        beam('Brake_lever',(sign*.24,1.095,.545),(sign*.345,1.095,.545),.007,'Chrome')
        beam('Mirror_stalk',(sign*.22,1.13,.48),(sign*.275,1.34,.47),.007,'Chrome')
        ell('Mirror_case',(sign*.275,1.36,.47),(.060,.038,.019),'Mint')
        ell('Mirror_glass',(sign*.275,1.36,.454),(.050,.029,.006),'Mirror')
        ell('Rear_indicator',(sign*.18,.52,-.80),(.041,.025,.023),'Amber')
    box('Tail_lamp',(0,.55,-.837),(.13,.064,.025),'Red',.014)
    box('License_plate',(0,.355,-.854),(.16,.08,.012),'Cream',.009)
    # Original tiny geometric brand mark and trim, no external branded assets.
    cylinder('Shield_badge',(0,.81,.583),.026,.009,'Mint',axis=(0,0,1),n=6)
    beam('Rear_grab_rail',(-.18,.74,-.60),(.18,.74,-.60),.015,'Chrome')
    stand=empty('Stand')
    beam('Kickstand',(0,.25,-.39),(-.19,.021,-.40),.014,'Rubber',stand)
    box('Stand_foot',(-.19,.015,-.40),(.065,.03,.09),'Rubber',.008,stand)
    for name,pos in [('Seat',(0,.832,-.22)),('Hand_L',(-.28,1.12,.5)),('Hand_R',(.28,1.12,.5)),('Foot_L',(-.15,.308,.05)),('Foot_R',(.15,.308,.05))]:
        o=empty('Socket_'+name,pos);o['socket']=name
    join_static(ROOT);return ROOT,COL

def deck_outline(length,width,steps=24):
    return [(math.sin(i*2*math.pi/steps)*width/2,math.cos(i*2*math.pi/steps)*length/2) for i in range(steps)]

def deck(name,length,width,base,thick,mat):
    verts=[];faces=[];rows=25
    for i in range(rows):
        z=(i/(rows-1)-.5)*length
        cap=max(0,(abs(z)-(length/2-width/2))/(width/2))
        half=max(.008,width/2*math.sqrt(max(0,1-cap*cap)))
        kick=max(0,abs(z)-.28)*.28
        verts.extend([(-half,base+kick,z),(half,base+kick,z),(-half,base+thick+kick,z),(half,base+thick+kick,z)])
    for i in range(rows-1):
        a=i*4;b=a+4
        faces.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a,a+2,b+2,b),(a+1,b+1,b+3,a+3)])
    faces.extend([(0,1,3,2),((rows-1)*4,(rows-1)*4+2,(rows-1)*4+3,(rows-1)*4+1)])
    return mesh(name,verts,faces,mat)

def skateboard():
    global ROOT,COL
    COL=bpy.data.collections.new('COL_Skateboard');bpy.context.scene.collection.children.link(COL)
    ROOT=None;ROOT=empty('Skateboard');ROOT['vehicle_kind']='skateboard';ROOT['forward_axis']='+Z';ROOT['wheel_radius']=.045
    deck('Maple_deck',.85,.265,.109,.023,'Tan')
    deck('Mint_bottom',.847,.263,.106,.004,'Mint')
    deck('Grip_tape',.815,.241,.133,.004,'Rubber')
    for z in [-.27,.27]:
        box('Truck_base',(0,.104,z),(.075,.018,.070),'Chrome',.006)
        beam('Truck_hanger',(-.13,.062,z),(.13,.062,z),.012,'Chrome')
        beam('Kingpin',(0,.097,z),(0,.056,z+.02),.013,'Chrome')
        for sign in [-1,1]:
            label=('F' if z>0 else 'R')+('L' if sign<0 else 'R')
            p=empty('Wheel_'+label,(sign*.133,.045,z));p['spin_axis']='X'
            cylinder(label+'_wheel',(sign*.133,.045,z),.045,.037,'Cream',p=p,n=20)
            cylinder(label+'_bearing',(sign*.154,.045,z),.014,.006,'Chrome',p=p,n=12)
        for x in [-.027,.027]:
            for zz in [z-.022,z+.022]:cylinder('Deck_bolt',(x,.139,zz),.005,.003,'Chrome',axis=(0,1,0),n=8)
    box('Deck_stripe',(0,.140,.04),(.22,.003,.025),'Mint',.003)
    cylinder('Deck_badge',(0,.140,-.04),.029,.003,'Amber',axis=(0,1,0),n=6)
    for name,pos in [('Foot_L',(0,.14,.20)),('Foot_R',(0,.14,-.20))]:
        o=empty('Socket_Board_'+name,pos);o['socket']=name
    join_static(ROOT);return ROOT,COL

def hierarchy(root):return [root]+list(root.children_recursive)
def export(root,kind):
    bpy.ops.object.select_all(action='DESELECT')
    for o in hierarchy(root):o.select_set(True)
    bpy.context.view_layer.objects.active=root
    path=BASE/'exports'/f'{kind}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False)
    WEB.mkdir(parents=True,exist_ok=True);shutil.copy2(path,WEB/path.name)
    tris=0;verts=0;bounds=[];bad=[]
    for o in hierarchy(root):
        if o.type!='MESH':continue
        o.data.calc_loop_triangles();tris+=len(o.data.loop_triangles);verts+=len(o.data.vertices)
        bounds.extend([o.matrix_world@Vector(v) for v in o.bound_box])
        for v in o.data.vertices:
            if not all(math.isfinite(c) for c in v.co):bad.append(o.name)
    lo=[min(p[i] for p in bounds) for i in range(3)];hi=[max(p[i] for p in bounds) for i in range(3)]
    assert not bad
    assert tris < (12000 if kind=='scooter' else 4000),(kind,tris)
    return {'triangles':tris,'vertices':verts,'bytes':path.stat().st_size,'blender_bounds':[lo,hi],'wheel_nodes':[o.name for o in hierarchy(root) if o.name.startswith('Wheel_')],'sockets':{o.name:list(o.location) for o in hierarchy(root) if o.name.startswith('Socket_')},'finite_geometry':True}

def build():
    global ROOT,COL
    for name in ['Kyoto_Vehicles','Vehicle_Studio']:
        s=bpy.data.scenes.get(name)
        if s:bpy.data.scenes.remove(s)
    # Only our old vehicle collections are replaced on reruns.
    for c in list(bpy.data.collections):
        if c.name.startswith(('COL_Scooter','COL_Skateboard','COL_VehicleStudio')):
            for o in list(c.objects):bpy.data.objects.remove(o,do_unlink=True)
            bpy.data.collections.remove(c)
    scene=bpy.data.scenes.new('Kyoto_Vehicles');bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC'
    palette={'Mint':((.12,.40,.34),.12,.38,0),'Cream':((.89,.82,.64),.05,.48,0),'Tan':((.50,.23,.10),0,.72,0),'Brown':((.19,.065,.029),0,.8,0),'Rubber':((.028,.041,.044),0,.82,0),'Chrome':((.51,.60,.60),.72,.28,0),'Mirror':((.39,.66,.70),.6,.17,0),'Lamp':((1,.82,.42),0,.3,.7),'Red':((.60,.035,.025),.1,.3,.2),'Amber':((1,.40,.075),.1,.4,0),'Ground':((.31,.37,.34),0,.95,0)}
    for k,(c,m,r,e) in palette.items():material(k,c,m,r,e)
    a,ac=scooter();b,bc=skateboard();bpy.context.view_layer.update()
    report={'coordinate_system':'GLB Y-up, +Z forward; wheels rotate about local X','scooter':export(a,'scooter'),'skateboard':export(b,'skateboard')}
    (BASE/'QA.json').write_text(json.dumps(report,indent=2))
    studio=bpy.data.scenes.new('Vehicle_Studio');bpy.context.window.scene=studio
    COL=bpy.data.collections.new('COL_VehicleStudio');studio.collection.children.link(COL);ROOT=None
    for name,c,pos in [('Scooter_display',ac,(-.47,0,0)),('Skateboard_display',bc,(.59,0,.15))]:
        o=empty(name,pos);o.instance_type='COLLECTION';o.instance_collection=c
        if c==bc:o.rotation_euler.z=math.radians(-18)
    box('Studio_plinth',(0,-.07,0),(4.6,.12,3.4),'Ground',.05)
    # A 1.7m scale marker is available for modeling but excluded from beauty.
    ref=empty('Scale_reference_1_7m');ref.empty_display_size=1.7;ref['height_m']=1.7
    world=bpy.data.worlds.new('Vehicle_studio_world');studio.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.22,.30,.34,1);world.node_tree.nodes['Background'].inputs[1].default_value=.5
    for name,pos,power,size,col in [('Key',(-3,5,4),850,5,(1,.83,.66)),('Fill',(4,3,1),650,4,(.65,.82,1)),('Rim',(1,4,-4),1000,3,(1,.65,.37))]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=col
        o=bpy.data.objects.new(name,data);COL.objects.link(o);o.location=xyz(pos);o.rotation_euler=(xyz((0,.5,0))-o.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Vehicle_camera');cam=bpy.data.objects.new('Vehicle_camera',data);COL.objects.link(cam)
    cam.location=xyz((3,2.0,3.6));target=xyz((.0,.58,.0));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=2.8;studio.camera=cam
    studio.render.engine='CYCLES';studio.cycles.samples=48;studio.cycles.use_denoising=True
    studio.render.resolution_x=1400;studio.render.resolution_y=1050;studio.render.resolution_percentage=100
    studio.view_settings.view_transform='AgX';studio.render.image_settings.file_format='PNG';studio.render.filepath=str(BASE/'renders/vehicles_hero.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'vehicles.blend'))
    print('VEHICLE_ASSETS_READY',json.dumps(report))

def render():bpy.ops.render.render(write_still=True)
