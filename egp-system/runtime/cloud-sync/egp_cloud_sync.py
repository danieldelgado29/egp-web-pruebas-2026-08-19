#!/usr/bin/env python3
import hashlib
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CORE_URL = "http://127.0.0.1:8788/api/state"
CONFIG_PATH = Path("/Library/Application Support/EGP-Network/web-cliente/configuracion.json")
LOG_PATH = Path.home() / "Library/Logs/EGP-Cloud-Sync.log"
INTERVAL = 2.5
REQUESTS_URL = "http://127.0.0.1:8790"
BRIDGE_STATE_PATH = Path.home() / "Library/Application Support/EGP-Cloud-Sync/orders_bridge_state.json"

FIELDS = [
    "lista_activa",
    "listaActiva",
    "repertorio_nombre",
    "repertorio_activo_ids",
    "repertorioActivoIds",
    "show_activo",
    "lugar",
    "perfil_clientes",
    "pedidos_whatsapp",
    "pedidos_panel",
    "pedidos_modo",
    "mostrar_cola",
    "uso_publicidad",
    "inicio_show",
    "updated_at",
    "show_revision",
    "show_writer",
    "show_id",
    "show_session_id",
    "cola",
    "tocadas",
    "cronometro_schema",
    "cronometro_elapsed_ms",
    "cronometro_running",
    "cronometro_started_at",
    "core_sync_heartbeat",
    "core_sync_host",
]

def log(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def fetch_json(url, timeout=4):
    req = urllib.request.Request(
        url,
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def firebase_cfg():
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        cfg = json.load(f)
    fb = cfg.get("firebase") or {}
    project = str(fb.get("projectId") or "").strip()
    api_key = str(fb.get("apiKey") or "").strip()
    if not project or not api_key:
        raise RuntimeError("configuracion.json no contiene projectId/apiKey")
    return project, api_key

def read_bridge_state():
    try:
        with BRIDGE_STATE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"mappings": {}, "last_active_show_id": ""}
        if not isinstance(data.get("mappings"), dict):
            data["mappings"] = {}
        data.setdefault("last_active_show_id", "")
        return data
    except Exception:
        return {"mappings": {}, "last_active_show_id": ""}

def save_bridge_state(data):
    BRIDGE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = BRIDGE_STATE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, BRIDGE_STATE_PATH)

def http_json(url, method="GET", body=None, timeout=10, headers=None):
    raw = None
    hdrs = {"Cache-Control": "no-store", "Pragma": "no-cache"}
    if headers:
        hdrs.update(headers)
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=raw, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def firestore_plain(value):
    if not isinstance(value, dict):
        return value
    if "stringValue" in value:
        return value["stringValue"]
    if "booleanValue" in value:
        return value["booleanValue"]
    if "integerValue" in value:
        try:
            return int(value["integerValue"])
        except Exception:
            return value["integerValue"]
    if "doubleValue" in value:
        return value["doubleValue"]
    if "timestampValue" in value:
        return value["timestampValue"]
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [firestore_plain(x) for x in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {
            k: firestore_plain(v)
            for k, v in value["mapValue"].get("fields", {}).items()
        }
    return value

def firestore_encode(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [firestore_encode(x) for x in value]}}
    if isinstance(value, dict):
        return {
            "mapValue": {
                "fields": {str(k): firestore_encode(v) for k, v in value.items()}
            }
        }
    return {"stringValue": str(value)}

def decode_document(doc):
    return {
        k: firestore_plain(v)
        for k, v in (doc.get("fields") or {}).items()
    }

def firebase_document_url(project, api_key, path):
    return (
        f"https://firestore.googleapis.com/v1/projects/{urllib.parse.quote(project, safe='')}"
        f"/databases/(default)/documents/{path}?key={urllib.parse.quote(api_key)}"
    )

def list_firebase_orders(project, api_key, max_pages=10):
    docs = []
    token = ""
    for _ in range(max_pages):
        qs = [("pageSize", "100"), ("key", api_key)]
        if token:
            qs.append(("pageToken", token))
        url = (
            f"https://firestore.googleapis.com/v1/projects/{urllib.parse.quote(project, safe='')}"
            f"/databases/(default)/documents/pedidos?"
            + urllib.parse.urlencode(qs)
        )
        data = http_json(url, timeout=12)
        for doc in data.get("documents", []) or []:
            item = decode_document(doc)
            item["_doc_id"] = str(doc.get("name", "")).split("/")[-1]
            docs.append(item)
        token = str(data.get("nextPageToken") or "")
        if not token:
            break
    return docs


def list_public_panel_orders(project, api_key):
    """
    EGP_FIREBASE_QUOTA_SAFE_V3

    Durante un show NO recorrer la colección completa 'pedidos'.

    La web pública ya mantiene los pedidos pendientes visibles dentro de
    config/estado -> pedidos_panel_lista. Leer ese único documento permite
    detectar pedidos Internet -> Mac con un coste fijo de una lectura por
    comprobación, independientemente del histórico acumulado.
    """
    url = firebase_document_url(project, api_key, "config/estado")
    doc = http_json(url, timeout=12)
    fields = decode_document(doc)

    lista = fields.get("pedidos_panel_lista")
    if not isinstance(lista, list):
        return []

    orders = []

    for raw in lista:
        if not isinstance(raw, dict):
            continue

        item = dict(raw)
        firebase_id = str(item.get("id") or "")

        if not firebase_id:
            continue

        item["_doc_id"] = firebase_id
        orders.append(item)

    return orders


def patch_firebase_order(project, api_key, doc_id, fields):
    mask = [("updateMask.fieldPaths", str(k)) for k in fields]
    qs = [("key", api_key)] + mask
    url = (
        f"https://firestore.googleapis.com/v1/projects/{urllib.parse.quote(project, safe='')}"
        f"/databases/(default)/documents/pedidos/{urllib.parse.quote(str(doc_id), safe='')}?"
        + urllib.parse.urlencode(qs)
    )
    body = {"fields": {str(k): firestore_encode(v) for k, v in fields.items()}}
    return http_json(url, method="PATCH", body=body, timeout=12)

def remove_order_from_public_list(project, api_key, firebase_id, retries=4):
    for _ in range(retries):
        url = firebase_document_url(project, api_key, "config/estado")
        doc = http_json(url, timeout=12)
        fields = decode_document(doc)
        lista = fields.get("pedidos_panel_lista")
        if not isinstance(lista, list):
            return False
        nueva = [
            x for x in lista
            if str((x or {}).get("id") or "") != str(firebase_id)
        ]
        if len(nueva) == len(lista):
            return False

        update_time = str(doc.get("updateTime") or "")
        qs = [
            ("key", api_key),
            ("updateMask.fieldPaths", "pedidos_panel_lista"),
        ]
        if update_time:
            qs.append(("currentDocument.updateTime", update_time))
        patch_url = (
            f"https://firestore.googleapis.com/v1/projects/{urllib.parse.quote(project, safe='')}"
            f"/databases/(default)/documents/config/estado?"
            + urllib.parse.urlencode(qs)
        )
        body = {
            "fields": {
                "pedidos_panel_lista": firestore_encode(nueva)
            }
        }
        try:
            http_json(patch_url, method="PATCH", body=body, timeout=12)
            return True
        except urllib.error.HTTPError as e:
            if e.code in (409, 412):
                time.sleep(0.15)
                continue
            raise
    raise RuntimeError("No se pudo actualizar pedidos_panel_lista sin pisar cambios nuevos")

def list_lan_orders(show_id, status="todos"):
    qs = urllib.parse.urlencode({
        "show_id": str(show_id),
        "estado": str(status),
    })
    data = http_json(f"{REQUESTS_URL}/api/orders?{qs}", timeout=4)
    if data.get("ok") is not True:
        raise RuntimeError("8790 devolvió orders inválido")
    return data.get("orders") if isinstance(data.get("orders"), list) else []

def import_firebase_order_to_lan(order):
    phone = str(
        order.get("telefono")
        or order.get("telefono_whatsapp")
        or order.get("phone")
        or ""
    )
    song_id = str(order.get("cancion_id") or "")
    title = str(order.get("cancion") or "Canción")
    if not phone or not song_id:
        return None
    data = http_json(
        f"{REQUESTS_URL}/api/orders",
        method="POST",
        body={
            "show_id": str(order.get("show_id") or ""),
            "cancion_id": song_id,
            "cancion": title,
            "telefono": phone,
        },
        timeout=4,
    )
    if data.get("ok") is not True:
        raise RuntimeError("8790 rechazó pedido importado")
    pedido = data.get("pedido") or {}
    return str(pedido.get("id") or "")

def bridge_orders(core, plain, project, api_key):
    state = read_bridge_state()
    mappings = state.setdefault("mappings", {})

    show_active = plain.get("show_activo") is True
    show_id = str(plain.get("inicio_show") or "")
    panel_enabled = plain.get("pedidos_panel") is True

    if show_active and show_id not in ("", "0"):
        state["last_active_show_id"] = show_id

        # EGP_FIREBASE_QUOTA_SAFE_V3
        # Nunca recorrer todo el histórico durante un show.
        # Si Pedidos al Panel está apagado, no consultar Firebase aquí.
        firebase_orders = (
            list_public_panel_orders(project, api_key)
            if panel_enabled
            else []
        )

        # Un pedido pendiente de otro show ya no puede pertenecer al show actual.
        # Cerrarlo evita marcas PEDIDA x1 heredadas de shows anteriores.
        stale_pending = [
            o for o in firebase_orders
            if str(o.get("estado") or "") == "pendiente"
            and str(o.get("show_id") or "") not in ("", show_id)
        ]
        if stale_pending:
            stale_closed_at = int(time.time() * 1000)
            stale_closed = 0
            for order in stale_pending:
                fid = str(order.get("_doc_id") or order.get("id") or "")
                if not fid:
                    continue
                patch_firebase_order(
                    project,
                    api_key,
                    fid,
                    {"estado": "cerrado", "cerrado_en_ms": stale_closed_at},
                )
                stale_closed += 1
            if stale_closed:
                log(f"PEDIDOS BRIDGE | históricos cerrados={stale_closed}")

        pending = [
            o for o in firebase_orders
            if str(o.get("show_id") or "") == show_id
            and str(o.get("estado") or "") == "pendiente"
        ]

        lan_orders = list_lan_orders(show_id, "todos")
        lan_by_id = {
            str(x.get("id") or ""): x
            for x in lan_orders
            if str(x.get("id") or "")
        }

        imported = 0
        if panel_enabled:
            for order in pending:
                fid = str(order.get("_doc_id") or order.get("id") or "")
                if not fid:
                    continue
                mapped = mappings.get(fid) if isinstance(mappings.get(fid), dict) else {}
                lan_id = str(mapped.get("lan_id") or "")
                if not lan_id or lan_id not in lan_by_id:
                    lan_id = import_firebase_order_to_lan(order) or ""
                    if lan_id:
                        mappings[fid] = {
                            "lan_id": lan_id,
                            "show_id": show_id,
                            "synced_status": "pendiente",
                        }
                        imported += 1

            if imported:
                lan_orders = list_lan_orders(show_id, "todos")
                lan_by_id = {
                    str(x.get("id") or ""): x
                    for x in lan_orders
                    if str(x.get("id") or "")
                }
                log(f"PEDIDOS BRIDGE | Firebase -> 8790 importados={imported} | show={show_id}")

        accepted = 0
        for fid, mapping in list(mappings.items()):
            if not isinstance(mapping, dict):
                continue
            if str(mapping.get("show_id") or "") != show_id:
                continue
            lan_id = str(mapping.get("lan_id") or "")
            local = lan_by_id.get(lan_id)
            if not local:
                continue
            local_status = str(local.get("estado") or "")
            synced_status = str(mapping.get("synced_status") or "pendiente")
            if local_status == "aceptado" and synced_status != "aceptado":
                accepted_at = int(local.get("aceptado_en_ms") or int(time.time() * 1000))
                patch_firebase_order(
                    project,
                    api_key,
                    fid,
                    {"estado": "aceptado", "aceptado_en_ms": accepted_at},
                )
                remove_order_from_public_list(project, api_key, fid)
                mapping["synced_status"] = "aceptado"
                accepted += 1

        if accepted:
            log(f"PEDIDOS BRIDGE | 8790 -> Firebase aceptados={accepted} | show={show_id}")

        save_bridge_state(state)
        return

    # Show cerrado: cerrar en Firebase todos los pedidos pendientes del último show.
    last_show = str(state.get("last_active_show_id") or "")
    if last_show not in ("", "0"):
        firebase_orders = list_firebase_orders(project, api_key)
        pending_old = [
            o for o in firebase_orders
            if str(o.get("show_id") or "") == last_show
            and str(o.get("estado") or "") == "pendiente"
        ]
        closed_at = int(time.time() * 1000)
        closed = 0
        for order in pending_old:
            fid = str(order.get("_doc_id") or order.get("id") or "")
            if not fid:
                continue
            patch_firebase_order(
                project,
                api_key,
                fid,
                {"estado": "cerrado", "cerrado_en_ms": closed_at},
            )
            closed += 1

        if closed:
            log(f"PEDIDOS BRIDGE | show cerrado | Firebase cerrados={closed} | show={last_show}")

        # La lista pública ya se vacía por build_payload(show=False).
        state["last_active_show_id"] = ""
        # Retener solo mappings de shows distintos por diagnóstico histórico.
        save_bridge_state(state)

def firestore_value(value):
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, list):
        return {
            "arrayValue": {
                "values": [{"stringValue": str(x)} for x in value]
            }
        }
    return {"stringValue": str(value if value is not None else "")}

# EGP_BIDIRECTIONAL_SHOW_SYNC_V2
AUTHORITY_STATE_PATH = Path.home() / "Library/Application Support/EGP-Cloud-Sync/authority_state_v2.json"
EGP_HEARTBEAT_INTERVAL_MS = 15000

def egp_authority_state_read():
    try:
        with AUTHORITY_STATE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def egp_authority_state_write(session="", active=False):
    AUTHORITY_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = AUTHORITY_STATE_PATH.with_suffix(".tmp")
    data = {
        "last_seen_at": int(time.time() * 1000),
        "active_session": str(session or "") if active else "",
        "active": bool(active),
    }
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, AUTHORITY_STATE_PATH)

def egp_firebase_state(project, api_key):
    url = (
        f"https://firestore.googleapis.com/v1/projects/{urllib.parse.quote(project, safe='')}"
        f"/databases/(default)/documents/config/estado"
        f"?key={urllib.parse.quote(api_key, safe='')}"
    )
    raw = http_json(url, timeout=10)
    return {
        k: firestore_plain(v)
        for k, v in (raw.get("fields") or {}).items()
    }

def egp_core_revision(core):
    pc = core.get("publicConfig") if isinstance(core, dict) else {}
    show = core.get("show") if isinstance(core, dict) else {}
    rows = core.get("queue") if isinstance(core, dict) else []
    pc = pc if isinstance(pc, dict) else {}
    show = show if isinstance(show, dict) else {}
    rows = rows if isinstance(rows, list) else []
    return max(
        int(pc.get("show_revision") or 0),
        int(pc.get("updated_at") or 0),
        max([int(x.get("updated_at") or 0) for x in rows if isinstance(x, dict)] or [0]),
    )

def egp_remote_revision(data):
    return max(
        int(data.get("show_revision") or 0),
        int(data.get("updated_at") or 0),
    ) if isinstance(data, dict) else 0

def egp_core_session(core):
    pc = core.get("publicConfig") if isinstance(core, dict) else {}
    pc = pc if isinstance(pc, dict) else {}
    return str(
        pc.get("show_session_id")
        or pc.get("show_id")
        or pc.get("inicio_show")
        or ""
    )

def egp_remote_session(data):
    data = data if isinstance(data, dict) else {}
    return str(
        data.get("show_session_id")
        or data.get("show_id")
        or data.get("inicio_show")
        or ""
    )

def egp_core_start(core):
    pc = core.get("publicConfig") if isinstance(core, dict) else {}
    pc = pc if isinstance(pc, dict) else {}
    try:
        return int(pc.get("inicio_show") or pc.get("show_id") or 0)
    except Exception:
        return 0

def egp_remote_start(data):
    data = data if isinstance(data, dict) else {}
    try:
        return int(data.get("inicio_show") or data.get("show_id") or 0)
    except Exception:
        return 0

def egp_core_active(core):
    show = core.get("show") if isinstance(core, dict) else {}
    show = show if isinstance(show, dict) else {}
    return show.get("active") is True

def egp_remote_active(data):
    return isinstance(data, dict) and data.get("show_activo") is True

def egp_core_queue(core):
    rows = core.get("queue") if isinstance(core, dict) else []
    rows = [x for x in (rows if isinstance(rows, list) else []) if isinstance(x, dict)]
    rows = sorted(rows, key=lambda x: int(x.get("position") or 0))
    q = [str(x.get("id") or "") for x in rows if str(x.get("id") or "")]
    p = [
        str(x.get("id") or "")
        for x in rows
        if x.get("played") is True and str(x.get("id") or "")
    ]
    return q, p

def egp_remote_queue(data):
    data = data if isinstance(data, dict) else {}
    q = []
    seen = set()
    for raw in (data.get("cola") or []):
        sid = str(raw)
        if sid and sid not in seen:
            seen.add(sid)
            q.append(sid)
    p = [str(x) for x in (data.get("tocadas") or []) if str(x)]
    return q, p

def egp_post_core(path, body):
    result = http_json(
        "http://127.0.0.1:8788" + path,
        method="POST",
        body=body,
        timeout=8,
    )
    if isinstance(result, dict) and result.get("ok") is False:
        raise RuntimeError(str(result.get("error") or result.get("message") or "Core rechazó la operación"))
    return result

def egp_song_lookup():
    result = {}
    try:
        path = CONFIG_PATH.parent / "canciones.json"
        rows = json.load(open(path, encoding="utf-8"))
        if isinstance(rows, list):
            for x in rows:
                if not isinstance(x, dict):
                    continue
                sid = str(x.get("id") or "")
                if sid:
                    result[sid] = {
                        "title": str(x.get("titulo") or x.get("title") or sid),
                        "number": str(x.get("numero") or x.get("n") or ""),
                    }
    except Exception:
        pass

    try:
        custom = fetch_json("http://127.0.0.1:8788/api/custom-songs", timeout=4)
        for x in (custom.get("customSongs") or []):
            if not isinstance(x, dict):
                continue
            sid = str(x.get("id") or "")
            if sid:
                result[sid] = {
                    "title": str(x.get("titulo") or x.get("title") or sid),
                    "number": str(x.get("numero") or x.get("n") or ""),
                }
    except Exception:
        pass

    return result

def egp_remote_public_config(remote, core):
    remote = remote if isinstance(remote, dict) else {}
    pc = core.get("publicConfig") if isinstance(core, dict) else {}
    pc = pc if isinstance(pc, dict) else {}

    active = remote.get("show_activo") is True
    rev = egp_remote_revision(remote)

    keys = [
        "show_id", "show_session_id",
        "pedidos_panel", "pedidos_modo", "pedidos_whatsapp", "mostrar_cola",
        "lista_activa", "listaActiva", "repertorio_nombre",
        "repertorio_activo_ids", "repertorioActivoIds",
        "lugar", "perfil_clientes", "uso_publicidad",
        "inicio_show",
        "cronometro_schema", "cronometro_elapsed_ms",
        "cronometro_running", "cronometro_started_at",
    ]

    out = {}
    for k in keys:
        if k in remote:
            out[k] = remote.get(k)
        elif k in pc:
            out[k] = pc.get(k)

    out["show_active"] = active
    out["show_activo"] = active
    out["show_revision"] = rev or int(time.time() * 1000)
    out["show_writer"] = str(remote.get("show_writer") or "firebase")

    if not active:
        out["inicio_show"] = 0
        out["cronometro_elapsed_ms"] = 0
        out["cronometro_running"] = False
        out["cronometro_started_at"] = 0

    return out

def egp_finalize_current_core_for_session_switch(core):
    pc = core.get("publicConfig") if isinstance(core, dict) else {}
    pc = dict(pc) if isinstance(pc, dict) else {}
    pc.update({
        "show_active": False,
        "show_activo": False,
        "show_revision": int(time.time() * 1000),
        "show_writer": "egp-cloud-sync-session-switch",
        "inicio_show": 0,
        "cronometro_elapsed_ms": 0,
        "cronometro_running": False,
        "cronometro_started_at": 0,
    })
    egp_post_core("/api/queue/clear", {})
    egp_post_core("/api/public-config", pc)

def egp_apply_remote_queue(remote, core):
    desired, desired_played_list = egp_remote_queue(remote)
    desired_played = set(desired_played_list)

    current, current_played_list = egp_core_queue(core)
    current_played = set(current_played_list)
    desired_set = set(desired)
    songs = egp_song_lookup()

    for sid in current:
        if sid not in desired_set:
            egp_post_core("/api/queue/remove", {"id": sid})

    for sid in desired:
        if sid in current_played and sid not in desired_played:
            egp_post_core("/api/queue/remove", {"id": sid})
            info = songs.get(sid, {})
            egp_post_core("/api/queue/add", {
                "id": sid,
                "title": str(info.get("title") or sid),
                "number": str(info.get("number") or ""),
            })

    current_after = set(egp_core_queue(fetch_json(CORE_URL, timeout=4))[0])

    for sid in desired:
        if sid not in current_after:
            info = songs.get(sid, {})
            egp_post_core("/api/queue/add", {
                "id": sid,
                "title": str(info.get("title") or sid),
                "number": str(info.get("number") or ""),
            })

    for sid in desired:
        if sid in desired_played:
            egp_post_core("/api/queue/played", {
                "id": sid,
                "played": True,
            })

    egp_post_core("/api/queue/reorder", {"order": desired})

def egp_apply_remote_to_core(remote, core):
    active = egp_remote_active(remote)

    if not active:
        egp_post_core("/api/queue/clear", {})
        egp_post_core("/api/public-config", egp_remote_public_config(remote, core))
        return fetch_json(CORE_URL, timeout=4)

    if (
        egp_core_active(core)
        and egp_core_session(core)
        and egp_remote_session(remote)
        and egp_core_session(core) != egp_remote_session(remote)
    ):
        egp_finalize_current_core_for_session_switch(core)
        core = fetch_json(CORE_URL, timeout=4)

    egp_post_core("/api/public-config", egp_remote_public_config(remote, core))
    fresh = fetch_json(CORE_URL, timeout=4)
    egp_apply_remote_queue(remote, fresh)
    return fetch_json(CORE_URL, timeout=4)

def egp_state_normalized(data):
    data = data if isinstance(data, dict) else {}

    arrays = {"repertorio_activo_ids", "repertorioActivoIds", "cola", "tocadas"}
    bools = {
        "show_activo", "pedidos_whatsapp", "pedidos_panel", "mostrar_cola",
        "uso_publicidad", "cronometro_running"
    }
    ints = {
        "inicio_show", "updated_at", "show_revision",
        "cronometro_schema", "cronometro_elapsed_ms", "cronometro_started_at"
    }

    out = {}
    for k in FIELDS:
        if k in {"show_writer", "core_sync_heartbeat"}:
            continue
        v = data.get(k)
        if k in arrays:
            out[k] = [str(x) for x in (v or [])]
        elif k in bools:
            out[k] = bool(v)
        elif k in ints:
            try:
                out[k] = int(v or 0)
            except Exception:
                out[k] = 0
        else:
            out[k] = str(v or "")

    return out

def egp_states_equal(remote, plain):
    return egp_state_normalized(remote) == egp_state_normalized(plain)

def egp_mirror_core(project, api_key, core, remote=None, force_heartbeat=False):
    remote = remote if isinstance(remote, dict) else {}
    heartbeat = (
        int(time.time() * 1000)
        if force_heartbeat
        else int(remote.get("core_sync_heartbeat") or 0)
    )
    plain, body = build_payload(core, heartbeat=heartbeat)
    if force_heartbeat or remote is None or not egp_states_equal(remote, plain):
        patch_firebase(project, api_key, body)
    return plain


# EGP_LIBRARY_BIDIRECTIONAL_SYNC_V1
CORE_LIBRARY_URL='http://127.0.0.1:8788/api/library'

def egp_library_hash(value):
    raw=json.dumps(value if isinstance(value,dict) else {},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()

def egp_patch_firebase_library(project,api_key,biblioteca,revision):
    qs=[('key',api_key),('updateMask.fieldPaths','biblioteca'),('updateMask.fieldPaths','biblioteca_updated_at')]
    url=(f"https://firestore.googleapis.com/v1/projects/{urllib.parse.quote(project,safe='')}/databases/(default)/documents/config/estado?"+urllib.parse.urlencode(qs))
    body={'fields':{'biblioteca':firestore_encode(biblioteca if isinstance(biblioteca,dict) else {}),'biblioteca_updated_at':firestore_encode(int(revision or 0))}}
    return http_json(url,method='PATCH',body=body,timeout=12)

def egp_sync_library_bidirectional(project,api_key,remote):
    core_lib=fetch_json(CORE_LIBRARY_URL,timeout=4)
    core_bib=core_lib.get('biblioteca') if isinstance(core_lib.get('biblioteca'),dict) else {}
    try: core_rev=int(core_lib.get('biblioteca_updated_at') or 0)
    except Exception: core_rev=0
    remote=remote if isinstance(remote,dict) else {}
    remote_bib=remote.get('biblioteca') if isinstance(remote.get('biblioteca'),dict) else {}
    try: remote_rev=int(remote.get('biblioteca_updated_at') or 0)
    except Exception: remote_rev=0
    ch=egp_library_hash(core_bib); rh=egp_library_hash(remote_bib)
    if remote_rev>core_rev:
        egp_post_core('/api/library',{'biblioteca':remote_bib,'biblioteca_updated_at':remote_rev,'source':'firebase'})
        return 'firebase->core'
    if core_rev>remote_rev:
        egp_patch_firebase_library(project,api_key,core_bib,core_rev)
        return 'core->firebase'
    if ch==rh: return 'igual'
    empty=egp_library_hash({'songEdits':{},'customSongs':[],'customRepertoires':[]})
    revision=max(int(time.time()*1000),core_rev+1,remote_rev+1)
    if core_rev==0 and ch==empty and rh!=empty:
        egp_post_core('/api/library',{'biblioteca':remote_bib,'biblioteca_updated_at':revision,'source':'cloud-sync'})
        egp_patch_firebase_library(project,api_key,remote_bib,revision)
        return 'firebase->core:migracion'
    egp_post_core('/api/library',{'biblioteca':core_bib,'biblioteca_updated_at':revision,'source':'cloud-sync'})
    egp_patch_firebase_library(project,api_key,core_bib,revision)
    return 'core->firebase:conflicto'

def egp_reconcile_once(verbose=False):
    core = fetch_json(CORE_URL, timeout=4)
    project, api_key = firebase_cfg()
    remote = egp_firebase_state(project, api_key)
    library_action='sin-cambio'
    try:
        library_action=egp_sync_library_bidirectional(project,api_key,remote)
        if library_action.startswith('firebase->core'): core=fetch_json(CORE_URL,timeout=4)
    except Exception as e:
        log('BIBLIOTECA SYNC AVISO | %s' % e)

    ca = egp_core_active(core)
    ra = egp_remote_active(remote)
    cs = egp_core_session(core)
    rs = egp_remote_session(remote)
    cr = egp_core_revision(core)
    rr = egp_remote_revision(remote)

    action = ""

    if ca and ra:
        if cs and rs and cs != rs:
            # Regla absoluta V2:
            # si Core está activo, NUNCA se reemplaza por otra sesión remota.
            action = "conflicto_sesion:core->firebase"

        elif rr > cr:
            core = egp_apply_remote_to_core(remote, core)
            action = "firebase->core"
        else:
            action = "core->firebase"

    elif ca and not ra:
        same_session = bool(cs and rs and cs == rs)
        if same_session and rr > cr:
            core = egp_apply_remote_to_core(remote, core)
            action = "firebase_finaliza->core"
        else:
            action = "core_activo->firebase"

    elif (not ca) and ra:
        core = egp_apply_remote_to_core(remote, core)
        action = "firebase_activo->core"

    else:
        action = "ambos_inactivos:core->firebase"

    now_ms = int(time.time() * 1000)
    last_hb = int(remote.get("core_sync_heartbeat") or 0) if isinstance(remote, dict) else 0
    force_heartbeat = (now_ms - last_hb) >= EGP_HEARTBEAT_INTERVAL_MS

    plain = egp_mirror_core(
        project,
        api_key,
        core,
        remote,
        force_heartbeat=force_heartbeat,
    )

    bridge_orders(core, plain, project, api_key)

    egp_authority_state_write(
        egp_core_session(core),
        egp_core_active(core),
    )

    if verbose:
        q, played = egp_core_queue(core)
        log(
            "SYNC TOTAL V2 OK | "
            f"accion={action} | "
            f"session={egp_core_session(core)} | "
            f"show={egp_core_active(core)} | "
            f"cola={len(q)} | tocadas={len(played)} | "
            f"revision={egp_core_revision(core)} | "
            f"heartbeat={plain.get('core_sync_heartbeat')}"
        )

    return fingerprint(plain), plain, action

def build_payload(core, heartbeat=0):
    if core.get("ok") is not True:
        raise RuntimeError("8788 devolvió estado inválido")

    pc = core.get("publicConfig")
    if not isinstance(pc, dict):
        pc = {}

    show = core.get("show")
    if not isinstance(show, dict):
        show = {}

    rows = core.get("queue")
    rows = [x for x in (rows if isinstance(rows, list) else []) if isinstance(x, dict)]
    rows = sorted(rows, key=lambda x: int(x.get("position") or 0))

    active = show.get("active") is True
    lista = str(pc.get("lista_activa") or "principal-diario")
    ids = [str(x) for x in (pc.get("repertorio_activo_ids") or [])]

    show_id = str(pc.get("show_id") or pc.get("inicio_show") or "") if active else ""
    session = str(pc.get("show_session_id") or (f"show-{show_id}" if show_id else "")) if active else ""

    revision = egp_core_revision(core)
    if not revision:
        revision = int(time.time() * 1000)

    queue = [str(x.get("id") or "") for x in rows if str(x.get("id") or "")] if active else []
    played = [
        str(x.get("id") or "")
        for x in rows
        if x.get("played") is True and str(x.get("id") or "")
    ] if active else []

    writer = f"egp-cloud-sync-{socket.gethostname()}"

    plain = {
        "lista_activa": lista,
        "listaActiva": lista,
        "repertorio_nombre": str(pc.get("repertorio_nombre") or ""),
        "repertorio_activo_ids": ids,
        "repertorioActivoIds": ids,
        "show_activo": active,
        "show_id": show_id,
        "show_session_id": session,
        "lugar": str(pc.get("lugar") or show.get("venue") or ""),
        "perfil_clientes": str(pc.get("perfil_clientes") or "medio"),
        "pedidos_whatsapp": active and pc.get("pedidos_whatsapp") is True,
        "pedidos_panel": active and pc.get("pedidos_panel") is True,
        "pedidos_modo": "uno_por_turno" if pc.get("pedidos_modo") == "uno_por_turno" else "libre",
        "mostrar_cola": pc.get("mostrar_cola") is not False,
        "uso_publicidad": pc.get("uso_publicidad") is True,
        "inicio_show": int(pc.get("inicio_show") or 0) if active else 0,
        "cronometro_schema": int(pc.get("cronometro_schema") or 0),
        "cronometro_elapsed_ms": int(pc.get("cronometro_elapsed_ms") or 0) if active else 0,
        "cronometro_running": active and pc.get("cronometro_running") is True,
        "cronometro_started_at": int(pc.get("cronometro_started_at") or 0) if active and pc.get("cronometro_running") is True else 0,
        "cola": queue,
        "tocadas": played,
        "updated_at": revision,
        "show_revision": revision,
        "show_writer": writer,
        "core_sync_heartbeat": int(heartbeat or 0),
        "core_sync_host": socket.gethostname(),
    }

    fields = {k: firestore_value(v) for k, v in plain.items()}

    if not active:
        plain["pedidos_panel_lista"] = []
        fields["pedidos_panel_lista"] = {"arrayValue": {"values": []}}

    return plain, {"fields": fields}


def fingerprint(plain):
    stable = dict(plain)
    stable.pop("show_writer", None)
    raw = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def patch_firebase(project, api_key, body):
    qs = [("key", api_key)]
    mask_fields = list(FIELDS)
    if "pedidos_panel_lista" in (body.get("fields") or {}):
        mask_fields.append("pedidos_panel_lista")
    qs += [("updateMask.fieldPaths", field) for field in mask_fields]
    url = (
        f"https://firestore.googleapis.com/v1/projects/{urllib.parse.quote(project, safe='')}"
        f"/databases/(default)/documents/config/estado?"
        + urllib.parse.urlencode(qs)
    )
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=12) as r:
        return json.load(r)

def sync_once(verbose=True):
    fingerprint_value, plain, action = egp_reconcile_once(verbose=verbose)
    return fingerprint_value, plain, {"action": action}


def daemon():
    log("EGP Cloud Sync iniciado — SYNC TOTAL BIDIRECCIONAL V2")
    quota_backoff = 60.0

    while True:
        sleep_for = INTERVAL
        try:
            egp_reconcile_once(verbose=True)
            quota_backoff = 60.0

        except urllib.error.HTTPError as e:
            try:
                detail = e.read().decode("utf-8", "replace")[:500]
            except Exception:
                detail = ""

            log(f"FIREBASE HTTP ERROR {e.code} | {detail}")

            if e.code == 429:
                sleep_for = quota_backoff
                log(f"FIREBASE 429 BACKOFF | reintento_en={int(sleep_for)}s")
                quota_backoff = min(quota_backoff * 2.0, 300.0)

        except Exception as e:
            log(f"PENDIENTE | {type(e).__name__}: {e}")

        time.sleep(sleep_for)


def main():
    if "--once" in sys.argv:
        sync_once(True)
        return
    daemon()

if __name__ == "__main__":
    main()
