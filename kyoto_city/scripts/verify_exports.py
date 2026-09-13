"""Run the read-only structural GLB checks after Blender export."""
import json
from pathlib import Path
from export_verify import verify_glb_file

root = Path(__file__).resolve().parents[1]
failed = False
for filename in ("kyoto_city.glb", "kyoto_city_lod1.glb"):
    report = verify_glb_file(root / "exports" / filename)
    (root / ("qa_" + Path(filename).stem + ".json")).write_text(json.dumps(report, indent=2))
    print(filename, report.get("verdict"), report.get("triangles_active_scene_with_instances"))
    failed |= report.get("verdict") not in ("PASS", "PASS WITH NOTES", "SHIP", "SHIP WITH NOTES")
raise SystemExit(1 if failed else 0)
