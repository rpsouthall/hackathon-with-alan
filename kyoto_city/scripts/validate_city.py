"""Read-only Blender scene audit for the Kyoto environment.

Run inside Blender (for example through MCP):
    exec(compile(open(path).read(), path, 'exec'))
    report = validate_scene()

This module neither mutates the scene nor writes a report. The caller may serialize
the returned dictionary with json.dumps(..., allow_nan=False).
"""

import math
from collections import Counter

import bpy


EXCLUDED_COLLECTIONS = {
    "COL_Collision", "COL_Presentation", "COL_ScaleReference", "COL_LODs"
}
TRIANGLE_BUDGET = 650_000
AREA_EPSILON = 1.0e-12


def _finite(values):
    return all(math.isfinite(float(v)) for v in values)


def _clean(value):
    """Return JSON-safe metadata, including non-finite custom property values."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if hasattr(value, "to_dict"):
        return {str(k): _clean(v) for k, v in value.to_dict().items()}
    if hasattr(value, "to_list"):
        return [_clean(v) for v in value.to_list()]
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [_clean(v) for v in value]
    return str(value)


def _collection_excluded(collection, inherited=False):
    """Include descendants of explicitly excluded collections."""
    excluded = inherited or collection.name in EXCLUDED_COLLECTIONS
    result = {collection.name} if excluded else set()
    for child in collection.children:
        result.update(_collection_excluded(child, excluded))
    return result


def _mesh_stats(mesh, matrix):
    mesh.calc_loop_triangles()
    points = [matrix @ vertex.co for vertex in mesh.vertices]
    finite_points = [p for p in points if _finite(p)]
    edge_usage = Counter()
    face_vertices = set()
    for face in mesh.polygons:
        face_vertices.update(face.vertices)
        edge_usage.update(tuple(sorted(key)) for key in face.edge_keys)
    connected_vertices = set()
    wire_edges = 0
    boundary_edges = 0
    overconnected_edges = 0
    for edge in mesh.edges:
        connected_vertices.update(edge.vertices)
        count = edge_usage.get(tuple(sorted(edge.vertices)), 0)
        wire_edges += count == 0
        boundary_edges += count == 1
        overconnected_edges += count > 2
    degenerate_triangles = 0
    for triangle in mesh.loop_triangles:
        a, b, c = (points[i] for i in triangle.vertices)
        if _finite(a) and _finite(b) and _finite(c):
            area_squared = (b - a).cross(c - a).length_squared * 0.25
            degenerate_triangles += area_squared <= AREA_EPSILON ** 2
    minimum = [min(p[axis] for p in finite_points) for axis in range(3)] if finite_points else None
    maximum = [max(p[axis] for p in finite_points) for axis in range(3)] if finite_points else None
    stats = {
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "faces": len(mesh.polygons),
        "triangles": len(mesh.loop_triangles),
        "nonfinite_local_vertices": sum(not _finite(v.co) for v in mesh.vertices),
        "nonfinite_world_vertices": len(points) - len(finite_points),
        "zero_area_faces_local": sum(p.area <= AREA_EPSILON for p in mesh.polygons),
        "degenerate_triangles_world": degenerate_triangles,
        "isolated_vertices": len(mesh.vertices) - len(connected_vertices),
        "vertices_without_faces": len(mesh.vertices) - len(face_vertices),
        "wire_edges": wire_edges,
        "boundary_edges": boundary_edges,
        "overconnected_edges": overconnected_edges,
        "nonmanifold_edges_by_face_count": wire_edges + boundary_edges + overconnected_edges,
        "uv_layers": len(mesh.uv_layers),
        "bounds_world": {"min": minimum, "max": maximum},
        "dimensions_world": [maximum[a] - minimum[a] for a in range(3)] if minimum is not None else None,
    }
    return _clean(stats)


def validate_scene():
    """Audit currently visible export meshes; return a JSON-serializable dict.

    A PASS here means only that automatic geometry checks found no blockers.
    Visual review, collision behavior, browser material fidelity, frame rate and
    traversability require additional checks in the exported target runtime.
    """
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    excluded = _collection_excluded(scene.collection)
    issues = []

    def issue(severity, code, message, obj=None, value=None):
        item = {"severity": severity, "code": code, "message": message}
        if obj is not None:
            item["object"] = obj
        if value is not None:
            item["value"] = _clean(value)
        issues.append(item)

    objects = []
    omitted = []
    materials = set()
    raw_totals = Counter()
    evaluated_totals = Counter()
    all_min = [math.inf] * 3
    all_max = [-math.inf] * 3
    count_fields = (
        "vertices", "edges", "faces", "triangles", "nonfinite_local_vertices",
        "nonfinite_world_vertices", "zero_area_faces_local", "degenerate_triangles_world",
        "isolated_vertices", "vertices_without_faces", "wire_edges", "boundary_edges",
        "overconnected_edges", "nonmanifold_edges_by_face_count"
    )
    for obj in sorted(scene.objects, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        collections = sorted(c.name for c in obj.users_collection)
        reasons = []
        if any(name in excluded for name in collections):
            reasons.append("excluded_collection")
        if obj.hide_render:
            reasons.append("hide_render")
        if not obj.visible_get():
            reasons.append("not_visible_in_active_view_layer")
        if reasons:
            omitted.append({"name": obj.name, "reasons": reasons, "collections": collections})
            continue
        matrix_finite = _finite(v for row in obj.matrix_world for v in row)
        if not matrix_finite:
            issue("blocker", "nonfinite_transform", "Object world transform contains non-finite values.", obj.name)
        if any(s < 0 for s in obj.scale) or obj.matrix_world.to_3x3().determinant() < 0:
            issue("major", "negative_scale", "Negative scale or mirrored world transform requires normal/winding verification.", obj.name, list(obj.scale))
        if any(abs(s - 1.0) > 1e-5 for s in obj.scale):
            issue("major", "unapplied_scale", "Apply object scale before final export, then repeat the audit.", obj.name, list(obj.scale))
        if not obj.name.startswith("SM_"):
            issue("minor", "mesh_naming", "Visible export mesh does not use the SM_ prefix.", obj.name)
        if any(not name.startswith("COL_") for name in collections):
            issue("minor", "collection_naming", "Mesh belongs to a collection without the COL_ prefix.", obj.name, collections)
        raw = _mesh_stats(obj.data, obj.matrix_world)
        evaluated_obj = obj.evaluated_get(depsgraph)
        evaluated_mesh = None
        try:
            evaluated_mesh = evaluated_obj.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
            evaluated = _mesh_stats(evaluated_mesh, evaluated_obj.matrix_world)
            slots = list(evaluated_mesh.materials)
            missing_faces = sum(
                face.material_index >= len(slots) or slots[face.material_index] is None
                for face in evaluated_mesh.polygons
            )
            material_names = sorted({material.name for material in slots if material is not None})
            materials.update(material_names)
            empty_slots = sum(material is None for material in slots)
        except Exception as exc:
            issue("blocker", "evaluation_failed", str(exc), obj.name)
            objects.append({"name": obj.name, "collections": collections, "raw": raw, "evaluation_error": str(exc)})
            continue
        finally:
            if evaluated_mesh is not None:
                evaluated_obj.to_mesh_clear()
        if missing_faces:
            issue("major", "faces_missing_material", "Evaluated faces have no valid material assignment.", obj.name, missing_faces)
        if empty_slots:
            issue("minor", "empty_material_slots", "Remove empty material slots before delivery.", obj.name, empty_slots)
        for field in ("nonfinite_local_vertices", "nonfinite_world_vertices"):
            if evaluated[field]:
                issue("blocker", field, "Evaluated geometry has invalid coordinates.", obj.name, evaluated[field])
        for field in ("zero_area_faces_local", "degenerate_triangles_world", "isolated_vertices", "wire_edges"):
            if evaluated[field]:
                issue("major", field, "Evaluated geometry needs cleanup or a documented exception.", obj.name, evaluated[field])
        if evaluated["overconnected_edges"]:
            issue("major", "overconnected_edges", "More than two faces share these edges; inspect topology.", obj.name, evaluated["overconnected_edges"])
        if evaluated["boundary_edges"]:
            issue("note", "open_boundary_edges", "Open boundaries may be intentional for roof, ground or water surfaces; inspect visually.", obj.name, evaluated["boundary_edges"])
        if evaluated["triangles"] == 0:
            issue("major", "empty_export_mesh", "Visible mesh contains no evaluated triangles.", obj.name)
        for field in count_fields:
            raw_totals[field] += raw[field]
            evaluated_totals[field] += evaluated[field]
        bounds = evaluated["bounds_world"]
        if bounds["min"] is not None and all(isinstance(v, (int, float)) for v in bounds["min"] + bounds["max"]):
            for axis in range(3):
                all_min[axis] = min(all_min[axis], bounds["min"][axis])
                all_max[axis] = max(all_max[axis], bounds["max"][axis])
        objects.append({
            "name": obj.name, "collections": collections,
            "location": _clean(list(obj.location)), "scale": _clean(list(obj.scale)),
            "world_transform_finite": matrix_finite,
            "raw": raw, "evaluated": evaluated,
            "materials": material_names, "material_slots": len(slots),
            "faces_missing_material": missing_faces,
            "modifiers": [{"name": m.name, "type": m.type, "viewport": m.show_viewport, "render": m.show_render} for m in obj.modifiers],
        })
    for material_name in sorted(materials):
        if not material_name.startswith("MAT_"):
            issue("minor", "material_naming", "Material does not use the MAT_ prefix.", value=material_name)
    if evaluated_totals["triangles"] > TRIANGLE_BUDGET:
        issue("blocker", "triangle_budget_exceeded", "Evaluated visible mesh triangle count exceeds the scene budget.", value=evaluated_totals["triangles"])
    if not objects:
        issue("blocker", "no_export_meshes", "No visible meshes matched the export scope.")
    instances = [
        {"object": entry.object.name, "parent": entry.parent.name if entry.parent else None}
        for entry in depsgraph.object_instances if entry.is_instance
    ]
    if instances:
        issue("major", "instances_require_export_audit", "Scene has dependency-graph instances; per-object mesh totals do not expand instances. Inspect or realize only on an export copy, then verify exported triangle counts.", value=len(instances))
    markers = []
    for obj in sorted(scene.objects, key=lambda o: o.name):
        if obj.name.startswith("MARK_"):
            marker = {
                "name": obj.name, "type": obj.type,
                "position_world": _clean(list(obj.matrix_world.translation)),
                "properties": {str(k): _clean(v) for k, v in obj.items() if k != "_RNA_UI"},
            }
            markers.append(marker)
            if obj.type != "EMPTY":
                issue("minor", "marker_type", "MARK_ placement helpers should be empties.", obj.name)
            if "kind" not in obj:
                issue("minor", "marker_kind_missing", "Placement marker is missing its kind custom property.", obj.name)
            if "npc" in str(obj.get("kind", "")).lower() and not obj.get("npc_id"):
                issue("major", "npc_id_missing", "NPC placement marker is missing npc_id metadata.", obj.name)
        elif obj.type == "CAMERA" and not obj.name.startswith("CAM_"):
            issue("minor", "camera_naming", "Camera does not use the CAM_ prefix.", obj.name)
        elif obj.type == "LIGHT" and not obj.name.startswith("LGT_"):
            issue("minor", "light_naming", "Light does not use the LGT_ prefix.", obj.name)
    if not markers:
        issue("major", "no_placement_markers", "No MARK_ empties were found for player/NPC placement.")
    if "COL_Collision" not in bpy.data.collections:
        issue("major", "collision_collection_missing", "COL_Collision is absent; traversal collision has not been authored.")
    if scene.unit_settings.system != "METRIC" or abs(scene.unit_settings.scale_length - 1.0) > 1e-5:
        issue("major", "scene_units", "Expected metric units with one Blender unit equal to one meter.", value={"system": scene.unit_settings.system, "scale_length": scene.unit_settings.scale_length})
    bounds_valid = _finite(all_min + all_max)
    dimensions = [all_max[a] - all_min[a] for a in range(3)] if bounds_valid else None
    severity_counts = dict(Counter(item["severity"] for item in issues))
    blockers = severity_counts.get("blocker", 0)
    majors = severity_counts.get("major", 0)
    verdict = "NO-SHIP" if blockers or majors else "SHIP WITH NOTES" if issues else "PASS AUTOMATED GEOMETRY CHECKS"
    return {
        "schema_version": 1,
        "scene": scene.name,
        "blender_version": bpy.app.version_string,
        "scope": {
            "source": "active scene and view layer",
            "visible_export_geometry": "MESH objects visible_get() and not hide_render, excluding listed collections and their descendants",
            "excluded_collections": sorted(excluded),
            "modifier_state": "current evaluated dependency graph (viewport modifier state)",
            "instances_expanded": False,
            "no_scene_mutations_or_file_writes": True,
        },
        "brief": {"footprint_m": [68, 54], "ground_z_m": 0.25, "source_up_axis": "Z", "export_up_axis": "Y", "triangle_budget": TRIANGLE_BUDGET},
        "verdict": verdict,
        "verdict_limit": "Geometry audit only. Final visual, material, collision, traversability, export-reimport and browser performance checks are separate and are not certified here.",
        "visible_mesh_objects": len(objects),
        "raw_totals": dict(raw_totals),
        "evaluated_totals": dict(evaluated_totals),
        "triangle_budget_fraction": evaluated_totals["triangles"] / TRIANGLE_BUDGET,
        "unique_material_count": len(materials),
        "materials": sorted(materials),
        "material_slot_total": sum(obj.get("material_slots", 0) for obj in objects),
        "draw_call_note": "Material and object counts are proxies only; actual draw calls and GPU memory require target-renderer measurement.",
        "bounds_world": {"min": all_min if bounds_valid else None, "max": all_max if bounds_valid else None},
        "dimensions_world": dimensions,
        "main_objects_by_evaluated_triangles": [obj["name"] for obj in sorted(objects, key=lambda o: o.get("evaluated", {}).get("triangles", 0), reverse=True)[:30]],
        "markers": markers,
        "instances": instances,
        "omitted_meshes": omitted,
        "objects": objects,
        "issue_counts": severity_counts,
        "issues": issues,
    }
