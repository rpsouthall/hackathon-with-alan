"""One-time, render-only migration of original Kyoto_City saved source.
Run against an isolated copy. Does not modify colliders, markers, or lights.
"""
import bpy, json, sys, re
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
s=bpy.data.scenes['Kyoto_City'];bpy.context.window.scene=s
assert not s.get('venue_depth_fix_v1'), 'Depth migration already applied'
objects=[ob for ob in s.objects if ob.type=='MESH' and any(c.name.startswith('COL_Venue_') for c in ob.users_collection)]
changed=[]
def reshape(ob, factors, offset=(0,0,0)):
 ob.data=ob.data.copy()
 for v in ob.data.vertices:
  for ax in range(3):v.co[ax]=v.co[ax]*factors[ax]+offset[ax]
 ob.data.update();changed.append(ob.name)
for ob in objects:
 if re.search(r'_corner_post(?:\.\d+)?$',ob.name):reshape(ob,(1.25,1.25,1))
 elif re.search(r'^SM_[a-z_]+_floor$',ob.name):reshape(ob,(1,1,.16/.17),(0,0,-.005))
# Each cabinet built by shelf() has _back + _post + _shelf components.
for back in objects:
 if not back.name.endswith('_back'):continue
 prefix=back.name[:-5]
 shelves=[ob for ob in objects if re.fullmatch(re.escape(prefix)+r'_shelf(?:\.\d+)?',ob.name)]
 posts=[ob for ob in objects if re.fullmatch(re.escape(prefix)+r'_post(?:\.\d+)?',ob.name)]
 if not shelves or not posts:continue
 bounds=[max(v.co[i] for v in back.data.vertices)-min(v.co[i] for v in back.data.vertices) for i in range(3)]
 depthAxis=0 if bounds[0]<bounds[1] else 1;widthAxis=1-depthAxis
 for ob in posts:
  dims=[max(v.co[i] for v in ob.data.vertices)-min(v.co[i] for v in ob.data.vertices) for i in range(3)]
  factors=[1,1,1];factors[depthAxis]=(dims[depthAxis]+.04)/dims[depthAxis]
  reshape(ob,factors)
 for ob in shelves:
  dims=[max(v.co[i] for v in ob.data.vertices)-min(v.co[i] for v in ob.data.vertices) for i in range(3)]
  factors=[1,1,1];factors[widthAxis]=(dims[widthAxis]-.20)/dims[widthAxis];factors[depthAxis]=(dims[depthAxis]-.09)/dims[depthAxis]
  reshape(ob,factors)
# Validate without changing authoring topology or collision geometry.
assert len([n for n in changed if '_corner_post' in n])==48
assert len([n for n in changed if n.endswith('_floor')])==8
assert all(all(abs(a-1)<1e-5 for a in ob.scale) for ob in objects)
triangles=0
for ob in s.objects:
 if ob.type=='MESH' and not ob.hide_render:
  ob.data.calc_loop_triangles();triangles+=len(ob.data.loop_triangles)
assert triangles<650000,triangles
s['venue_depth_fix_v1']=True
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'kyoto_city.blend'))
(ROOT/'depth_fix_report.json').write_text(json.dumps({'changed_objects':changed,'render_triangles':triangles,'collision_or_marker_changes':False,'texture_changes':False},indent=2))
sys.path.insert(0,str(ROOT/'scripts'))
import export_city
export_city.clear_generated_export_scenes()
export_city.make_export_scene(False)
export_city.make_export_scene(True)
print('DEPTH_FIX_COMPLETE',len(changed),triangles,flush=True)
