"""City expansion around the original Komorebi Riverside district.

Run build_city_ground(K) on the backed-up editable source scene. This preserves
all original architecture, trees, bridge, garden pockets and authored details.
It replaces only the old base/edge infrastructure, then adds the extended city
street network, north bridge, south market and peripheral gardens.
"""
import math
import random


def build_city_ground(K):
    import bpy
    from mathutils import Vector, Matrix
    scene = bpy.context.scene
    if scene.get('city_ground_built', False):
        return {'already_built': True}
    rng = random.Random(190923)
    box, mesh = K['box'], K['mesh']
    beam, cylinder, ico, uvball = K['beam'], K['cylinder'], K['ico'], K['uvball']
    ground = K['collection']('COL_City_Ground')
    streets = K['collection']('COL_City_Street')
    gardens = K['collection']('COL_City_Gardens')
    market = K['collection']('COL_City_Market')
    collision = K['collection']('COL_Collision')
    existing_ids = {ob.as_pointer() for ob in scene.objects}
    removed = {}

    # These boundaries previously ended at x=+-19 / y=-14,16 and would block the
    # larger city. All original buildings, tree colliders and bridge remain.
    prefixes = ('SM_District_Foundation', 'SM_Land_Bank', 'SM_Paving_Bank',
                'SM_Canal_Bed', 'SM_Canal_Water', 'SM_Water_WaveSurface',
                'SM_Quay_Masonry', 'SM_Quay_Coping', 'SM_Promenade_Slab',
                'SM_Garden_Edge', 'SM_Boundary_Azalea',
                'SM_Canal_FenceRail', 'SM_Canal_FencePost',
                'SM_COL_OuterBoundary', 'SM_COL_CanalEdge',
                'SM_COL_WestGround', 'SM_COL_EastGround')
    scene_cols = set()
    def gather(col):
        scene_cols.add(col)
        for child in col.children:
            gather(child)
    gather(scene.collection)
    for ob in list(scene.objects):
        prefix = next((p for p in prefixes if ob.name.startswith(p)), None)
        if prefix:
            removed[prefix] = removed.get(prefix, 0) + 1
            for col in list(ob.users_collection):
                if col in scene_cols:
                    col.objects.unlink(ob)
            if ob.users == 0:
                bpy.data.objects.remove(ob)

    def col(name, loc, dims):
        # K.box bakes dimensions into the closed mesh, avoiding scaled box proxies.
        ob = box('SM_COL_City_' + name, loc, dims, None, collision)
        ob.hide_render = True
        ob.display_type = 'WIRE'
        ob['collider'] = 'box'
        ob['city_collision'] = True
        return ob

    # The 68x54 m plinth is approximately three times the original 38x32 m area.
    box('SM_City_Foundation', (0, 1, -1.25), (68, 54, 1.2), 'stone_dark', ground, .22)
    for side in (-1, 1):
        x = side * 18.35
        box('SM_City_LandBank', (x, 1, -.29), (31.3, 54, .98), 'soil', ground)
        box('SM_City_GrassTop', (x, 1, .19), (31.3, 54, .12), 'grass', ground)
        col('Ground_' + str(side), (x, 1, -.25), (31.3, 54, 1.0))
    # Short land caps close the canal beyond the authored water limits.
    for y in (-25.5, 27.5):
        box('SM_City_CanalEndGround', (0, y, -.25), (5.4, 1, 1), 'stone', ground)
        col('CanalEndGround', (0, y, -.25), (5.4, 1, 1))
    box('SM_City_CanalBed', (0, 1, -.68), (5.4, 52, .25), 'stone_dark', ground)
    box('SM_City_CanalWaterBase', (0, 1, -.19), (5.38, 52, .045), 'water', ground)

    verts, faces = [], []
    nx, ny = 14, 150
    for j in range(ny + 1):
        y = -25 + 52 * j / ny
        for i in range(nx + 1):
            x = -2.66 + 5.32 * i / nx
            z = -.148 + .012 * math.sin(y * 2.2 + x * 2.8) + .008 * math.cos(y * 4 - x * 1.8)
            verts.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    ob = mesh('SM_City_WaterWaveSurface', verts, faces, 'water', ground)
    for p in ob.data.polygons:
        p.use_smooth = True
    for i in range(35):
        y = rng.choice((-1, 1))
        y = rng.uniform(-24.5, -14.2) if y < 0 else rng.uniform(16.2, 26.6)
        box('SM_City_WaterGlint', (rng.uniform(-2.15, 2.15), y, -.158),
            (rng.uniform(.20, .8), .016, .004), 'water_light', ground)

    def closed_box_to(vertices, faces, loc, dims):
        x, y, z = loc
        a, b, c = [d / 2 for d in dims]
        start = len(vertices)
        vertices.extend([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),
                         (x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)])
        faces.extend(tuple(start + i for i in f) for f in
                     ((0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)))

    # Batched closed masonry keeps the richly jointed quay affordable to render.
    masonry_v, masonry_f = [[], []], [[], []]
    for side in (-1, 1):
        for row in range(3):
            step = 1.10
            for j in range(48):
                y = -24.44 + j * step + (row % 2) * .34
                if y > 26.45:
                    continue
                variant = 1 if (row + j) % 6 == 0 else 0
                closed_box_to(masonry_v[variant], masonry_f[variant],
                              (side * 2.9, y, -.66 + row * .31),
                              (.55, rng.uniform(1.025, 1.067), .285))
        for j in range(55):
            y = -24.5 + j * .95
            box('SM_City_QuayCoping', (side * 2.98, y, .20), (.67, .91, .25),
                'stone_light', ground, .025)
    for i, mat in enumerate(('stone', 'stone_light')):
        mesh('SM_City_QuayMasonry_' + str(i), masonry_v[i], masonry_f[i], mat, ground)

    # Closed thin paving pieces in a few material batches, with broad paved routes.
    road_v, road_f = [[], [], []], [[], [], []]
    route_rects = []
    def paving_rect(name, x1, x2, y1, y2, tile=.83):
        route_rects.append({'name': name, 'bounds': [x1, x2, y1, y2]})
    for side in (-1, 1):
        cx = side * 4.45
        paving_rect('Canal promenade', cx - 1.08, cx + 1.08, -25.0, 27.0, .72)
        cx = side * 20
        paving_rect('Outer street', cx - 1.75, cx + 1.75, -24.6, 25.8)
    for yy in (-18.4, 18.2):
        for side in (-1, 1):
            a, b = (-31.0, -3.4) if side < 0 else (3.4, 31.0)
            paving_rect('Cross street', a, b, yy - 1.6, yy + 1.6)
    for side in (-1, 1):
        for yy in (-13.0, -2.0, 10.0):
            a, b = (-23.7, -20.0) if side < 0 else (20.0, 23.7)
            paving_rect('Venue entrance path', a, b, yy - .9, yy + .9, .74)
        # A compact arrival court in front of the north shop doors.
        cx = side * 13
        paving_rect('North venue court', cx - 2.2, cx + 2.2, 17.0, 20.0)
        paving_rect('South market plaza', side * 12 - 7.1, side * 12 + 7.1, -24.1, -20.0)
        # Original district can be reached at both ends without grass-only gaps.
        paving_rect('Central south garden connection', side * 12 - 1, side * 12 + 1, -18.4, -13.9)
    # Partition the union of route rectangles into one shared grid. This avoids
    # overlapping coplanar paving at intersections and keeps browser depth stable.
    rects = [r['bounds'] for r in route_rects]
    xx = sorted(set(round(v, 4) for r in rects for v in r[:2]) |
                set(round(-31 + i * 1.05, 4) for i in range(61)))
    yy = sorted(set(round(v, 4) for r in rects for v in r[2:]) |
                set(round(-25 + i * 1.05, 4) for i in range(51)))
    for j, (ya, yb) in enumerate(zip(yy, yy[1:])):
        for i, (xa, xb) in enumerate(zip(xx, xx[1:])):
            x, y = (xa + xb) / 2, (ya + yb) / 2
            if xb - xa <= .025 or yb - ya <= .025:
                continue
            if not any(a <= x <= b and c <= y <= d for a, b, c, d in rects):
                continue
            variant = (i + j * 3) % 13
            variant = 1 if variant == 0 else 2 if variant == 4 else 0
            closed_box_to(road_v[variant], road_f[variant], (x, y, .275),
                          (xb - xa - .020, yb - ya - .020, .045))
    for i, mat in enumerate(('paving', 'stone_light', 'sand')):
        mesh('SM_City_StreetPavers_' + str(i), road_v[i], road_f[i], mat, streets)

    # Fine flush edges articulate the avenues without creating obstacles.
    for side in (-1, 1):
        for xx in (side * 20 - 1.83, side * 20 + 1.83):
            box('SM_City_AvenueEdging', (xx, .6, .275), (.10, 49.9, .05), 'stone_light', streets)
        for yy in (-20.07, -16.73, 16.53, 19.87):
            box('SM_City_CrossStreetEdging', (side * 17.15, yy, .275), (27.1, .09, .05), 'stone_light', streets)

    # Continuous canal edge barriers with generous 4.5 m openings at BOTH bridges.
    segments = [(-25.0, -6.25), (-1.75, 15.95), (20.45, 27.0)]
    for side in (-1, 1):
        for section, (a, b) in enumerate(segments):
            x = side * 3.23
            for z in (.78, 1.17):
                beam('SM_City_CanalFenceRail', (x, a, z), (x, b, z), .045, 'wood_dark', streets, vertices=6)
            count = max(1, int(math.ceil((b - a) / 1.4)))
            for i in range(count + 1):
                y = a + (b - a) * i / count
                box('SM_City_CanalFencePost', (x, y, .77), (.11, .11, 1.07), 'wood', streets, .012)
            col('CanalBarrier_%s_%s' % (side, section), (side * 3.23, (a+b)/2, .91), (.18, b-a, 1.40))

    # North bridge: flat limestone deck, shallow stone arches, low approach rise.
    by = 18.2
    box('SM_City_NorthBridgeDeck', (0, by, .265), (8.4, 3.4, .31), 'stone_light', streets, .035)
    col('NorthBridgeWalkDeck', (0, by, .265), (8.4, 3.4, .31))
    for side in (-1, 1):
        x0, x1 = side * 4.2, side * 5.12
        # Closed wedge, high at the bridge and flush to the paving at the far end.
        v = [(x0,by-1.70,.24),(x1,by-1.70,.24),(x1,by+1.70,.24),(x0,by+1.70,.24),
             (x0,by-1.70,.42),(x1,by-1.70,.292),(x1,by+1.70,.292),(x0,by+1.70,.42)]
        f = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        if side < 0:
            f = [tuple(reversed(face)) for face in f]
        mesh('SM_City_NorthBridgeRamp', v, f, 'stone_light', streets)
        # Two fitted simple boxes approximate the shallow wedge at <=6.5cm rises.
        for j in range(2):
            top = .356 if j == 0 else .42
            cx = side * (4.89 if j == 0 else 4.43)
            col('NorthBridgeRampStep', (cx, by, (.25 + top) / 2), (.46, 3.4, top - .25))
        box('SM_City_NorthBridgePier', (side * 3.47, by, -.05), (.72, 3.8, .86), 'stone', streets, .035)
    for edge in (-1, 1):
        y = by + edge * 1.70
        vv, ff = [], []
        segments_n = 26
        for i in range(segments_n + 1):
            xx = -3.6 + 7.2 * i / segments_n
            zz = -.63 + .82 * math.sqrt(max(0, 1 - (xx / 3.6) ** 2))
            vv.extend([(xx,y-.10,zz),(xx,y+.10,zz),(xx,y+.10,zz+.18),(xx,y-.10,zz+.18)])
        for i in range(segments_n):
            a = i * 4
            ff.extend([(a,a+4,a+5,a+1),(a+1,a+5,a+6,a+2),
                       (a+2,a+6,a+7,a+3),(a+3,a+7,a+4,a)])
        ff.extend([(0,1,2,3), tuple(segments_n*4+i for i in (3,2,1,0))])
        mesh('SM_City_NorthBridgeArch', vv, ff, 'stone', streets)
        for j in range(12):
            x = -4.02 + j * 8.04 / 11
            box('SM_City_NorthBridgePost', (x, y, .82), (.17,.17,.84), 'stone_light', streets, .017)
            box('SM_City_NorthBridgePostCap', (x,y,1.27), (.25,.25,.10), 'stone', streets, .018)
        for z in (.70, 1.14):
            box('SM_City_NorthBridgeRail', (0,y,z), (8.42,.13,.13), 'stone_light', streets, .01)
        col('NorthBridgeSideRail', (0,y,.84), (8.42,.18,.90))

    # A low perimeter garden fence makes the outer collision boundary legible.
    for side in (-1, 1):
        x = side * 33.7
        box('SM_City_PerimeterCurb', (x,1,.42), (.24,53.6,.34), 'stone', ground, .025)
        col('OuterBoundaryX', (x,1,1.1), (.35,53.6,2.2))
        for z in (.80,1.15):
            beam('SM_City_PerimeterRail',(x,-25.7,z),(x,27.7,z),.038,'wood_dark',streets,vertices=6)
        for j in range(25):
            yy=-25.4+j*2.2
            box('SM_City_PerimeterPost',(x,yy,.83),(.09,.09,.88),'wood',streets)
    for yy in (-25.7,27.7):
        box('SM_City_PerimeterCurb',(0,yy,.42),(67.4,.24,.34),'stone',ground,.025)
        col('OuterBoundaryY',(0,yy,1.1),(67.4,.35,2.2))
        for z in (.80,1.15):
            beam('SM_City_PerimeterRail',(-33.7,yy,z),(33.7,yy,z),.038,'wood_dark',streets,vertices=6)
        for j in range(31):
            xx=-33+j*2.2
            box('SM_City_PerimeterPost',(xx,yy,.83),(.09,.09,.88),'wood',streets)

    def lantern_post(x, y, h=2.9):
        box('SM_City_LanternPole',(x,y,.25+h/2),(.11,.11,h),'wood_dark',streets,.012)
        box('SM_City_LanternArm',(x+.27,y,h+.13),(.68,.10,.10),'wood_dark',streets,.012)
        ob=uvball('SM_City_PaperLantern',(x+.51,y,h-.19),(.25,.25,.38),'paper',streets,segments=10,rings=6)
        cylinder('SM_City_LanternTop',(x+.51,y,h+.20),.15,.055,'wood_dark',streets,vertices=10)
        cylinder('SM_City_LanternBottom',(x+.51,y,h-.58),.15,.055,'wood_dark',streets,vertices=10)
        for j in (-2,-1,0,1,2):
            z=h-.19+j*.105
            rad=.25*math.sqrt(max(.05,1-(j*.105/.38)**2))
            # Small dark bands preserve the lantern shape at overview scale.
            cylinder('SM_City_LanternRib',(x+.51,y,z),rad+.005,.018,'wood_light',streets,vertices=10)
        col('LanternPole',(x,y,1.3),(.25,.25,2.1))

    def bench(x,y,orientation=0):
        # Yaw is supported by baking object world transforms into copied vertices.
        parts=[]
        parts.append(box('SM_City_BenchSeat',(x,y,.71),(1.65,.54,.13),'wood_light',streets,.02))
        parts.append(box('SM_City_BenchBack',(x,y+.25,1.06),(1.65,.11,.36),'wood',streets,.015))
        for dx in (-.60,.60):
            parts.append(box('SM_City_BenchLeg',(x+dx,y,.45),(.12,.42,.40),'wood_dark',streets))
        if orientation:
            rotation=Matrix.Rotation(orientation,4,'Z')
            for ob in parts:
                rel=rotation @ Vector((ob.location.x-x,ob.location.y-y,0))
                ob.location.x=x+rel.x
                ob.location.y=y+rel.y
                ob.rotation_euler.z+=orientation
        dims=(1.72,.63,1.03) if abs(math.sin(orientation))<.5 else (.63,1.72,1.03)
        col('Bench',(x,y,.78),dims)

    # Furniture is beside the circulation lanes, never on their centres.
    for side in (-1,1):
        for yy in (-21.0,-7.6,4.3,15.2,24.2):
            lantern_post(side*17.5,yy)
        for yy in (-7.7,4.0,15.1):
            bench(side*17.4,yy,math.pi/2 if side<0 else -math.pi/2)

    # South market: four open, recognisable food carts, with clear customer space.
    # Counter fronts face north toward the open market walk and cross street.
    stall_defs=[(-15.5,'Produce','sage'),(-8.7,'Tea','indigo'),
                (8.7,'Fish','indigo'),(15.5,'Dango','vermilion')]
    for index,(x,label,awning) in enumerate(stall_defs):
        y=-22.75
        box('SM_City_%s_CartBody'%label,(x,y,.72),(2.60,1.28,.77),'wood',market,.025)
        for dx in (-1.06,1.06):
            for dy in (-.58,.58):
                ob=cylinder('SM_City_CartWheel',(x+dx,y+dy,.53),.29,.12,'wood_dark',market,vertices=10)
                ob.rotation_euler.x=math.pi/2
                cylinder('SM_City_CartLeg',(x+dx,y+dy,.38),.055,.27,'wood_dark',market,vertices=8)
        box('SM_City_%s_Counter'%label,(x,y+.32,1.14),(2.95,1.31,.12),'wood_light',market,.025)
        for dx in (-1.31,1.31):
            for dy in (-.61,.61):
                box('SM_City_StallPost',(x+dx,y+dy,1.61),(.10,.10,2.68),'wood_dark',market,.01)
        # Curved solid canvas canopy, striped by material on actual exportable mesh.
        for stripe in range(7):
            xa=x-1.57+stripe*3.14/7;xb=xa+3.14/7-.01
            vv=[]
            for xx in (xa,xb):
                for k in range(7):
                    t=-1+k/3
                    vv.append((xx,y+t*1.0,2.98-.27*abs(t)**1.5))
            ff=[(k,k+1,k+8,k+7) for k in range(6)]
            mesh('SM_City_%s_Canvas'%label,vv,ff,awning if stripe%2==0 else 'paper',market)
        box('SM_City_CanopyFrontValance',(x,y+1.0,2.62),(3.16,.035,.22),awning,market)
        box('SM_City_StallSign',(x,y+1.025,2.48),(.75,.065,.35),'wood_dark',market,.018)
        for j in range(3):
            uvball('SM_City_StallLantern',(x-.92+j*.92,y+1.04,2.32),(.14,.14,.23),'paper',market,segments=8,rings=5)
        col('MarketCart_'+label,(x,y,.74),(2.72,1.38,.98))
        # Thin pole proxies leave all surrounding floor area navigable.
        for dx in (-1.31,1.31):
            for dy in (-.61,.61):
                col('MarketPole',(x+dx,y+dy,1.59),(.14,.14,2.68))
        if label=='Produce':
            for cx in (-.78,0,.78):
                box('SM_City_ProduceCrate',(x+cx,y+.22,1.31),(.66,.78,.23),'wood_light',market,.01)
                for j in range(7):
                    p=(x+cx+rng.uniform(-.20,.20),y+.22+rng.uniform(-.22,.22),1.48+rng.uniform(0,.09))
                    ico('SM_City_FreshProduce',p,(.115,.105,.105),'vermilion' if cx<0 else 'leaf_light',market,subdivisions=1)
        elif label=='Tea':
            for dx in (-.82,.82):
                cylinder('SM_City_TeaTin',(x+dx,y+.20,1.40),.16,.39,'ceramic',market,vertices=10)
                cylinder('SM_City_TeaTinLid',(x+dx,y+.20,1.61),.18,.045,'brass',market,vertices=10)
            uvball('SM_City_TeaKettle',(x,y+.14,1.43),(.30,.23,.25),'wood_dark',market,segments=12,rings=7)
            beam('SM_City_TeaSpout',(x+.20,y+.14,1.43),(x+.42,y+.14,1.58),.066,'wood_dark',market,vertices=8)
            for j in range(3):
                cylinder('SM_City_TeaCup',(x-.42+j*.42,y+.67,1.28),.105,.16,'ceramic',market,vertices=10)
        elif label=='Fish':
            box('SM_City_FishTray',(x,y+.25,1.27),(2.27,.76,.12),'wood_dark',market,.01)
            for j in range(5):
                fx=x-.9+j*.45
                uvball('SM_City_FreshFish',(fx,y+.22,1.39),(.12,.28,.065),'stone_light',market,segments=8,rings=5)
                mesh('SM_City_FishTail',[(fx,y-.03,1.39),(fx-.14,y-.20,1.39),(fx+.14,y-.20,1.39)],[(0,1,2)],'stone',market)
        else:
            box('SM_City_DangoTray',(x,y+.25,1.26),(2.25,.72,.11),'wood_dark',market,.01)
            for j in range(6):
                dx=-.83+j*.33
                beam('SM_City_DangoSkewer',(x+dx,y-.13,1.38),(x+dx,y+.68,1.38),.015,'wood_light',market,vertices=5)
                for k,mat in enumerate(('blossom_light','paper','leaf_light')):
                    uvball('SM_City_DangoSweet',(x+dx,y+.04+k*.20,1.38),(.105,.105,.095),mat,market,segments=8,rings=5)
        if 'marker' in K:
            K['marker']('City_Market_'+label,(x,y+1.85,.30),'npc_spawn',npc_id='market_'+label.lower(),facing='south')
    # Seating sits at the market outer ends; it does not block a stall or avenue.
    for side in (-1,1):
        bench(side*22.6,-23.0)
        cylinder('SM_City_MarketTable',(side*24.1,-23.0,.92),.48,.10,'wood_light',market,vertices=12)
        cylinder('SM_City_MarketTableStem',(side*24.1,-23.0,.60),.095,.60,'wood_dark',market,vertices=8)
        col('MarketTable',(side*24.1,-23.0,.63),(.96,.96,.78))

    # Reuse the authored cherry geometry as linked meshes, keeping the visual style
    # identical to the original district. Three copies add roughly 35k triangles.
    source_prefix='SM_Sakura_East_Garden'
    source_tree=[ob for ob in scene.objects if ob.type=='MESH' and ob.name.startswith(source_prefix)]
    cherry_locations=[(-30.1,23.1,.80),(30.0,23.0,.80),(13.3,-15.2,.79)]
    tree_copies=0
    for ti,(x,y,scale) in enumerate(cherry_locations):
        transform=Matrix.Translation((x,y,.25)) @ Matrix.Scale(scale,4) @ Matrix.Translation((-15.6,-7.0,-.25))
        new_trunk=None
        for src in source_tree:
            cp=src.copy();cp.data=src.data
            cp.name='SM_City_Sakura_%02d_'%ti+src.name.removeprefix(source_prefix+'_')
            gardens.objects.link(cp)
            cp.matrix_world=transform @ src.matrix_world
            if '_sculpted_trunk' in cp.name:
                new_trunk=cp
        if source_tree:
            tree_copies+=1
        if new_trunk:
            bb=[new_trunk.matrix_world @ Vector(v) for v in new_trunk.bound_box]
            lo=Vector(tuple(min(v[i] for v in bb) for i in range(3)))
            hi=Vector(tuple(max(v[i] for v in bb) for i in range(3)))
            col('SakuraTrunk',tuple((lo+hi)*.5),tuple(hi-lo))

    def garden_patch(x,y,sx,sy,index):
        vv=[(x,y,.283)];ff=[]
        for j in range(24):
            a=j*math.tau/24;r=rng.uniform(.89,1.04)
            vv.append((x+math.cos(a)*sx*r,y+math.sin(a)*sy*r,.279))
        ff=[(0,1+j,1+(j+1)%24) for j in range(24)]
        mesh('SM_City_GardenMoss_%d'%index,vv,ff,'moss',gardens)
        for j in range(8):
            a=j*math.tau/8
            ico('SM_City_GardenStone',(x+math.cos(a)*sx,y+math.sin(a)*sy,.33),
                (.20,.17,.13),'stone',gardens,subdivisions=1)
    pockets=[(-30.1,23.1,2.5,2.1),(30,23,2.5,2.1),(13.3,-15.2,2.3,1.2),
             (-31.6,-20.8,1.2,1.0),(31.6,-20.8,1.2,1.0),
             (-31.8,15.1,1.0,1.0),(31.8,15.1,1.0,1.0),(-31.7,3.8,1.25,1.2),(31.7,3.8,1.25,1.2)]
    for i,p in enumerate(pockets):garden_patch(*p,i)

    # Bamboo gardens occupy residual edge pockets outside venue entrances.
    for gi,(cx,cy) in enumerate(((-31.6,-20.8),(31.6,-20.8),(-31.8,15.1),(31.8,15.1))):
        for j in range(7):
            x=cx+rng.uniform(-.45,.45);y=cy+rng.uniform(-.50,.50);h=rng.uniform(2.4,3.8)
            beam('SM_City_Bamboo',(x,y,.25),(x+.10,y,h),.038,'sage',gardens,vertices=6)
            for k in range(1,7):
                z=.25+k*(h-.25)/7
                beam('SM_City_BambooNode',(x+.1*k/7,y,z-.015),(x+.1*k/7,y,z+.015),.05,'wood_light',gardens,vertices=6)
                if k>3:
                    for sign in (-1,1):
                        tip=(x+sign*.34,y+.10,z+.16)
                        beam('SM_City_BambooTwig',(x,y,z),tip,.01,'sage',gardens,vertices=5)
                        mesh('SM_City_BambooLeaf',[(tip[0]-.1,tip[1],tip[2]),(tip[0]+.22*sign,tip[1]+.06,tip[2]+.05),
                             (tip[0]+.40*sign,tip[1],tip[2]),(tip[0]+.2*sign,tip[1]-.06,tip[2]-.03)],[(0,1,2,3)],'leaf',gardens)
        col('BambooPatch',(cx,cy,1.4),(1.18,1.22,2.3))

    # Two small evergreen silhouettes balance the new cherry gardens.
    for gi,(x,y) in enumerate(((-31.7,3.8),(31.7,3.8))):
        base=Vector((x,y,.25));top=Vector((x+.22,y+.13,4.40))
        beam('SM_City_PineTrunk',tuple(base),tuple(top),.16,'wood',gardens,vertices=8)
        for j in range(5):
            a=j*2.35;z=1.70+j*.5;reach=1.0-j*.13
            p=Vector((x+math.cos(a)*reach,y+math.sin(a)*reach,z+.25))
            beam('SM_City_PineBranch',(x,y,z),tuple(p),.058,'wood',gardens,vertices=6)
            for k in range(4):
                phi=k*math.tau/4
                ob=ico('SM_City_PineNeedles',tuple(p+Vector((math.cos(phi)*.24,math.sin(phi)*.24,.05))),
                       (.61,.49,.23),'leaf' if k%2 else 'leaf_light',gardens,subdivisions=2)
                for poly in ob.data.polygons:poly.use_smooth=True
        col('PineTrunk',(x+.11,y+.065,1.45),(.48,.42,2.4))

    # Mark navigation intent as scene metadata for downstream collision checks.
    scene['city_ground_built']=True
    scene['city_plinth_size_m']=[68,54]
    scene['city_canal_bounds_y']=[-25,27]
    scene['city_routes']='Outer streets x=+-20; cross streets y=-18.4,18.2; canal promenades x=+-4.45.'
    scene.view_layers[0].update()
    new_objects=[ob for ob in scene.objects if ob.get('city_collision',False) or any(c in (ground,streets,gardens,market) for c in ob.users_collection)]
    render_new=[ob for ob in new_objects if ob.type=='MESH' and not ob.hide_render]
    tri_new=sum(sum(len(p.vertices)-2 for p in ob.data.polygons) for ob in render_new)
    return {'new_render_objects':len(render_new),'new_render_triangles':tri_new,
            'new_collision_boxes':sum(1 for ob in new_objects if ob.get('city_collision',False)),
            'cherry_copies':tree_copies,'market_stalls':4,'bridge_deck_top':.42,
            'max_bridge_approach_step':.106,'removed_by_prefix':removed,
            'routes':route_rects,'bounds':[-34,34,-26,28]}
