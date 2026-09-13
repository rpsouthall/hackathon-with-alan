"""Standalone, read-only structural audit of the uncompressed Kyoto GLB.

Uses Python's standard library only. This is deliberately not a replacement for
the Khronos glTF Validator, a visual reimport, or target runtime testing.
Reference: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
"""

import json
import math
from pathlib import Path
import struct
from collections import Counter


REQUIRED_MARKERS = {
    "MARK_player_spawn": {"kind": "player_spawn"},
    "MARK_npc_cafe": {"kind": "npc", "npc_id": "cafe_owner"},
    "MARK_npc_guide": {"kind": "npc", "npc_id": "local_guide"},
    "MARK_npc_inn": {"kind": "npc", "npc_id": "inn_host"},
    "MARK_bridge_midpoint": {"kind": "waypoint"},
}
ROUTE_CENTERLINES_BLENDER_XY = {
    "spawn_to_guide": [(5, -10), (5, -4), (0, -4), (-5, -4), (-5, 1), (-7.2, 1)],
    "spawn_to_cafe": [(5, -10), (5, -4), (5, -1.8), (9, -1.8)],
    "spawn_to_inn": [(5, -10), (5, 7.1), (9.6, 7.1)],
}


def route_samples(spacing=0.15):
    """Return centerline XY samples, with duplicates removed at polyline joins."""
    if spacing <= 0:
        raise ValueError("spacing must be positive")
    result = {}
    for name, route in ROUTE_CENTERLINES_BLENDER_XY.items():
        samples = []
        for start, end in zip(route, route[1:]):
            count = max(1, math.ceil(math.dist(start, end) / spacing))
            samples.extend([
                [start[a] + (end[a] - start[a]) * i / count for a in (0, 1)]
                for i in range(count)
            ])
        result[name] = samples + [list(route[-1])]
    return result


def verify_glb_file(path):
    """Return a JSON-safe report; never modify the GLB, scene, or filesystem.

    POSITION and index data, including sparse accessors, are decoded. Accessor
    bounds include interleaved strides and glTF's padded matrix-column layout.
    GPU compression and external URI resources are explicitly unsupported rather
    than silently marked passed. Marker requirements target the environment GLB.
    """
    report = {"path": str(path), "verdict": "FAIL", "issues": [], "checks": {}}
    issues = report["issues"]

    def issue(level, code, message, context=None):
        item = {"severity": level, "code": code, "message": message}
        if context is not None:
            item["context"] = context
        issues.append(item)

    def finish():
        report["issue_counts"] = dict(Counter(i["severity"] for i in issues))
        report["verdict"] = "FAIL" if any(i["severity"] == "error" for i in issues) else "PASS WITH NOTES" if issues else "PASS"
        report["verification_limit"] = "Static uncompressed GLB structure, data and scene checks only; not a complete glTF schema/extension validator, rendered appearance, physics, browser performance or gameplay verification."
        return report

    def valid_ref(index, sequence, label):
        if type(index) is not int or not 0 <= index < len(sequence):
            issue("error", "invalid_reference", label + " is outside the referenced array.", index)
            return False
        return True

    def uint(value):
        return type(value) is int and value >= 0

    def finite_vector(value, count):
        return isinstance(value, list) and len(value) == count and all(type(x) in (float, int) and math.isfinite(x) for x in value)

    try:
        data = Path(path).read_bytes()
    except OSError as exc:
        issue("error", "read_failed", str(exc))
        return finish()
    report["file_bytes"] = len(data)
    if len(data) < 20:
        issue("error", "short_header", "A GLB needs a 12-byte header and JSON chunk header.")
        return finish()
    magic, version, declared_length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or declared_length != len(data):
        issue("error", "invalid_header", "Expected glTF magic, version 2, and an exact total byte length.", {"magic": repr(magic), "version": version, "declared_length": declared_length})
        return finish()
    chunks = []
    cursor = 12
    while cursor < len(data):
        if cursor + 8 > len(data):
            issue("error", "truncated_chunk_header", "Incomplete chunk header.", cursor)
            return finish()
        size, kind = struct.unpack_from("<II", data, cursor)
        start = cursor + 8
        if size % 4 or start + size > len(data):
            issue("error", "invalid_chunk_bounds", "Chunk must be aligned to four bytes and fit in the file.", {"offset": cursor, "size": size})
            return finish()
        chunks.append((kind, data[start:start + size]))
        cursor = start + size
    if not chunks or chunks[0][0] != 0x4E4F534A or sum(k == 0x4E4F534A for k, _ in chunks) != 1:
        issue("error", "json_chunk_order", "Exactly one JSON chunk must be first.")
        return finish()
    bins = [payload for kind, payload in chunks if kind == 0x004E4942]
    if len(bins) > 1:
        issue("error", "duplicate_bin_chunk", "At most one BIN chunk is allowed.")
        return finish()
    if bins and (len(chunks) < 2 or chunks[1][0] != 0x004E4942):
        issue("error", "bin_chunk_order", "The BIN chunk must be second when present.")
    try:
        document = json.loads(chunks[0][1].decode("utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ValueError("nonfinite JSON constant: " + x)))
    except (UnicodeDecodeError, ValueError) as exc:
        issue("error", "invalid_json", str(exc))
        return finish()
    if not isinstance(document, dict) or document.get("asset", {}).get("version") != "2.0":
        issue("error", "asset_version", "Expected a glTF JSON object with asset.version 2.0.")
        return finish()
    arrays = ("buffers", "bufferViews", "accessors", "meshes", "materials", "nodes", "scenes", "textures", "images", "samplers", "cameras", "skins")
    for key in arrays:
        if not isinstance(document.get(key, []), list) or not all(isinstance(x, dict) for x in document.get(key, [])):
            issue("error", "invalid_top_level_array", "Expected an array of objects.", key)
            return finish()
    buffers, views, accessors = (document.get(key, []) for key in arrays[:3])
    meshes, materials, nodes, scenes = (document.get(key, []) for key in arrays[3:7])
    binary = bins[0] if bins else b""
    report["asset"] = document["asset"]
    report["chunk_bytes"] = [{"kind": hex(k), "bytes": len(v)} for k, v in chunks]
    report["counts"] = {name: len(document.get(name, [])) for name in arrays}
    for index, buffer in enumerate(buffers):
        if "uri" in buffer:
            issue("error", "external_buffer_unsupported", "Verifier expects self-contained GLB binary data and does not load URIs.", index)
        if index != 0 or not uint(buffer.get("byteLength")) or not buffer.get("byteLength", 0) <= len(binary) <= buffer.get("byteLength", 0) + 3:
            issue("error", "buffer_length", "Embedded buffer must be index zero and fit BIN data with at most three padding bytes.", index)
    if binary and not buffers:
        issue("error", "unreferenced_bin", "BIN data exists without a buffers array.")
    buffer_data = [binary if i == 0 and "uri" not in b else None for i, b in enumerate(buffers)]
    valid_views = set()
    for index, view in enumerate(views):
        offset, length, stride = view.get("byteOffset", 0), view.get("byteLength"), view.get("byteStride")
        if not valid_ref(view.get("buffer"), buffers, "bufferView[%d].buffer" % index):
            continue
        buffer = buffers[view["buffer"]]
        if not uint(offset) or not uint(length) or length == 0 or not uint(buffer.get("byteLength")) or offset + length > buffer["byteLength"]:
            issue("error", "buffer_view_bounds", "bufferView exceeds its buffer or has invalid byte lengths.", index)
            continue
        if stride is not None and (not uint(stride) or not 4 <= stride <= 252 or stride % 4):
            issue("error", "buffer_view_stride", "byteStride must be a multiple of four between 4 and 252.", index)
            continue
        if "EXT_meshopt_compression" in view.get("extensions", {}):
            issue("error", "compression_unsupported", "Meshopt-compressed views require a decoder and separate validation.", index)
            continue
        valid_views.add(index)

    component = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    shapes = {"SCALAR": (1, 1), "VEC2": (1, 2), "VEC3": (1, 3), "VEC4": (1, 4), "MAT2": (2, 2), "MAT3": (3, 3), "MAT4": (4, 4)}
    decoded = {}

    def decode_stream(view_index, byte_offset, count, fmt, width, offsets, full_size, footprint, label, no_stride=False):
        label = str(label)
        if not valid_ref(view_index, views, label + ".bufferView") or view_index not in valid_views:
            return None
        view = views[view_index]
        stride = view.get("byteStride", full_size)
        if no_stride and "byteStride" in view:
            issue("error", "sparse_stride", "Sparse accessor views cannot have byteStride.", label)
            return None
        if not uint(byte_offset) or byte_offset % width or (view.get("byteOffset", 0) + byte_offset) % width or stride < full_size or stride % width:
            issue("error", "accessor_alignment", "Invalid accessor offset, component alignment or element stride.", label)
            return None
        end = byte_offset + (count - 1) * stride + footprint if count else byte_offset
        if end > view["byteLength"]:
            issue("error", "accessor_byte_bounds", "Accessor including its final strided element exceeds bufferView.", {"accessor": label, "required_bytes": end, "available_bytes": view["byteLength"]})
            return None
        blob = buffer_data[view["buffer"]]
        if blob is None:
            return None
        start = view.get("byteOffset", 0) + byte_offset
        if start + max(0, end - byte_offset) > len(blob):
            issue("error", "accessor_binary_bounds", "Accessor exceeds actual BIN data.", label)
            return None
        return [tuple(struct.unpack_from("<" + fmt, blob, start + row * stride + off)[0] for off in offsets) for row in range(count)]

    for index, accessor in enumerate(accessors):
        ct, shape, count = accessor.get("componentType"), accessor.get("type"), accessor.get("count")
        if ct not in component or shape not in shapes or not uint(count) or count == 0:
            issue("error", "accessor_format", "Invalid component type, shape or count.", index)
            continue
        fmt, width = component[ct]
        columns, rows = shapes[shape]
        column_stride = math.ceil(rows * width / 4) * 4 if columns > 1 else rows * width
        offsets = [column * column_stride + row * width for column in range(columns) for row in range(rows)]
        size, footprint = columns * column_stride, offsets[-1] + width
        if "bufferView" in accessor:
            values = decode_stream(accessor["bufferView"], accessor.get("byteOffset", 0), count, fmt, width, offsets, size, footprint, index)
        else:
            values = [(0,) * (columns * rows) for _ in range(count)]
            if accessor.get("byteOffset", 0):
                issue("error", "accessor_offset_without_view", "Accessor byteOffset requires a bufferView.", index)
        sparse = accessor.get("sparse")
        if sparse is not None:
            if not isinstance(sparse, dict) or not uint(sparse.get("count")) or not 0 < sparse["count"] <= count or not isinstance(sparse.get("indices"), dict) or not isinstance(sparse.get("values"), dict):
                issue("error", "invalid_sparse_accessor", "Invalid sparse count or indices/values object.", index)
                continue
            si, sv, sc = sparse["indices"], sparse["values"], sparse["count"]
            if si.get("componentType") not in (5121, 5123, 5125):
                issue("error", "sparse_index_type", "Sparse indices must be unsigned integer values.", index)
                continue
            ifmt, iw = component[si["componentType"]]
            indices = decode_stream(si.get("bufferView"), si.get("byteOffset", 0), sc, ifmt, iw, [0], iw, iw, "sparse indices %d" % index, True)
            replacements = decode_stream(sv.get("bufferView"), sv.get("byteOffset", 0), sc, fmt, width, offsets, size, footprint, "sparse values %d" % index, True)
            if values is not None and indices is not None and replacements is not None:
                sparse_indices = [v[0] for v in indices]
                if any(v >= count for v in sparse_indices) or any(a >= b for a, b in zip(sparse_indices, sparse_indices[1:])):
                    issue("error", "sparse_index_bounds", "Sparse indices must increase strictly and remain within accessor count.", index)
                    continue
                for destination, replacement in zip(sparse_indices, replacements):
                    values[destination] = replacement
            else:
                values = None
        if values is not None:
            if ct == 5126 and any(not math.isfinite(v) for row in values for v in row):
                issue("error", "nonfinite_accessor", "Floating-point accessor contains NaN or infinity.", index)
            decoded[index] = values
        for bound_name in ("min", "max"):
            if bound_name in accessor and not finite_vector(accessor[bound_name], columns * rows):
                issue("error", "accessor_declared_bounds", "Accessor min/max must contain finite values with the correct dimension.", index)

    mesh_triangles = []
    mesh_position_accessors = []
    position_stats = {}
    for mesh_index, mesh in enumerate(meshes):
        triangle_count = 0
        position_ids = set()
        primitives = mesh.get("primitives", [])
        if not isinstance(primitives, list) or not primitives or not all(isinstance(p, dict) for p in primitives):
            issue("error", "mesh_primitives", "Mesh must have a nonempty primitives array.", mesh_index)
            mesh_triangles.append(0)
            mesh_position_accessors.append(set())
            continue
        for primitive_index, primitive in enumerate(primitives):
            label = "mesh[%d].primitive[%d]" % (mesh_index, primitive_index)
            if "KHR_draco_mesh_compression" in primitive.get("extensions", {}):
                issue("error", "compression_unsupported", "Draco primitives require a decoder and separate validation.", label)
            attributes = primitive.get("attributes", {})
            if not isinstance(attributes, dict) or "POSITION" not in attributes:
                issue("error", "position_missing", "Primitive requires a POSITION accessor.", label)
                continue
            position_id = attributes["POSITION"]
            if not valid_ref(position_id, accessors, label + ".POSITION"):
                continue
            position_ids.add(position_id)
            position = accessors[position_id]
            vertex_count = position.get("count", 0)
            if position.get("componentType") != 5126 or position.get("type") != "VEC3":
                issue("error", "position_format", "This export verifier expects unquantized FLOAT VEC3 positions.", label)
            for semantic, accessor_id in attributes.items():
                if valid_ref(accessor_id, accessors, label + "." + semantic) and accessors[accessor_id].get("count") != vertex_count:
                    issue("error", "attribute_count_mismatch", "All primitive vertex attributes must have matching counts.", label)
            if "material" in primitive:
                valid_ref(primitive["material"], materials, label + ".material")
            count = vertex_count
            if "indices" in primitive and valid_ref(primitive["indices"], accessors, label + ".indices"):
                index_id = primitive["indices"]
                index_accessor = accessors[index_id]
                count = index_accessor.get("count", 0)
                if index_accessor.get("componentType") not in (5121, 5123, 5125) or index_accessor.get("type") != "SCALAR" or index_accessor.get("normalized", False):
                    issue("error", "indices_format", "Primitive indices require unsigned, non-normalized SCALAR accessors.", label)
                elif index_id in decoded and any(v[0] >= vertex_count for v in decoded[index_id]):
                    issue("error", "index_vertex_bounds", "Primitive index points beyond POSITION vertex count.", label)
            mode = primitive.get("mode", 4)
            if type(mode) is not int or not 0 <= mode <= 6:
                issue("error", "primitive_mode", "Primitive mode must be between 0 and 6.", label)
            if not uint(count):
                issue("error", "primitive_count", "Invalid vertex/index count.", label)
                count = 0
            if mode == 4:
                if count % 3:
                    issue("error", "triangle_index_count", "TRIANGLES vertex/index count must be divisible by three.", label)
                triangle_count += count // 3
            elif mode in (5, 6):
                triangle_count += max(0, count - 2)
            else:
                issue("note", "non_triangle_primitive", "Point/line primitives are omitted from triangle totals.", label)
            for target in primitive.get("targets", []):
                for semantic, accessor_id in target.items():
                    valid_ref(accessor_id, accessors, label + ".target." + semantic)
            if position_id not in position_stats and position_id in decoded:
                positions = decoded[position_id]
                if positions and all(len(p) == 3 and all(math.isfinite(v) for v in p) for p in positions):
                    minimum = [min(p[a] for p in positions) for a in range(3)]
                    maximum = [max(p[a] for p in positions) for a in range(3)]
                    position_stats[position_id] = {"count": len(positions), "min": minimum, "max": maximum}
                    for key, actual in (("min", minimum), ("max", maximum)):
                        bound = position.get(key)
                        if not finite_vector(bound, 3):
                            issue("error", "position_bounds_missing", "POSITION accessor requires finite min and max arrays.", position_id)
                        elif any(not math.isclose(a, b, rel_tol=1e-5, abs_tol=1e-5) for a, b in zip(actual, bound)):
                            issue("error", "position_bounds_mismatch", "POSITION min/max do not match decoded data.", {"accessor": position_id, "bound": key, "actual": actual, "declared": bound})
        mesh_triangles.append(triangle_count)
        mesh_position_accessors.append(position_ids)

    def walk_texture_refs(value, label):
        if isinstance(value, dict):
            for key, child in value.items():
                if key.endswith("Texture") and isinstance(child, dict) and "index" in child:
                    valid_ref(child["index"], document.get("textures", []), label + "." + key)
                walk_texture_refs(child, label + "." + key)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk_texture_refs(child, label + "[%d]" % i)
    for i, material in enumerate(materials):
        walk_texture_refs(material, "material[%d]" % i)
    for i, texture in enumerate(document.get("textures", [])):
        for key, target in (("source", "images"), ("sampler", "samplers")):
            if key in texture:
                valid_ref(texture[key], document.get(target, []), "texture[%d].%s" % (i, key))
    for i, image in enumerate(document.get("images", [])):
        if "bufferView" in image:
            valid_ref(image["bufferView"], views, "image[%d].bufferView" % i)
        elif "uri" in image:
            issue("note", "image_uri_unverified", "URI image data has not been decoded or loaded.", i)

    identity = [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]
    def multiply(a, b):
        return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]
    def node_matrix(index, node):
        if "matrix" in node:
            values = node["matrix"]
            if not finite_vector(values, 16):
                issue("error", "node_matrix", "Node matrix must contain 16 finite numbers.", index)
                return identity
            if any(k in node for k in ("translation", "rotation", "scale")):
                issue("error", "node_matrix_and_trs", "Node matrix cannot coexist with TRS properties.", index)
            matrix = [[values[c * 4 + r] for c in range(4)] for r in range(4)]
            lengths = [math.sqrt(sum(matrix[r][c] ** 2 for r in range(3))) for c in range(3)]
            orthogonal = all(abs(sum(matrix[r][a] * matrix[r][b] for r in range(3))) < 1e-5 for a, b in ((0, 1), (0, 2), (1, 2)))
            determinant = sum(matrix[0][i] * (matrix[1][(i + 1) % 3] * matrix[2][(i + 2) % 3] - matrix[1][(i + 2) % 3] * matrix[2][(i + 1) % 3]) for i in range(3))
            if any(abs(v - 1) > 1e-5 for v in lengths) or not orthogonal or determinant < 0:
                issue("error", "unapplied_node_transform", "Expected unit scale, no shear, and no mirrored node matrix.", index)
            if any(abs(a - b) > 1e-5 for a, b in zip(matrix[3], [0, 0, 0, 1])):
                issue("error", "node_affine_matrix", "Node matrix must be affine.", index)
            return matrix
        t, q, scale = node.get("translation", [0, 0, 0]), node.get("rotation", [0, 0, 0, 1]), node.get("scale", [1, 1, 1])
        if not finite_vector(t, 3) or not finite_vector(q, 4) or not finite_vector(scale, 3):
            issue("error", "node_trs", "Node TRS components have invalid lengths or non-finite values.", index)
            return identity
        if any(abs(s - 1) > 1e-5 for s in scale):
            issue("error", "unapplied_node_scale", "Expected node scale [1, 1, 1] in final static export.", index)
        if abs(sum(v * v for v in q) - 1) > 1e-4:
            issue("error", "nonunit_quaternion", "Node rotation quaternion must be normalized.", index)
        x, y, z, w = q
        matrix = [[1-2*y*y-2*z*z, 2*x*y-2*z*w, 2*x*z+2*y*w, t[0]],
                  [2*x*y+2*z*w, 1-2*x*x-2*z*z, 2*y*z-2*x*w, t[1]],
                  [2*x*z-2*y*w, 2*y*z+2*x*w, 1-2*x*x-2*y*y, t[2]], [0, 0, 0, 1]]
        for r in range(3):
            for c in range(3):
                matrix[r][c] *= scale[c]
        return matrix
    local_matrices = []
    parents = {}
    adjacency = {}
    for i, node in enumerate(nodes):
        local_matrices.append(node_matrix(i, node))
        for key, target in (("mesh", meshes), ("camera", document.get("cameras", [])), ("skin", document.get("skins", []))):
            if key in node:
                valid_ref(node[key], target, "node[%d].%s" % (i, key))
        adjacency[i] = []
        for child in node.get("children", []):
            if valid_ref(child, nodes, "node[%d].children" % i):
                if child in parents:
                    issue("error", "node_multiple_parents", "Nodes cannot have multiple parents or duplicate child references.", child)
                parents[child] = i
                adjacency[i].append(child)
    state = {}
    def cycle_check(i):
        if state.get(i) == 1:
            issue("error", "node_cycle", "Scene node graph contains a cycle.", i)
            return
        if state.get(i) == 2:
            return
        state[i] = 1
        for child in adjacency[i]:
            cycle_check(child)
        state[i] = 2
    try:
        for i in range(len(nodes)):
            cycle_check(i)
    except RecursionError:
        issue("error", "node_graph_depth", "Scene graph is too deeply nested for this verifier.")
        return finish()
    if not scenes:
        issue("error", "scene_missing", "Environment export must contain a scene.")
        return finish()
    for i, scene in enumerate(scenes):
        for root in scene.get("nodes", []):
            if valid_ref(root, nodes, "scene[%d].nodes" % i) and root in parents:
                issue("error", "scene_root_has_parent", "Scene root nodes cannot be children of other nodes.", root)
    active = document.get("scene", 0)
    if not valid_ref(active, scenes, "scene"):
        return finish()
    world_matrices = {}
    def visit(i, parent_matrix):
        if i in world_matrices or not isinstance(i, int) or not 0 <= i < len(nodes):
            return
        matrix = multiply(parent_matrix, local_matrices[i])
        world_matrices[i] = matrix
        for child in adjacency[i]:
            visit(child, matrix)
    for root in scenes[active].get("nodes", []):
        visit(root, identity)
    marker_report = []
    for expected_name, expected_extras in REQUIRED_MARKERS.items():
        matches = [(i, n) for i, n in enumerate(nodes) if n.get("name") == expected_name]
        if len(matches) != 1:
            issue("error", "required_marker_missing_or_duplicate", "Expected exactly one placement marker.", expected_name)
            continue
        i, node = matches[0]
        extras = node.get("extras", {})
        if not isinstance(extras, dict) or any(extras.get(k) != v for k, v in expected_extras.items()):
            issue("error", "marker_extras", "Placement marker is missing its required kind/npc_id extras.", expected_name)
        if i not in world_matrices:
            issue("error", "marker_not_in_scene", "Placement marker is not reachable in the active scene.", expected_name)
        matrix = world_matrices.get(i, identity)
        marker_report.append({"name": expected_name, "extras": extras, "position_world_gltf": [matrix[r][3] for r in range(3)]})
    world_min, world_max = [math.inf] * 3, [-math.inf] * 3
    scene_triangles = 0
    for i, matrix in world_matrices.items():
        mesh_id = nodes[i].get("mesh")
        if type(mesh_id) is not int or not 0 <= mesh_id < len(meshes):
            continue
        scene_triangles += mesh_triangles[mesh_id]
        for accessor_id in mesh_position_accessors[mesh_id]:
            if accessor_id not in position_stats:
                continue
            for position in decoded[accessor_id]:
                transformed = [sum(matrix[r][c] * position[c] for c in range(3)) + matrix[r][3] for r in range(3)]
                for axis in range(3):
                    world_min[axis] = min(world_min[axis], transformed[axis])
                    world_max[axis] = max(world_max[axis], transformed[axis])
    if scene_triangles > 650000:
        issue("error", "triangle_budget", "Active scene exceeds 650,000 triangles, counting mesh instances.", scene_triangles)
    valid_bounds = all(math.isfinite(v) for v in world_min + world_max)
    report["checks"].update({"header_lengths": True, "accessors_decoded": len(decoded), "active_scene": active, "reachable_nodes": len(world_matrices)})
    report["triangles_unique_mesh_data"] = sum(mesh_triangles)
    report["triangles_active_scene_with_instances"] = scene_triangles
    report["mesh_triangles"] = [{"mesh": i, "name": m.get("name"), "triangles": mesh_triangles[i]} for i, m in enumerate(meshes)]
    report["position_accessor_bounds"] = position_stats
    report["bounds_world_gltf"] = {"min": world_min if valid_bounds else None, "max": world_max if valid_bounds else None}
    report["dimensions_world_gltf"] = [world_max[a] - world_min[a] for a in range(3)] if valid_bounds else None
    report["markers"] = marker_report
    report["extensions_used"] = document.get("extensionsUsed", [])
    if document.get("animations") or document.get("skins"):
        issue("note", "animation_not_verified", "Animation and skinning behavior are outside this static environment audit.")
    return finish()
