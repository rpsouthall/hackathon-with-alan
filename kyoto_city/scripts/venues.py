"""Eight original enterable Kyoto venues, authored locally then transformed.

Run build_venues(K) inside Blender with the shared kyoto/scripts/core.py helpers.
This module is safe to import outside Blender to inspect make_manifest().
"""
import json
import math
from pathlib import Path

VENUES = [
    ('kissa_aoi', 'Kissa Aoi', 'cafe', -27.0, -13.0, math.pi/2, 'indigo'),
    ('ramen_akari', 'Ramen Akari', 'ramen', -27.0, -2.0, math.pi/2, 'vermilion'),
    ('bookshop_tsuki', 'Bookshop Tsuki', 'bookshop', -27.0, 10.0, math.pi/2, 'sage'),
    ('sakura_bakery', 'Sakura Bakery', 'bakery', 27.0, -13.0, -math.pi/2, 'blossom_dark'),
    ('izakaya_tomo', 'Izakaya Tomo', 'izakaya', 27.0, -2.0, -math.pi/2, 'indigo'),
    ('tea_hanami', 'Tea Hanami', 'tea', 27.0, 10.0, -math.pi/2, 'sage'),
    ('market_provisions', 'Market Provisions', 'grocer', -13.0, 23.0, 0.0, 'sage'),
    ('restaurant_momiji', 'Restaurant Momiji', 'restaurant', 13.0, 23.0, 0.0, 'vermilion'),
]
LOCAL_MARKERS = {
    'entry': (0.0,-5.1,.32),
    'inside': (0.0,-2.0,.32),
    'interaction': (0.0,.5,.32),
    'npc': (2.1,1.8,.32),
}


def make_manifest():
    venues=[]
    for vid,title,kind,cx,cy,angle,accent in VENUES:
        ca,sa=math.cos(angle),math.sin(angle)
        def world(p):
            x,y,z=p
            return [round(cx+ca*x-sa*y,6),round(cy+sa*x+ca*y,6),z]
        venues.append({
            'id':vid,'name':title,'type':kind,'is_enterable':True,
            'collection':'COL_Venue_'+vid,'position':[cx,cy,0.0],
            'rotation_z':angle,'dimensions_local':[7.2,7.0,5.66 if kind in ('bookshop','izakaya') else 3.7],
            'ground_floor_wall_height':3.40,'roof_peak_z':6.81 if kind in ('bookshop','izakaya') else 5.34,
            'floor_z':.30,'door_clear_width':1.90,'door_clear_height':2.60,
            'central_aisle_width':2.20,'interaction_radius':2.8,
            'accessible_storeys':1,'decorative_upper_storey':kind in ('bookshop','izakaya'),
            'upper_storey_accessible':False,
            'npc_id':vid+'_host','accent_material':accent,
            'markers':{k:{'name':'MARK_'+k+'_'+vid,'local':list(p),'global':world(p)}
                       for k,p in LOCAL_MARKERS.items()},
            'clear_npc_zone_local':{'min':[1.65,1.2,.30],'max':[2.75,2.55,2.4]},
            'floor_support':'SM_COL_'+vid+'_floor',
            'furnishing_theme':{
                'cafe':'Espresso bar, pastry display, two cafe tables and coffee service',
                'ramen':'Ramen counter, stools, cooking range, bowls and a small dining table',
                'bookshop':'Full bookshelves, display stacks, reading desk and a sales counter',
                'bakery':'Open bread display, pastry table, baking oven and storage shelves',
                'izakaya':'Timber bar, sake bottles, dining table, benches and small plates',
                'tea':'Tatami sitting platform, low tea tables, cushions and ceramic display',
                'grocer':'Produce crates, fruit displays, jars and a rear provisions counter',
                'restaurant':'Dining tables, chairs, place settings and a rear kitchen counter',
            }[kind],
        })
    return {
        'schema_version':2,'units':'metres','up_axis':'Z',
        'coordinate_space':'Blender source; global = T(venue position) * Rz(rotation_z) * local',
        'note':'All route markers are foot reference positions. Enterable new venues are exterior shells with actual furnished interiors; original central buildings remain exterior assets.',
        'venues':venues,
    }


def build_venues(K):
    import bpy
    from mathutils import Matrix

    B=K['box']; M=K['mesh']; beam=K['beam']; cyl=K['cylinder']; ball=K['uvball']
    collection=K['collection']
    CC=collection('COL_Collision')
    GC=collection('COL_Gameplay')
    LC=collection('COL_VenueLights')
    manifest=make_manifest()
    runtime_stats=[]

    for vid,title,kind,cx,cy,angle,accent in VENUES:
        before=set(bpy.data.objects)
        C=collection('COL_Venue_'+vid)
        C['is_enterable']=True; C['venue_id']=vid; C['venue_type']=kind; C['display_name']=title
        prefix=vid+'_'
        local_colliders=[]

        def b(n,p,d,mat='wood',bevel=0):
            return B(prefix+n,p,d,mat,C,bevel=bevel)

        def collider(n,p,d):
            obj=B('SM_COL_'+prefix+n,p,d,None,CC)
            obj.display_type='WIRE';obj.hide_render=True
            obj['collider']='box';obj['venue_id']=vid;obj['is_enterable']=True
            local_colliders.append({'name':obj.name,'position':list(p),'dimensions':list(d)})
            return obj

        def solid(n,p,d,mat='wood',bevel=0):
            obj=b(n,p,d,mat,bevel)
            collider(n,p,d)
            return obj

        def lathe(n,p,profile,mat='ceramic',segments=10,close_bottom=True):
            x,y,z=p;verts=[];faces=[]
            for r,h in profile:
                for i in range(segments):
                    a=math.tau*i/segments
                    verts.append((x+r*math.cos(a),y+r*math.sin(a),z+h))
            for j in range(len(profile)-1):
                for i in range(segments):
                    q=(i+1)%segments
                    faces.append((j*segments+i,j*segments+q,(j+1)*segments+q,(j+1)*segments+i))
            if close_bottom:faces.append(tuple(reversed(range(segments))))
            return M(prefix+n,verts,faces,mat,C)

        def cup(n,x,y,z,mat='ceramic'):
            lathe(n,(x,y,z),[(.045,0),(.055,.02),(.067,.125),(.058,.132),(.051,.025)],mat)
            cyl(prefix+n+'_tea',(x,y,z+.105),.053,.003,'wood_dark',C,vertices=10)

        def bowl(n,x,y,z,food=False):
            lathe(n,(x,y,z),[(.08,0),(.12,.025),(.22,.12),(.24,.19),(.22,.20),(.20,.15)],'ceramic',12)
            cyl(prefix+n+'_soup',(x,y,z+.154),.201,.009,'sand' if food else 'wood_dark',C,vertices=12)
            if food:
                for dx,dy,mat in ((-.06,.035,'paper'),(.09,.05,'sage'),(.02,-.06,'vermilion')):
                    ball(prefix+n+'_topping',(x+dx,y+dy,z+.19),(.043,.047,.017),mat,C,segments=8,rings=4)
                for i in range(3):
                    beam(prefix+n+'_noodles',(x-.13,y-.07+i*.045,z+.18),
                         (x+.12,y-.035+i*.045,z+.18),.009,'paper',C,vertices=5)

        def tea_set(n,x,y,z):
            b(n+'_tray',(x,y,z+.025),(.72,.43,.045),'wood_dark',.015)
            cup(n+'_cup_a',x-.22,y-.1,z+.05)
            cup(n+'_cup_b',x+.22,y+.06,z+.05)
            ball(prefix+n+'_pot',(x,y,z+.155),(.13,.115,.105),'ceramic',C,segments=10,rings=6)
            cyl(prefix+n+'_lid',(x,y,z+.25),.075,.025,'ceramic',C,vertices=10)
            beam(prefix+n+'_spout',(x+.08,y,z+.15),(x+.19,y,z+.205),.035,'ceramic',C,vertices=7)
            beam(prefix+n+'_handle',(x,y-.09,z+.15),(x,y-.23,z+.17),.028,'wood',C,vertices=7)

        def jar(n,x,y,z,r=.13,h=.38,mat='ceramic'):
            lathe(n,(x,y,z),[(r*.6,0),(r,.08),(r,h*.62),(r*.6,h*.85),(r*.6,h)],mat)
            cyl(prefix+n+'_cap',(x,y,z+h+.015),r*.65,.035,'wood_dark',C,vertices=10)

        def bottle(n,x,y,z,mat='sage'):
            lathe(n,(x,y,z),[(.065,0),(.075,.03),(.075,.25),(.035,.30),(.031,.45)],mat)
            cyl(prefix+n+'_cork',(x,y,z+.46),.037,.035,'wood_light',C,vertices=8)
            b(n+'_label',(x,y-.075,z+.16),(.083,.008,.10),'paper')

        def stool(n,x,y,z=.30,height=.48,mat='wood'):
            cyl(prefix+n+'_seat',(x,y,z+height),.215,.095,mat,C,vertices=12)
            for dx,dy in ((-.13,-.11),(.13,-.11),(0,.14)):
                beam(prefix+n+'_leg',(x+dx*1.16,y+dy*1.16,z),(x+dx,y+dy,z+height-.04),
                     .031,'wood_dark',C,vertices=6)
            collider(n,(x,y,z+height/2),(.44,.44,height+.10))

        def bench(n,x,y,width=1.7,mat='wood'):
            b(n+'_seat',(x,y,.75),(width,.53,.11),mat,.024)
            for dx in (-width*.35,width*.35):
                b(n+'_leg',(x+dx,y,.525),(.13,.41,.45),'wood_dark',.008)
            collider(n,(x,y,.55),(width,.53,.50))

        def table(n,x,y,width=1.4,depth=.90,height=.78):
            top=.30+height
            b(n+'_top',(x,y,top),(width,depth,.10),'wood_light',.025)
            b(n+'_apron',(x,y,top-.14),(width-.15,depth-.13,.16),'wood')
            for dx in (-width*.36,width*.36):
                for dy in (-depth*.32,depth*.32):
                    b(n+'_leg',(x+dx,y+dy,.30+height/2),(.075,.075,height),'wood_dark')
            collider(n,(x,y,.30+(height+.05)/2),(width,depth,height+.05))
            return top+.05

        def counter(n,x,y,width,depth,height=1.06,mat='wood'):
            solid(n+'_body',(x,y,.30+height/2),(width,depth,height),mat,.02)
            b(n+'_worktop',(x,y,.30+height+.035),(width+.08,depth+.08,.07),'wood_light',.018)
            collider(n+'_worktop',(x,y,.30+height+.035),(width+.08,depth+.08,.07))
            # Readable framing on all sides, with no thin decorative colliders.
            for zz in (.53,.30+height-.13):
                b(n+'_trim',(x,y-depth/2-.02,zz),(width-.10,.04,.055),'wood_dark')
            return .30+height+.075

        def shelf(n,x,y,width=1.7,depth=.42,height=2.4,fill='jars',face='front'):
            # Closed back, upright frame and five open display levels.
            def place(q,dx,dy,z,w,d,h,mat):
                if face=='side':return b(n+q,(x+dy,y+dx,z),(d,w,h),mat)
                if face=='left':return b(n+q,(x-dy,y+dx,z),(d,w,h),mat)
                return b(n+q,(x+dx,y+dy,z),(w,d,h),mat)
            place('_back',0,depth/2-.03,.30+height/2,width,.06,height,'wood_dark')
            for dx in (-width/2+.045,width/2-.045):
                place('_post',dx,0,.30+height/2,.09,depth+.04,height,'wood')
            for row in range(5):
                z=.34+row*(height-.12)/4
                # Recess shelf edges so posts/back never share their surface plane.
                place('_shelf',0,0,z,width-.20,depth-.09,.07,'wood_light')
                if row==4:continue
                count=max(3,int(width/.18)) if fill=='books' else max(2,int(width/.40))
                for i in range(count):
                    dx=-width*.41+i*(width*.82/max(1,count-1))
                    if face in ('side','left'):xx,yy=x+(.025 if face=='left' else -.025),y+dx
                    else:xx,yy=x+dx,y-.025
                    if fill=='books':
                        h=.23+.09*((i+row*3)%4)/3
                        mat=('indigo','vermilion','sage','paper','wood_light')[(i+row)%5]
                        if face in ('side','left'):
                            b(n+'_book',(xx,yy,z+.04+h/2),(.27,.095,h),mat)
                            b(n+'_book_spine',(xx+(.141 if face=='left' else -.141),yy,z+.07),(.008,.075,.018),'paper')
                        else:
                            b(n+'_book',(xx,yy,z+.04+h/2),(.095,.27,h),mat)
                            b(n+'_book_spine',(xx,yy-.141,z+.07),(.075,.008,.018),'paper')
                    elif fill=='bottles':bottle(n+'_bottle',xx,yy,z+.04,('sage','ceramic','wood_dark')[i%3])
                    else:jar(n+'_jar',xx,yy,z+.04,r=.11,h=.25+.04*(i%3))
            dims=(depth,width,height) if face in ('side','left') else (width,depth,height)
            collider(n,(x,y,.30+height/2),dims)

        def bread(n,x,y,z,variant=0):
            if variant%3==0:
                ball(prefix+n,(x,y,z+.095),(.18,.12,.095),'sand',C,segments=10,rings=5)
                for dx in (-.06,.06):
                    beam(prefix+n+'_score',(x+dx,y-.06,z+.17),(x+dx+.035,y+.06,z+.17),.009,'wood_light',C,vertices=5)
            elif variant%3==1:
                ball(prefix+n,(x,y,z+.075),(.12,.12,.075),'paper',C,segments=8,rings=5)
                ball(prefix+n+'_filling',(x,y,z+.143),(.042,.042,.018),'blossom_dark',C,segments=8,rings=4)
            else:
                b(n,(x,y,z+.085),(.25,.14,.17),'sand',.04)
                b(n+'_icing',(x,y,z+.175),(.22,.12,.025),'paper',.012)

        def shoji(n,x,y,z,w,h,side=False,rear=False):
            def part(q,dx,dy,zz,ww,dd,hh,mat):
                if side:return b(n+q,(x+dy if rear else x-dy,y+dx,zz),(dd,ww,hh),mat)
                if rear:return b(n+q,(x+dx,y-dy,zz),(ww,dd,hh),mat)
                return b(n+q,(x+dx,y+dy,zz),(ww,dd,hh),mat)
            part('_paper',0,0,z,w,.025,h,'paper')
            for xx in (-w/2,w/2):part('_frame',xx,-.04,z,.065,.065,h+.06,'wood')
            for zz in (z-h/2,z+h/2):part('_frame',0,-.04,zz,w+.10,.065,.065,'wood')
            for i in range(1,7):part('_lattice',-w/2+i*w/7,-.045,z,.029,.04,h,'wood_dark')
            for j in range(1,4):part('_cross',0,-.045,z-h/2+j*h/4,w,.04,.025,'wood_dark')

        def modest_roof():
            upper=kind in ('bookshop','izakaya')
            width,depth,eave,rise=8.14,8.04,5.72 if upper else 4.03,.90 if upper else 1.12
            nx,ny=14,6
            def height(t):return eave+rise*(1-t)**1.60+.16*t**7
            vv=[];ff=[]
            for side in (-1,1):
                start=len(vv)
                for lower in (False,True):
                    for i in range(nx+1):
                        for j in range(ny+1):
                            t=j/ny
                            vv.append((-width/2+width*i/nx,side*depth/2*t,height(t)-(.12 if lower else 0)))
                layer=(nx+1)*(ny+1)
                for i in range(nx):
                    for j in range(ny):
                        a=start+i*(ny+1)+j;face=(a,a+ny+1,a+ny+2,a+1)
                        ff.append(face if side==1 else tuple(reversed(face)))
                        ff.append(tuple(q+layer for q in reversed(face)) if side==1 else tuple(q+layer for q in face))
                edge=[start+i*(ny+1) for i in range(nx+1)]+[start+nx*(ny+1)+j for j in range(1,ny+1)]+[start+i*(ny+1)+ny for i in range(nx-1,-1,-1)]+[start+j for j in range(ny-1,0,-1)]
                for a,b2 in zip(edge,edge[1:]+edge[:1]):ff.append((a,b2,b2+layer,a+layer))
            M(prefix+'curved_main_roof',vv,ff,'roof',C)
            for side in (-1,1):
                verts=[];faces=[]
                for i in range(19):
                    x=-width/2+width*i/18;start=len(verts)
                    for j in range(ny+1):
                        t=j/ny
                        for dx,dz in ((-.04,0),(0,.05),(.04,0)):
                            verts.append((x+dx,side*depth/2*t,height(t)+.027+dz))
                    for j in range(ny):
                        a=start+j*3
                        faces.extend([(a,a+3,a+4,a+1),(a+1,a+4,a+5,a+2),(a+2,a+5,a+3,a)])
                    faces.extend([(start,start+1,start+2),(start+ny*3+2,start+ny*3+1,start+ny*3)])
                M(prefix+'roof_tile_ribs_'+str(side),verts,faces,'roof_edge',C)
                for j in (2,4):
                    t=j/6
                    beam(prefix+'roof_course',(-width/2,side*depth/2*t,height(t)+.03),
                         (width/2,side*depth/2*t,height(t)+.03),.018,'roof_edge',C,vertices=6)
                b('roof_eave',(0,side*depth/2,eave+.015),(width+.10,.15,.15),'wood_dark')
            beam(prefix+'roof_ridge',(-4.14,0,eave+rise+.08),(4.14,0,eave+rise+.08),.11,'roof_edge',C,vertices=10)
            for xx in (-3.59,3.59):
                M(prefix+'gable',[(xx,-3.5,eave-.29),(xx,3.5,eave-.29),(xx,0,eave+rise-.13)],
                  [(0,1,2) if xx>0 else (2,1,0)],'plaster',C)
                beam(prefix+'gable_kingpost',(xx,0,eave-.30),(xx,0,eave+rise-.13),.07,'wood',C,vertices=8)

        def sign_text():
            # Blender's built-in font is converted to mesh: no runtime font dependency.
            curve=bpy.data.curves.new(prefix+'sign_curve','FONT')
            curve.body=title.upper();curve.align_x='CENTER';curve.align_y='CENTER'
            curve.size=.245 if len(title)>15 else .28
            curve.extrude=.002;curve.resolution_u=2;curve.space_character=1.1
            temp=bpy.data.objects.new(prefix+'sign_text',curve);C.objects.link(temp)
            temp.location=(0,-3.827,3.58);temp.rotation_euler=(math.pi/2,0,0)
            curve.materials.append(bpy.data.materials['MAT_paper'])
            bpy.context.view_layer.update()
            dg=bpy.context.evaluated_depsgraph_get()
            data=bpy.data.meshes.new_from_object(temp.evaluated_get(dg),depsgraph=dg)
            obj=bpy.data.objects.new('SM_'+prefix+'sign_letters',data);C.objects.link(obj)
            obj.matrix_world=temp.matrix_world.copy()
            bpy.data.objects.remove(temp,do_unlink=True)
            if curve.users==0:bpy.data.curves.remove(curve)

        # Actual open architectural shell, with a flush, supported entrance.
        # Keep the authoritative floor at .300; visible support sits below boards.
        b('floor',(0,0,.210),(7.2,7.0,.16),'wood_dark')
        collider('floor',(0,0,.215),(7.2,7.0,.17))
        for i in range(24):
            b('floor_board',(-3.55+(i+.5)*7.1/24,0,.286),(7.1/24-.012,6.82,.028),
              'wood_light' if i%7==0 else 'wood')
        solid('wall_left',(-3.52,0,2.00),(.16,7.0,3.40),'plaster_warm')
        solid('wall_right',(3.52,0,2.00),(.16,7.0,3.40),'plaster_warm')
        solid('wall_back',(0,3.42,2.00),(7.04,.16,3.40),'plaster')
        # Lintel underside is z=2.92: 2.62 m above the floor.
        for xx in (-2.28,2.28):
            solid('front_wall',(xx,-3.42,2.00),(2.48,.16,3.40),'plaster')
        solid('entry_lintel',(0,-3.42,3.31),(2.12,.16,.78),'wood_dark')
        for xx in (-1.025,1.025):
            solid('entry_jamb',(xx,-3.49,1.61),(.15,.24,2.62),'wood')
        solid('ceiling',(0,0,3.775),(7.14,6.86,.15),'plaster')
        solid('entry_threshold',(0,-3.57,.27),(1.90,.36,.06),'wood_light')
        solid('entry_paving',(0,-4.23,.268),(2.50,1.16,.056),'stone_light')
        # Timber frames are visible from the street and inside.
        for xx in (-3.50,3.50):
            for yy in (-3.46,0,3.40):
                b('corner_post',(xx,yy,2.03),(.25,.25,3.46),'wood_dark')
        for yy in (-3.47,3.39):
            for zz in (.47,3.50):
                if yy<0 and zz<1:
                    for xx in (-2.30,2.30):b('front_low_tie',(xx,yy,zz),(2.48,.20,.15),'wood_dark')
                else:b('long_tie',(0,yy,zz),(7.2,.20,.15),'wood_dark')
        for xx in (-3.42,3.42):
            for zz in (.47,3.50):b('side_tie',(xx,0,zz),(.15,7.0,.15),'wood_dark')
        for xx in (-2.72,-1.37,1.37,2.72):
            b('ceiling_beam',(xx,0,3.62),(.12,6.84,.17),'wood')
        for xx in (-2.26,2.26):
            shoji('front_window',xx,-3.517,1.84,1.35,1.65)
            shoji('inside_window',xx,-3.325,1.84,1.35,1.65,rear=True)
            # Open sliding door leaves parked against the facade.
            b('parked_slider',(xx,-3.64,1.53),(1.15,.09,2.42),'wood_dark')
            shoji('parked_shoji',xx,-3.697,1.70,1.00,1.79)
        for yy in (-1.65,1.65):
            # Paper windows sit on the interior faces of both side walls.
            shoji('left_inner_shoji',-3.423,yy,2.05,1.7,1.52,side=True)
            shoji('right_outer_shoji',3.61,yy,2.05,1.7,1.52,side=True)
            shoji('right_inner_shoji',3.423,yy,2.05,1.7,1.52,side=True,rear=True)
            shoji('left_outer_shoji',-3.61,yy,2.05,1.7,1.52,side=True,rear=True)
        b('entry_sign',(0,-3.735,3.58),(3.98,.16,.49),accent,.035)
        sign_text()
        # Shallow cloth valance stays above the required doorway head clearance.
        b('noren_rod',(0,-3.87,3.29),(2.06,.045,.045),'wood_dark')
        for i in range(4):
            x=-.96+i*.49
            verts=[(x,-3.865,3.28),(x+.44,-3.865,3.28),(x+.44,-3.90,2.97),(x,-3.88,2.97)]
            M(prefix+'noren',verts,[(3,2,1,0)],accent,C)
        if kind in ('bookshop','izakaya'):
            # Decorative residential upper storey, sealed above the accessible room.
            # No staircase or upper-floor gameplay markers are supplied.
            b('upper_residential_volume',(0,0,4.745),(7.00,6.86,1.83),'plaster')
            for yy in (-3.46,3.46):
                for zz in (3.88,5.59):b('upper_timber_tie',(0,yy,zz),(7.20,.16,.15),'wood_dark')
                for xx in (-3.48,-1.75,0,1.75,3.48):b('upper_post',(xx,yy,4.73),(.14,.17,1.87),'wood')
            for xx in (-2.25,0,2.25):
                shoji('upper_front_window',xx,-3.527,4.81,1.70,1.13)
                shoji('upper_rear_window',xx,3.527,4.81,1.70,1.13,rear=True)
            for yy in (-1.70,1.70):
                shoji('upper_side_window',3.59,yy,4.81,1.76,1.14,side=True)
                shoji('upper_side_window',-3.59,yy,4.81,1.76,1.14,side=True,rear=True)
            b('upper_balcony_deck',(0,-3.82,3.96),(6.80,.67,.12),'wood_dark')
            for zz in (4.10,4.52):b('upper_balcony_rail',(0,-4.17,zz),(6.74,.07,.08),'wood')
            for i in range(29):b('upper_balcony_spindle',(-3.29+i*6.58/28,-4.17,4.31),(.041,.065,.43),'wood_dark')
        else:
            for yy in (-3.42,3.42):b('attic_frieze',(0,yy,3.935),(7.03,.16,.47),'plaster')
        modest_roof()

        # Hanging paper shades and practical interior lighting.
        for i,(lx,ly) in enumerate(((-1.65,-.70),(1.0,1.40))):
            beam(prefix+'lantern_drop',(lx,ly,3.60),(lx,ly,3.11),.018,'wood_dark',C,vertices=6)
            ball(prefix+'paper_lantern',(lx,ly,2.94),(.24,.24,.29),'lantern',C,segments=12,rings=7)
            for zz in (2.66,3.22):cyl(prefix+'lantern_cap',(lx,ly,zz),.11,.04,'wood',C,vertices=10)
            data=bpy.data.lights.new('LGT_'+prefix+'interior_light_'+str(i),'POINT')
            data.energy=105;data.color=(1.0,.77,.48);data.shadow_soft_size=.75
            ob=bpy.data.objects.new(prefix+'interior_light_'+str(i),data);LC.objects.link(ob)
            ob.location=(lx,ly,3.15);ob['venue_id']=vid;ob['runtime_light']=True;ob['three_intensity']=18.0
        for xx in (-2.97,2.97):
            ball(prefix+'entry_lantern',(xx,-3.92,2.43),(.18,.18,.27),'lantern',C,segments=10,rings=6)
            beam(prefix+'entry_lantern_hanger',(xx,-3.92,2.68),(xx,-3.92,2.99),.02,'wood_dark',C,vertices=6)

        # Furnishings stay outside |x|<1.10 through the front/middle of every room.
        if kind=='cafe':
            z=counter('espresso_bar',-2.57,.86,1.04,3.70)
            b('espresso_machine',(-2.54,1.67,z+.26),(.67,.62,.50),'stone_dark',.06)
            b('espresso_machine_front',(-2.195,1.67,z+.26),(.022,.50,.29),'brass')
            for yy in (1.54,1.82):cup('espresso_cup',-2.15,yy,z+.02,'paper')
            jar('coffee_bean_jar',-2.55,-.4,z,.15,.45,'wood_dark')
            counter('pastry_case',-2.46,-2.32,1.42,.70,.81)
            for i in range(3):bread('cafe_pastry',-2.92+i*.43,-2.32,1.22,i)
            for j,yy in enumerate((-1.85,.25)):
                top=table('cafe_table_'+str(j),2.18,yy,1.32,.77)
                stool('cafe_stool_a',2.18,yy-.67)
                stool('cafe_stool_b',2.18,yy+.67)
                tea_set('cafe_service',2.18,yy,top)
            shelf('coffee_storage',-2.42,3.02,1.77,.38,2.14)

        elif kind=='ramen':
            z=counter('ramen_counter',-2.55,.03,1.03,4.64,.99)
            for yy in (-1.72,-.40,.92):
                stool('counter_stool',-1.49,yy,height=.66,mat=accent)
                bowl('ramen_bowl',-2.10,yy,z,True)
            counter('kitchen_range',-2.18,2.84,2.05,.72,.83,'stone_dark')
            for xx in (-2.65,-1.76):
                cyl(prefix+'stock_pot',(xx,2.84,1.46),.25,.37,'stone',C,vertices=12)
                cyl(prefix+'pot_lid',(xx,2.84,1.66),.265,.035,'wood_dark',C,vertices=12)
            top=table('ramen_table',2.21,-1.30,1.48,1.38)
            stool('ramen_diner_a',2.21,-2.31)
            stool('ramen_diner_b',2.21,-.29)
            bowl('dining_ramen_a',2.01,-1.30,top,True)
            bowl('dining_ramen_b',2.48,-1.30,top,True)
            shelf('ramen_bowls',1.78,3.07,2.5,.34,2.20)

        elif kind=='bookshop':
            shelf('left_library',-3.11,.45,5.23,.50,2.80,fill='books',face='left')
            shelf('back_library',.45,3.07,5.2,.40,2.77,fill='books')
            z=counter('bookseller_desk',-2.23,-2.47,1.64,.66,.78)
            for i in range(4):b('desk_book',(-2.42,-2.48,z+.024+i*.055),(.53,.36,.048),('indigo','sage')[i%2])
            top=table('book_display',2.32,-1.35,1.50,1.50,.69)
            for xx in (1.98,2.65):
                for yy in (-1.69,-1.06):
                    for j in range(3):b('book_stack',(xx,yy,top+.025+j*.056),(.51,.34,.05),('indigo','paper','vermilion')[j])
            top=table('reading_desk',-2.11,1.73,1.54,.72,.73)
            stool('reading_stool',-1.97,.95)
            b('open_book_left',(-2.35,1.73,top+.015),(.31,.40,.025),'paper')
            b('open_book_right',(-2.02,1.73,top+.015),(.31,.40,.025),'paper')

        elif kind=='bakery':
            z=counter('bread_counter',-2.42,-.27,1.35,4.10,.80)
            for yy in (-1.59,-.40,.80):
                b('bread_tray',(-2.42,yy,z+.035),(1.15,.78,.05),'wood_dark',.015)
                for i in range(3):bread('counter_bread',-2.77+i*.35,yy,z+.07,i)
            # Open second display level: visible bread, no opaque glass proxy.
            b('upper_bread_shelf',(-2.42,-.25,1.91),(1.26,3.96,.075),'wood_light')
            for yy in (-1.61,1.11):
                for xx in (-2.94,-1.91):b('display_upright',(xx,yy,1.52),(.055,.055,.8),'wood')
            for i in range(5):bread('upper_loaf',-2.43,-1.62+i*.66,1.955,i)
            solid('baking_oven',(-2.13,2.78,1.30),(2.14,.84,2.0),'stone',.045)
            b('oven_mouth',(-2.13,2.344,1.17),(1.45,.026,.68),'wood_dark',.09)
            b('oven_warmth',(-2.13,2.323,1.06),(1.0,.015,.25),'lantern')
            top=table('pastry_table',2.30,-1.47,1.53,1.63,.73)
            for xx in (1.88,2.64):
                for yy in (-1.88,-1.13):bread('pastry_table_cake',xx,yy,top,2)
            shelf('bakery_jars',1.63,3.06,2.72,.38,2.30)

        elif kind=='izakaya':
            z=counter('izakaya_bar',-2.57,.05,1.02,4.60,1.02)
            for yy in (-1.65,-.32,1.02):
                stool('bar_stool',-1.49,yy,height=.65,mat=accent)
                cup('sake_cup',-2.08,yy,z)
                bottle('bar_bottle',-2.73,yy+.3,z)
            shelf('sake_wall',-.10,3.07,5.75,.40,2.64,fill='bottles')
            top=table('izakaya_dining',2.26,-1.42,1.54,1.31,.72)
            bench('izakaya_bench_a',2.26,-2.41,1.58)
            bench('izakaya_bench_b',2.26,-.43,1.58)
            for xx in (1.89,2.63):
                bowl('small_plate',xx,-1.42,top,True)
                cup('diner_cup',xx,-1.12,top)

        elif kind=='tea':
            solid('tatami_platform',(-2.31,-.13,.37),(2.10,5.24,.14),'wood_dark')
            for yy in (-1.44,1.18):
                b('tatami_mat',(-2.31,yy,.455),(2.02,2.55,.025),'sage')
                for xx in (-3.29,-1.33):b('tatami_border',(xx,yy,.473),(.07,2.55,.012),'indigo')
                top=table('tea_low_table',-2.28,yy,1.48,.66,.29)
                for yoff in (-.79,.79):
                    solid('tea_floor_cushion',(-2.28,yy+yoff,.52),(.74,.62,.12),'indigo',.055)
                tea_set('formal_tea_service',-2.28,yy,top)
            shelf('tea_ceramic_display',2.94,-1.38,2.30,.61,2.48,face='side')
            z=counter('tea_preparation',-.61,2.96,3.75,.62,.79)
            for i in range(5):jar('tea_tin',-2.04+i*.62,2.96,z,.13,.34,('ceramic','sage')[i%2])
            b('hanging_scroll',(2.1,3.31,2.18),(1.15,.022,1.68),'paper')
            for zz in (1.31,3.04):b('scroll_rod',(2.1,3.28,zz),(1.25,.045,.045),'wood_dark')
            beam(prefix+'scroll_branch',(1.95,3.275,1.65),(2.18,3.275,2.63),.025,'wood_dark',C,vertices=6)
            for x,z in ((1.89,2.13),(2.18,2.45),(2.27,2.75)):
                ball(prefix+'scroll_flower',(x,3.265,z),(.075,.012,.07),'blossom_dark',C,segments=8,rings=4)

        elif kind=='grocer':
            shelf('provisions_shelf',-3.05,.35,5.12,.57,2.57,fill='jars',face='left')
            z=counter('fruit_stall',2.28,-1.55,1.70,1.84,.64)
            for ix in range(2):
                for iy in range(2):
                    xx=1.85+ix*.84;yy=-2.04+iy*.86
                    b('produce_bin',(xx,yy,z+.12),(.75,.75,.24),'wood_light')
                    for j in range(5):
                        a=j*2.4
                        ball(prefix+'fresh_produce',(xx+.19*math.cos(a),yy+.19*math.sin(a),z+.28+.04*(j%2)),
                             (.11,.095,.105),('vermilion','grass','sand','sage')[ix+iy*2],C,segments=8,rings=5)
            z=counter('provisions_rear',-.69,2.94,3.86,.65,.86)
            for i in range(5):jar('rice_storage',-2.17+i*.69,2.94,z,.18,.51,('paper','ceramic')[i%2])
            solid('rice_crate',(-2.33,-2.44,.68),(1.07,.89,.76),'wood_light',.018)
            for xx in (-2.62,-2.04):jar('rice_sack',xx,-2.44,1.06,.21,.46,'sand')

        elif kind=='restaurant':
            for j,yy in enumerate((-1.78,.62)):
                top=table('restaurant_table_'+str(j),-2.23,yy,1.64,1.08,.75)
                stool('restaurant_chair_a',-2.23,yy-.84,height=.47,mat=accent)
                stool('restaurant_chair_b',-2.23,yy+.84,height=.47,mat=accent)
                tea_set('restaurant_table_service',-2.23,yy,top)
            top=table('window_dining',2.23,-1.58,1.58,1.32,.75)
            bench('window_bench_a',2.23,-2.57,1.67)
            bench('window_bench_b',2.23,-.59,1.67)
            tea_set('window_table_service',2.23,-1.58,top)
            z=counter('restaurant_kitchen',-1.10,2.99,3.65,.65,.94,'stone_dark')
            for xx in (-2.41,-1.38,-.35):bowl('kitchen_preparation',xx,2.99,z,True)
            b('kitchen_screen',(0.79,2.97,1.36),(.10,.78,2.12),'wood')

        # Markers and geometry share the same final transform; no parenting magic.
        for marker_kind,point in LOCAL_MARKERS.items():
            ob=bpy.data.objects.new('MARK_'+marker_kind+'_'+vid,None);GC.objects.link(ob)
            ob.location=point;ob.empty_display_type='ARROWS';ob.empty_display_size=.36
            ob['kind']='npc' if marker_kind=='npc' else ('venue_entry' if marker_kind=='entry' else 'waypoint')
            ob['venue_id']=vid;ob['is_enterable']=True;ob['interaction_radius']=2.8
            ob['display_name']=title
            if marker_kind=='npc':ob['npc_id']=vid+'_host'
        bpy.context.view_layer.update()
        transform=Matrix.Translation((cx,cy,0)) @ Matrix.Rotation(angle,4,'Z')
        created=[ob for ob in bpy.data.objects if ob not in before]
        for ob in created:
            ob.matrix_world=transform @ ob.matrix_world
            if 'venue_id' not in ob:ob['venue_id']=vid
        bpy.context.view_layer.update()
        triangles=0
        for ob in C.objects:
            if ob.type=='MESH':
                ob.data.calc_loop_triangles();triangles+=len(ob.data.loop_triangles)
        runtime_stats.append({'id':vid,'render_triangles':triangles,'render_objects':len(C.objects),'colliders':len(local_colliders)})
        next(v for v in manifest['venues'] if v['id']==vid)['collision_boxes_local']=local_colliders

    manifest['build_stats']=runtime_stats
    manifest['new_venue_render_triangles']=sum(v['render_triangles'] for v in runtime_stats)
    assert manifest['new_venue_render_triangles']<=220000, 'New venue geometry exceeds the requested 220k budget.'
    return manifest


if __name__=='__main__':
    output=Path(__file__).resolve().parents[1]/'venues.json'
    output.write_text(json.dumps(make_manifest(),indent=2)+'\n')
    print(output)
