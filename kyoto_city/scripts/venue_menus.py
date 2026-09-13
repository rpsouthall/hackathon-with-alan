"""Small mesh-only Japanese menu panels for the eight finished venue interiors."""
import math
from pathlib import Path


PANELS = [
    ('kissa_aoi', -27.0, -13.0, math.pi/2, '喫茶あおい', '珈琲　お茶', 3.34),
    ('ramen_akari', -27.0, -2.0, math.pi/2, 'らーめん', '醤油　味噌　塩', 2.83),
    ('bookshop_tsuki', -27.0, 10.0, math.pi/2, '本と暮らし', '文学　旅　歴史', 2.83),
    ('sakura_bakery', 27.0, -13.0, -math.pi/2, '焼きたてパン', 'あんパン　食パン', 2.83),
    ('izakaya_tomo', 27.0, -2.0, -math.pi/2, 'おしながき', '焼き魚　枝豆　お酒', 2.83),
    ('tea_hanami', 27.0, 10.0, -math.pi/2, '日本茶', '煎茶　抹茶　ほうじ茶', 3.34),
    ('market_provisions', -13.0, 23.0, 0.0, '季節の食材', '野菜　果物　お米', 3.34),
    ('restaurant_momiji', 13.0, 23.0, 0.0, 'お食事', '天ぷら　そば　うどん', 3.34),
]


def add_venue_menus(K):
    import bpy
    from mathutils import Matrix

    font_path=Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
    if not font_path.is_file():
        raise FileNotFoundError('Required Japanese source font is absent: '+str(font_path))
    font=bpy.data.fonts.load(str(font_path),check_existing=True)
    results=[]

    for vid,cx,cy,angle,header,items,panel_y in PANELS:
        C=K['collection']('COL_Venue_'+vid)
        prefix='Menu_'+vid+'_'
        created=[]

        def box(name,loc,dims,mat):
            ob=K['box'](prefix+name,loc,dims,mat,C)
            created.append(ob)
            return ob

        # On four venues the board mounts on the room-facing shelf fronts;
        # the other four boards attach directly to the blank plaster back wall.
        box('paper',(0,panel_y,2.27),(1.75,.05,1.10),'paper')
        for z in (1.686,2.854):
            box('horizontal_frame',(0,panel_y-.035,z),(1.87,.075,.068),'wood_dark')
        for x in (-.900,.900):
            box('vertical_frame',(x,panel_y-.035,2.27),(.067,.075,1.17),'wood_dark')

        def lettering(name,body,z,size,max_width):
            curve=bpy.data.curves.new(prefix+name+'_curve','FONT')
            curve.font=font;curve.body=body;curve.align_x='CENTER';curve.align_y='CENTER'
            curve.size=size;curve.extrude=0;curve.bevel_depth=0;curve.resolution_u=1
            curve.space_character=1.0
            curve.materials.append(bpy.data.materials['MAT_wood_dark'])
            temp=bpy.data.objects.new(prefix+name+'_source',curve);C.objects.link(temp)
            bpy.context.view_layer.update()
            dg=bpy.context.evaluated_depsgraph_get()
            data=bpy.data.meshes.new_from_object(temp.evaluated_get(dg),depsgraph=dg)
            # Fit long Japanese strings by baking scale into vertices, so the
            # returned mesh object's transforms remain unit-scaled.
            if data.vertices:
                width=max(v.co.x for v in data.vertices)-min(v.co.x for v in data.vertices)
                if width>max_width:
                    scale=max_width/width
                    for v in data.vertices:v.co*=scale
            ob=bpy.data.objects.new('SM_'+prefix+name,data);C.objects.link(ob)
            ob.location=(0,panel_y-.055,z)
            ob.rotation_euler=(math.pi/2,0,0)
            ob['venue_id']=vid;ob['japanese_text']=body
            bpy.data.objects.remove(temp,do_unlink=True)
            if curve.users==0:bpy.data.curves.remove(curve)
            created.append(ob)
            return ob

        lettering('heading',header,2.50,.23,1.48)
        lettering('items',items,2.16,.17,1.48)
        box('fine_rule',(0,panel_y-.052,2.327),(1.35,.005,.012),'wood_light')

        # A restrained, flat floral crest uses the existing dark timber color.
        verts=[];faces=[]
        for petal in range(5):
            a=math.tau*petal/5
            px,pz=math.cos(a)*.038,1.892+math.sin(a)*.038
            start=len(verts)
            for i in range(7):
                t=math.tau*i/7
                rr=.026
                verts.append((px+math.cos(t)*rr,panel_y-.056,pz+math.sin(t)*rr))
            faces.append(tuple(range(start,start+7)))
        ob=K['mesh'](prefix+'floral_crest',verts,faces,'wood_dark',C);created.append(ob)

        bpy.context.view_layer.update()
        transform=Matrix.Translation((cx,cy,0)) @ Matrix.Rotation(angle,4,'Z')
        count=0
        for ob in created:
            ob.matrix_world=transform @ ob.matrix_world
            ob['venue_id']=vid;ob['decoration']='japanese_menu_panel'
            if ob.type=='MESH':
                ob.data.calc_loop_triangles();count+=len(ob.data.loop_triangles)
        results.append({'venue_id':vid,'heading':header,'items':items,
                        'panel_y_local':panel_y,'triangles':count})

    bpy.context.view_layer.update()
    total=sum(x['triangles'] for x in results)
    if total>=8000:
        raise RuntimeError('Japanese menu panels exceed the 8,000 triangle budget: '+str(total))
    return {'panels':results,'total_triangles':total,'font_embedded_as_meshes':True,
            'floor_or_collision_changes':False}
