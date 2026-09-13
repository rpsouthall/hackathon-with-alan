"""Export compact browser assets without changing the editable source scene."""
import bpy,json,math
from pathlib import Path
from mathutils import Matrix,Vector

ROOT=Path(__file__).resolve().parents[1]
EXCLUDED={'COL_Collision','COL_Presentation','COL_ScaleReference','COL_LODs'}

def clear_generated_export_scenes():
    """Remove only our disposable export copies; keep source and starting scene."""
    source=bpy.context.scene
    source_objects=set(source.objects)
    prefixes=('Kyoto_Web_','Kyoto_Collision_Export','Kyoto_City_Web_','Kyoto_City_Collision_Export')
    for scene in list(bpy.data.scenes):
        if scene==source or not scene.name.startswith(prefixes):continue
        collections=list(scene.collection.children)
        for ob in list(scene.objects):
            if ob in source_objects:continue
            data=ob.data if ob.type=='MESH' else None
            bpy.data.objects.remove(ob,do_unlink=True)
            if data and data.users==0:bpy.data.meshes.remove(data)
        bpy.data.scenes.remove(scene)
        for col in collections:
            if col.users==0:bpy.data.collections.remove(col)

def additional_colliders(K):
    box=K['box']
    def col(name,loc,dims):
        ob=box('SM_COL_'+name,loc,dims,None,'COL_Collision');ob.hide_render=True;ob.display_type='WIRE';ob['collider']='box';return ob
    for ob in list(bpy.context.scene.objects):
        if ob.type=='MESH' and '_sculpted_trunk' in ob.name:
            bb=[ob.matrix_world@Vector(v) for v in ob.bound_box]
            low=[min(v[i] for v in bb) for i in range(3)];hi=[max(v[i] for v in bb) for i in range(3)]
            col('TreeTrunk',((low[0]+hi[0])/2,(low[1]+hi[1])/2,1.3),(max(.45,hi[0]-low[0]),max(.45,hi[1]-low[1]),2.2))
        if ob.name.startswith('SM_Toro_Base'):
            col('StoneLantern',(ob.location.x,ob.location.y,1.15),(.82,.82,2.3))
    for i in range(3):col('ShrinePlatform',(-11,8,.4+i*.2),(8.5-i*.45,8.5-i*.45,.22))
    col('TeaTerrace',(12.8,-8.55,.40),(5.12,3.56,.30))
    col('TeaTable',(12.7,-8.55,.88),(1.50,.70,.65))
    # Entrances are exterior interactions; protect protruding shop counter/porches.
    for name,loc,dims in [('CafePorch',(10,-.28,.44),(7.4,.7,.4)),('MerchantPorch',(-11,-7.28,.44),(7.4,.7,.4)),('InnPorch',(10.5,8.12,.44),(7.4,.7,.4))]:col(name,loc,dims)

def make_export_scene(lod=False):
    source=bpy.context.scene;source.view_layers[0].update()
    export=bpy.data.scenes.new('Kyoto_City_Web_LOD1' if lod else 'Kyoto_City_Web_Export');export.unit_settings.system='METRIC';export.unit_settings.scale_length=1
    col=bpy.data.collections.new('COL_Web_Optimized');export.collection.children.link(col)
    deps=bpy.context.evaluated_depsgraph_get();buckets={}
    for ob in source.objects:
        if ob.type!='MESH' or ob.hide_render or any(c.name in EXCLUDED for c in ob.users_collection):continue
        if lod and any(s in ob.name.lower() for s in ('tile_rib','tile_course','latticeh','latticev','flower_tuft','aggregate','water_glint','bamboo_leaf','fallen_petals','grass_blade','fine_detail','roof_course','roof_tile','book_spine')):continue
        group=ob.users_collection[0].name
        evalob=ob.evaluated_get(deps);me=evalob.to_mesh();wm=ob.matrix_world
        colors=me.color_attributes.get('Color')
        for mi,mat in enumerate(me.materials):
            if mat is None:continue
            key=(group,mat.name)
            b=buckets.setdefault(key,{'verts':[],'faces':[],'smooth':[],'colors':[],'colored':False,'mat':mat})
            selected=[p for p in me.polygons if p.material_index==mi]
            if not selected:continue
            # Duplicate only the vertices actually used in this material group.
            remap={}
            for p in selected:
                face=[]
                for li in p.loop_indices:
                    vi=me.loops[li].vertex_index
                    color=tuple(colors.data[vi if colors.domain=='POINT' else li].color) if colors else (1,1,1,1)
                    ck=(vi,color)
                    if ck not in remap:
                        remap[ck]=len(b['verts']);b['verts'].append(tuple(wm@me.vertices[vi].co));b['colors'].append(color)
                    face.append(remap[ck])
                b['faces'].append(face);b['smooth'].append(p.use_smooth)
            if colors:b['colored']=True
        evalob.to_mesh_clear()
    stats=[]
    for (group,matname),b in sorted(buckets.items()):
        name='SM_'+group.removeprefix('COL_')+'_'+matname.removeprefix('MAT_')
        me=bpy.data.meshes.new(name);me.from_pydata(b['verts'],[],b['faces']);me.materials.append(b['mat']);me.update()
        for p,smooth in zip(me.polygons,b['smooth']):p.use_smooth=smooth
        if b['colored']:
            attr=me.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='POINT')
            for d,c in zip(attr.data,b['colors']):d.color=c
            me.color_attributes.active_color_index=0
        ob=bpy.data.objects.new(name,me);col.objects.link(ob);ob['district_collection']=group
        stats.append({'object':name,'triangles':sum(len(p.vertices)-2 for p in me.polygons)})
    for ob in source.objects:
        if ob.name.startswith('MARK_'):
            col.objects.link(ob)
    export['source_scene']=source.name;export['authoring_units']='metres';export['gameplay']='enterable static city; markers and collision data require a runtime controller'
    bpy.context.window.scene=export
    bpy.ops.object.select_all(action='SELECT')
    path=ROOT/'exports'/('kyoto_city_lod1.glb' if lod else 'kyoto_city.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_apply=True,export_vertex_color='ACTIVE',export_all_vertex_colors=True)
    # Source remains full detail. Export copy has been used only to serialize two LODs.
    bpy.context.window.scene=source
    ROOT.joinpath('export_lod1_stats.json' if lod else 'export_stats.json').write_text(json.dumps({'source_scene':source.name,'render_meshes':len(stats),'triangles':sum(x['triangles'] for x in stats),'buckets':stats},indent=2))
    print('Exported',len(stats),'render meshes',sum(x['triangles'] for x in stats),'triangles')
    return export

def export_collision():
    source=bpy.context.scene
    scene=bpy.data.scenes.new('Kyoto_City_Collision_Export');scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
    records=[];qconv=Matrix.Rotation(-math.pi/2,4,'X').to_quaternion()
    for ob in source.objects:
        if not any(c.name=='COL_Collision' for c in ob.users_collection):continue
        cp=ob.copy();cp.data=ob.data.copy();cp.hide_render=False;cp.hide_viewport=False;scene.collection.objects.link(cp)
        cp['collider']='box'
        pos=qconv@ob.matrix_world.translation;q=qconv@ob.matrix_world.to_quaternion()@qconv.inverted()
        # Map local box dimensions and rotate by basis-conjugated orientation.
        dim=ob.dimensions
        # Dimensions are local mesh bounds, rather than world AABB of rotated bridge boxes.
        bb=ob.bound_box;localdim=[max(v[i] for v in bb)-min(v[i] for v in bb) for i in range(3)]
        rec={'name':ob.name,'shape':'box','position':list(pos),'quaternion':[q.x,q.y,q.z,q.w],'halfExtents':[localdim[0]/2,localdim[2]/2,localdim[1]/2]}
        records.append(rec)
    bpy.context.window.scene=scene
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'exports/kyoto_city_collision.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True,export_animations=False)
    bpy.context.window.scene=source
    markers=[]
    for ob in source.objects:
        if ob.name.startswith('MARK_'):
            markers.append({'name':ob.name,'position':list(qconv@ob.matrix_world.translation),'properties':dict(ob.items())})
    lights=[]
    for ob in source.objects:
        if ob.type=='LIGHT' and ob.data.type=='POINT':
            lights.append({'name':ob.name,'position':list(qconv@ob.matrix_world.translation),
                           'color':list(ob.data.color),'blender_watts':ob.data.energy,
                           'runtime_intensity':18,'range':10,'venue_id':ob.get('venue_id','')})
    ROOT.joinpath('exports/kyoto_city_gameplay.json').write_text(json.dumps({'units':'metres','up_axis':'Y','source_to_gltf':'(x, y, z) Blender -> (x, z, -y)','footprint_m':[68,54],'base_footprint_m':[38,32],'colliders':records,'markers':markers,'lights':lights,'player':{'radius':.28,'standing_height':1.7,'step_height':.22,'max_slope_degrees':35},'note':'Instantiate these collision boxes and lights in your runtime. GLB rendering alone does not add collisions. Light intensity is an art-directed Three.js value, not an exact conversion from Blender watts.'},indent=2))
    print('Collision exported',len(records),'proxies')
