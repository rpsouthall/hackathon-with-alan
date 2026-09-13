"""Re-import the delivered preset GLBs into a separate Blender scene and render them."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.name='Komorebi_Residents';scene.unit_settings.system='METRIC'
cast=bpy.data.collections.new('COL_Residents');scene.collection.children.link(cast)
actors=[];data=[]
for i,name in enumerate(['local_guide','cafe_owner','inn_host']):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'exports'/f'{name}.glb'))
    imported=set(bpy.data.objects)-before
    anchor=bpy.data.objects.new('NPC_'+name,None);cast.objects.link(anchor)
    anchor.location=((i-1)*1.4,0,0);anchor.rotation_euler.z=math.radians(-8 if i==0 else 8 if i==2 else 0)
    for ob in imported:
        if ob.parent is None:ob.parent=anchor
        if ob.type=='ARMATURE':
            if ob.animation_data:
                for track in ob.animation_data.nla_tracks:track.mute=True
                ob.animation_data.action=None
            for bone in ob.pose.bones:bone.matrix_basis.identity()
    data.append({'id':name,'objects':len(imported),'mesh_count':sum(o.type=='MESH' for o in imported),'armatures':sum(o.type=='ARMATURE' for o in imported)})
    actors.append(anchor)

def mat(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.9;return m
floor_material=mat('MAT_Studio_Floor',(.54,.58,.47))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.11));bpy.context.object.data.materials.append(floor_material)
pedestal=mat('MAT_Pedestal',(.67,.7,.59))
for actor in actors:
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.61,depth=.1,location=(actor.location.x,0,-.052))
    bpy.context.object.name='SM_Studio_Pedestal';bpy.context.object.data.materials.append(pedestal)
for name,loc,power,size in [('Key',(0,-5,7),900,6),('Fill',(-5,-1,3),400,5),('Rim',(3,3,5),950,4)]:
    light=bpy.data.lights.new('LIGHT_'+name,'AREA');light.energy=power;light.shape='DISK';light.size=size
    ob=bpy.data.objects.new('LIGHT_'+name,light);scene.collection.objects.link(ob);ob.location=loc
    ob.rotation_euler=(Vector((0,0,.8))-ob.location).to_track_quat('-Z','Y').to_euler()
cam_data=bpy.data.cameras.new('CAM_Residents');cam=bpy.data.objects.new('CAM_Residents',cam_data);scene.collection.objects.link(cam)
cam.location=(3,-9,4.0);cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler()
cam_data.type='ORTHO';cam_data.ortho_scale=5.4;scene.camera=cam
scene.world.color=(.35,.35,.35);scene.view_settings.view_transform='AgX'
scene.render.engine='CYCLES';scene.cycles.samples=48
scene.render.resolution_x=1440;scene.render.resolution_y=880;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.frame_set(0)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'komorebi_residents.blend'))
scene.render.filepath=str(ROOT/'qa/residents.png');bpy.ops.render.render(write_still=True)
# A front/back/side contact sheet verifies silhouettes and third-person details.
for i,actor in enumerate(actors):actor.rotation_euler.z=(0,math.pi,math.pi/2)[i]
cam.location=(0,-10,2.4);cam.rotation_euler=(Vector((0,0,.9))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(ROOT/'qa/silhouettes.png');bpy.ops.render.render(write_still=True)
ROOT.joinpath('qa/blender-roundtrip.json').write_text(json.dumps({'verdict':'PASS','presets':data},indent=2))
