#!/usr/bin/python3
# EGP_REGRESION_V1
# Revision instalador: 2026-09-07b — corrige contrato public-config y amplia sandbox.
# Comprobador automático NO destructivo en producción + pruebas destructivas SOLO en sandbox.
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HOME = Path.home()
REPO = HOME / "Downloads/egp-web-pruebas-2026-08-19"
BASE = HOME / "Desktop/solo esto sirve/01-BRIDGE-ACTUAL-21AGO/BRIDGE-LOGIC-PANEL-APPS-OFFLINE-REAL-v5-AX-SPACES-SEGURO"
LOCALCORE_DIR = BASE / "BridgeCore/LocalCore"
LAN_WEB = LOCALCORE_DIR / "panel-real"
CADDY_WEB = Path("/Library/Application Support/EGP-Network/web-cliente")
CORE = LOCALCORE_DIR / "egp_local_core.py"
CLOUD_SYNC = HOME / "Library/Application Support/EGP-Cloud-Sync/egp_cloud_sync.py"
CADDYFILE = Path("/Library/Application Support/EGP-Network/Caddyfile")
CADDY_BIN = Path("/Library/Application Support/EGP-Network/bin/caddy")
CADDY_ENV = Path("/Library/Application Support/EGP-Network/cloudflare.env")
BRIDGE = BASE / "ABRIR-BRIDGE-LOGIC.command"
LEGACY_BRIDGE_SYNC = BASE / "BridgeCore/egp-cloud-sync.py"
SQLITE = HOME / "Library/Application Support/EGP Local Core/egp_local.sqlite3"
REGDIR = HOME / "Library/Application Support/EGP Regression"
REPORT_DIR = REGDIR / "reports"
VARIANT_META = REPO / "egp-system/variants/caddy-public/variant-meta.json"
COMPAT = REPO / "egp-system/bridge/compatibility.json"
EXPECTED_16_MAIN = "1f962f9ed0a374fab1355b16e716f22bbe0a834b"

RESULTS = []

def emit(msg=""):
    print(str(msg), flush=True)

def add(rule_id, status, label, detail=""):
    RESULTS.append({
        "id": rule_id,
        "status": status,
        "label": label,
        "detail": str(detail or "")
    })
    tag = {
        "PASS": "OK  ",
        "FAIL": "NO  ",
        "WARN": "AVISO",
        "SKIP": "SKIP",
        "MANUAL": "MANUAL"
    }.get(status, status)
    emit(f"{tag} {rule_id} · {label}" + (f" — {detail}" if detail else ""))

def pass_(rid, label, detail=""): add(rid, "PASS", label, detail)
def fail(rid, label, detail=""): add(rid, "FAIL", label, detail)
def warn(rid, label, detail=""): add(rid, "WARN", label, detail)
def skip(rid, label, detail=""): add(rid, "SKIP", label, detail)
def manual(rid, label, detail=""): add(rid, "MANUAL", label, detail)

def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()

def sha_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def text(path):
    return Path(path).read_text(encoding="utf-8", errors="replace")

def contains_all(path, tokens):
    s = text(path)
    missing = [t for t in tokens if t not in s]
    return missing

def run(args, timeout=20, env=None):
    return subprocess.run(
        args,
        text=True,
        capture_output=True,
        timeout=timeout,
        env=env
    )

def safe_rel(v):
    v = str(v or "").strip()
    p = Path(v)
    if not v or p.is_absolute() or ".." in p.parts:
        raise ValueError("ruta insegura: %r" % v)
    return p.as_posix()

def http_bytes(url, timeout=6, resolve=None):
    args = ["/usr/bin/curl", "-skL", "--max-time", str(timeout)]
    if resolve:
        args += ["--resolve", resolve]
    args += [url]
    p = subprocess.run(args, capture_output=True, timeout=timeout + 3)
    if p.returncode != 0:
        raise RuntimeError(
            p.stderr.decode("utf-8", "replace").strip()
            or "curl falló: " + url
        )
    return p.stdout

def http_json(url, timeout=6, resolve=None):
    raw = http_bytes(url, timeout=timeout, resolve=resolve)
    return json.loads(raw.decode("utf-8"))

MUTATION_ORIGIN = None
ALLOWED_MUTATION_PATHS = {
    "/api/show",
    "/api/public-config",
    "/api/photos",
    "/api/queue/add",
    "/api/queue/played",
    "/api/queue/remove",
    "/api/queue/reorder",
    "/api/queue/clear",
    "/api/custom-songs",
    "/api/library",
}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("POST redirect bloqueado: %s -> %s" % (req.full_url, newurl))

NO_REDIRECT_OPENER = urllib.request.build_opener(NoRedirect)

def arm_sandbox_mutations(base):
    global MUTATION_ORIGIN
    p = urllib.parse.urlsplit(base)
    if p.scheme != "http" or p.hostname != "127.0.0.1" or p.port in (None, 8788):
        raise RuntimeError("origen sandbox inseguro: %s" % base)
    MUTATION_ORIGIN = "http://127.0.0.1:%d" % p.port

def disarm_sandbox_mutations():
    global MUTATION_ORIGIN
    MUTATION_ORIGIN = None

def post_json(url, payload, timeout=6):
    # Cinturón de seguridad: un POST es imposible hasta que el sandbox haya
    # demostrado su SQLite temporal. Producción :8788 nunca es un destino válido.
    p = urllib.parse.urlsplit(url)
    origin = "%s://%s:%s" % (p.scheme, p.hostname, p.port)
    if MUTATION_ORIGIN is None:
        raise RuntimeError("POST BLOQUEADO: sandbox no armado")
    if origin != MUTATION_ORIGIN:
        raise RuntimeError("POST BLOQUEADO fuera del sandbox: %s" % url)
    if p.path not in ALLOWED_MUTATION_PATHS:
        raise RuntimeError("POST BLOQUEADO a endpoint no autorizado: %s" % p.path)

    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=raw,
        method="POST",
        headers={"Content-Type": "application/json"}
    )
    try:
        with NO_REDIRECT_OPENER.open(req, timeout=timeout) as r:
            body = r.read()
            return r.status, json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            data = json.loads(body.decode("utf-8"))
        except Exception:
            data = {"raw": body.decode("utf-8", "replace")}
        return e.code, data

def get_json(url, timeout=6):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode("utf-8"))

def proc_running(pattern):
    p = run(["/usr/bin/pgrep", "-f", pattern], timeout=5)
    return p.returncode == 0 and bool(p.stdout.strip())

def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return int(port)

def parse_static_assets(sw_path):
    s = text(sw_path)
    m = re.search(r'const\s+STATIC_ASSETS\s*=\s*\[(.*?)\];', s, re.S)
    if not m:
        raise RuntimeError("STATIC_ASSETS no encontrado")
    out = set()
    for raw in re.findall(r'["\']([^"\']+)["\']', m.group(1)):
        raw = raw.split("?", 1)[0].split("#", 1)[0].strip()
        if raw.startswith("./"):
            raw = raw[2:]
        if not raw or raw in (".", "/"):
            continue
        if raw.startswith(("http://", "https://", "data:", "about:")):
            continue
        out.add(raw)
    return out

def html_deps(path, prefix=""):
    s = text(path)
    out = set()
    for raw in re.findall(r'(?:src|href)="([^"]+)"', s):
        raw = raw.split("?", 1)[0].split("#", 1)[0].strip()
        if raw.startswith(("http://", "https://", "data:", "about:", "#")):
            continue
        if raw.startswith("./"):
            raw = raw[2:]
        if raw.startswith("../"):
            raw = raw[3:]
        elif prefix and raw:
            raw = prefix.rstrip("/") + "/" + raw
        if raw:
            out.add(raw)
    return out

def check_code_syntax_python(path, rid, label):
    try:
        compile(text(path), str(path), "exec")
        pass_(rid, label)
    except Exception as e:
        fail(rid, label, e)

def check_node_syntax(paths):
    node = shutil.which("node")
    if not node:
        skip("JS900", "Sintaxis JavaScript con Node", "Node no instalado; no es requisito")
        return
    bad = []
    for p in paths:
        r = run([node, "--check", str(p)], timeout=20)
        if r.returncode != 0:
            bad.append("%s: %s" % (p.name, (r.stderr or r.stdout).strip()))
    if bad:
        fail("JS900", "Sintaxis JavaScript con Node", " | ".join(bad[:5]))
    else:
        pass_("JS900", "Sintaxis JavaScript con Node", "%d archivos" % len(paths))

def api_schema_live():
    # SOLO GETs reales del Core de producción. /api/public-config es POST-only;
    # su lectura canónica está en /api/state["publicConfig"] y su escritura se
    # prueba de forma destructiva únicamente contra el sandbox temporal.
    endpoints = {
        "LIVE001": ("/api/health", ["ok", "build"]),
        "LIVE002": ("/api/state", ["ok", "show", "queue", "publicConfig"]),
        "LIVE003": ("/api/catalog/status", ["ok", "songs", "logicMaps"]),
        "LIVE004": ("/api/custom-songs", ["ok", "customSongs"]),
        "LIVE005": ("/api/photos", ["ok", "photos"]),
        "LIVE006": ("/api/bridge/state", ["ok", "show", "queue"]),
        "LIVE007": ("/api/connectivity", ["ok", "mode"]),
        "LIVE008": ("/api/changes?limit=1", ["ok", "changes"]),
        "LIVE009": ("/api/catalog", ["ok", "songs"]),
    }
    for rid, (ep, keys) in endpoints.items():
        try:
            d = http_json("http://127.0.0.1:8788" + ep, timeout=5)
            missing = [k for k in keys if k not in d]
            if d.get("ok") is True and not missing:
                pass_(rid, "Core vivo " + ep)
            else:
                fail(rid, "Core vivo " + ep, "faltan %s / ok=%r" % (missing, d.get("ok")))
        except Exception as e:
            fail(rid, "Core vivo " + ep, e)

def sandbox_core_tests():
    rid_prefix = "SBX"
    temp = Path(tempfile.mkdtemp(prefix="egp-regresion-core-"))
    proc = None
    stdout = None
    stderr = None
    disarm_sandbox_mutations()
    try:
        root = temp / "LocalCore"
        root.mkdir(parents=True, exist_ok=True)

        shutil.copy2(CORE, root / "egp_local_core.py")

        for name in ("data", "catalogo"):
            src = LOCALCORE_DIR / name
            if not src.is_dir():
                fail(rid_prefix + "001", "Preparar sandbox Core", "falta " + str(src))
                return
            shutil.copytree(src, root / name)

        # Directorios que el servidor conoce pero no necesitamos poblar para mutaciones.
        (root / "panel-real").mkdir(exist_ok=True)
        (root / "web").mkdir(exist_ok=True)

        srcfile = root / "egp_local_core.py"
        s = srcfile.read_text(encoding="utf-8")

        replacements = {
            '/tmp/egp-bridge-current-id': str(temp / "bridge-current-id"),
            '/tmp/egp-bridge-hidden-current': str(temp / "bridge-hidden-current"),
            '/tmp/egp-bridge-song-playing': str(temp / "bridge-song-playing"),
            '/tmp/egp-local-core.pid': str(temp / "local-core.pid"),
            '/tmp/egp-local-core.log': str(temp / "local-core.log"),
            '/tmp/egp-cloud-sync-status.json': str(temp / "cloud-sync-status.json"),
        }
        for a, b in replacements.items():
            s = s.replace(a, b)
        srcfile.write_text(s, encoding="utf-8")

        port = free_port()
        https_port = free_port()
        while https_port == port:
            https_port = free_port()

        env = os.environ.copy()
        env["EGP_LOCAL_DATA_DIR"] = str(temp / "runtime-data")
        env["EGP_LOCAL_PORT"] = str(port)
        env["EGP_LOCAL_HTTPS_PORT"] = str(https_port)
        env["EGP_LOCAL_TLS_IP"] = "127.0.0.1"

        stdout = (temp / "stdout.log").open("wb")
        stderr = (temp / "stderr.log").open("wb")
        proc = subprocess.Popen(
            ["/usr/bin/python3", str(srcfile)],
            cwd=str(root),
            env=env,
            stdout=stdout,
            stderr=stderr
        )

        base = "http://127.0.0.1:%d" % port
        ready = False
        for _ in range(60):
            if proc.poll() is not None:
                break
            try:
                status, d = get_json(base + "/api/health", timeout=1)
                if status == 200 and d.get("ok") is True:
                    ready = True
                    break
            except Exception:
                time.sleep(0.2)

        if not ready:
            try:
                stderr.close(); stdout.close()
            except Exception:
                pass
            err = ""
            try:
                err = (temp / "stderr.log").read_text(encoding="utf-8", errors="replace")[-1500:]
            except Exception:
                pass
            fail(rid_prefix + "001", "Arranque Core aislado", err or "no respondió")
            return

        pass_(rid_prefix + "001", "Arranque Core aislado", "puerto %d" % port)

        # PUERTA DURA DE AISLAMIENTO — ANTES DEL PRIMER POST.
        # No basta con haber enviado EGP_LOCAL_DATA_DIR: el Core debe demostrar
        # por /api/health qué DB abrió realmente. Si no puede demostrarlo,
        # abortamos el sandbox SIN UNA SOLA MUTACION.
        if port == 8788:
            fail(rid_prefix + "002", "Puerta aislamiento pre-mutación", "puerto de producción 8788")
            return

        try:
            _, health = get_json(base + "/api/health", timeout=2)
            db_raw = str(health.get("db") or "").strip()
            if not db_raw:
                fail(rid_prefix + "002", "Puerta aislamiento pre-mutación", "/api/health no declara db")
                return

            db_path = Path(db_raw)
            if not db_path.is_absolute():
                db_path = root / db_path

            db_real = Path(os.path.realpath(str(db_path)))
            temp_real = Path(os.path.realpath(str(temp)))
            prod_real = Path(os.path.realpath(str(SQLITE)))
            try:
                inside_temp = os.path.commonpath([str(db_real), str(temp_real)]) == str(temp_real)
            except ValueError:
                inside_temp = False

            if not inside_temp or db_real == prod_real:
                fail(
                    rid_prefix + "002",
                    "Puerta aislamiento pre-mutación",
                    "DB insegura: %s / producción=%s" % (db_real, prod_real)
                )
                return

            # Segunda barrera cuando lsof está disponible: el proceso sandbox no
            # puede tener abierta la SQLite viva. No exigimos que mantenga abierta
            # la DB temporal porque sqlite puede abrir/cerrar por operación.
            lsof = shutil.which("lsof")
            if lsof:
                lp = run([lsof, "-p", str(proc.pid), "-Fn"], timeout=5)
                open_names = [x[1:] for x in lp.stdout.splitlines() if x.startswith("n")]
                if str(prod_real) in [os.path.realpath(x) for x in open_names if x]:
                    fail(rid_prefix + "002", "Puerta aislamiento pre-mutación", "proceso abrió SQLite producción")
                    return

            arm_sandbox_mutations(base)
            pass_(rid_prefix + "002", "Puerta aislamiento pre-mutación", str(db_real))
        except Exception as e:
            fail(rid_prefix + "002", "Puerta aislamiento pre-mutación", e)
            return

        # Limpiar estado SOLO del sandbox, ahora que los POST quedaron armados.
        st, d = post_json(base + "/api/show", {
            "active": False,
            "venue": "",
            "show_session_id": "regresion-reset"
        })
        st2, d2 = post_json(base + "/api/queue/clear", {})
        if st == 200 and d.get("ok") is True and st2 == 200 and d2.get("ok") is True:
            pass_(rid_prefix + "003", "Reset sandbox")
        else:
            fail(rid_prefix + "003", "Reset sandbox", "%s %s / %s %s" % (st, d, st2, d2))

        # Show A.
        st, a = post_json(base + "/api/show", {
            "active": True,
            "venue": "REGRESION A",
            "show_id": "reg-1001",
            "show_session_id": "reg-session-A",
            "inicio_show": 1001,
            "show_writer": "regresion-v1"
        })
        pc = a.get("publicConfig") or {}
        if st == 200 and a.get("ok") is True and (a.get("show") or {}).get("active") is True and pc.get("show_session_id") == "reg-session-A":
            pass_(rid_prefix + "004", "Iniciar un show")
        else:
            fail(rid_prefix + "004", "Iniciar un show", a)

        # Segundo show debe bloquearse.
        st, b = post_json(base + "/api/show", {
            "active": True,
            "venue": "REGRESION B",
            "show_id": "reg-2002",
            "show_session_id": "reg-session-B",
            "inicio_show": 2002,
            "show_writer": "regresion-v1"
        })
        if st == 200 and b.get("ok") is False and b.get("error") == "SHOW_ALREADY_ACTIVE" and b.get("show_session_id") == "reg-session-A":
            pass_(rid_prefix + "005", "Bloquear segundo show simultáneo")
        else:
            fail(rid_prefix + "005", "Bloquear segundo show simultáneo", b)

        # Confirmar que sigue A.
        _, state = get_json(base + "/api/state")
        pc = state.get("publicConfig") or {}
        if (state.get("show") or {}).get("active") is True and pc.get("show_session_id") == "reg-session-A":
            pass_(rid_prefix + "006", "Autoridad conserva sesión original")
        else:
            fail(rid_prefix + "006", "Autoridad conserva sesión original", state)

        # /api/public-config es POST-only. Su lectura canónica es /api/state.publicConfig.
        pst, pcw = post_json(base + "/api/public-config", {
            "show_active": True,
            "show_id": "reg-1001",
            "show_session_id": "reg-session-A",
            "mostrar_cola": True,
            "repertorio_nombre": "REGRESION V1",
            "show_writer": "regresion-v1"
        })
        _, pcs = get_json(base + "/api/state")
        pcr = pcs.get("publicConfig") or {}
        if (
            pst == 200 and pcw.get("ok") is True
            and pcr.get("show_session_id") == "reg-session-A"
            and pcr.get("mostrar_cola") is True
            and pcr.get("repertorio_nombre") == "REGRESION V1"
        ):
            pass_(rid_prefix + "007", "PublicConfig POST + lectura por /api/state")
        else:
            fail(rid_prefix + "007", "PublicConfig POST + lectura por /api/state", "%s / %s" % (pcw, pcr))

        # Catálogo sandbox debe estar importado y contener canciones mapeadas.
        _, cst = get_json(base + "/api/catalog/status")
        _, cat = get_json(base + "/api/catalog?limit=500")
        mapped = next((x for x in (cat.get("songs") or []) if x.get("mapped") is True), None)
        if cst.get("ok") is True and int(cst.get("songs") or 0) > 0 and int(cst.get("logicMaps") or 0) > 0 and mapped:
            pass_(rid_prefix + "008", "Catálogo + logic_map disponibles", "%s/%s" % (cst.get("songs"), cst.get("logicMaps")))
        else:
            fail(rid_prefix + "008", "Catálogo + logic_map disponibles", "%s / mapped=%s" % (cst, bool(mapped)))

        # Cola: agregar dos.
        _, q1 = post_json(base + "/api/queue/add", {"id": "reg-a", "number": "901", "title": "REG A"})
        _, q2 = post_json(base + "/api/queue/add", {"id": "reg-b", "number": "902", "title": "REG B"})
        ids = [str(x.get("id")) for x in (q2.get("queue") or [])]
        if ids[-2:] == ["reg-a", "reg-b"]:
            pass_(rid_prefix + "009", "Cola agregar")
        else:
            fail(rid_prefix + "009", "Cola agregar", ids)

        # Reordenar.
        _, qr = post_json(base + "/api/queue/reorder", {"order": ["reg-b", "reg-a"]})
        ids = [str(x.get("id")) for x in (qr.get("queue") or [])]
        if ids[:2] == ["reg-b", "reg-a"]:
            pass_(rid_prefix + "010", "Cola reordenar")
        else:
            fail(rid_prefix + "010", "Cola reordenar", ids)

        # Tocada.
        _, qp = post_json(base + "/api/queue/played", {"id": "reg-b", "played": True})
        row = next((x for x in (qp.get("queue") or []) if x.get("id") == "reg-b"), None)
        if row and row.get("played") is True:
            pass_(rid_prefix + "011", "Cola Tocada")
        else:
            fail(rid_prefix + "011", "Cola Tocada", row)

        # Eliminar.
        _, qrm = post_json(base + "/api/queue/remove", {"id": "reg-b"})
        ids = [str(x.get("id")) for x in (qrm.get("queue") or [])]
        if "reg-b" not in ids and "reg-a" in ids:
            pass_(rid_prefix + "012", "Cola eliminar")
        else:
            fail(rid_prefix + "012", "Cola eliminar", ids)

        # Error controlado.
        est, ebody = post_json(base + "/api/queue/played", {"id": "no-existe-reg", "played": True})
        if est == 400 and ebody.get("ok") is False:
            pass_(rid_prefix + "013", "API rechaza Tocada inexistente")
        else:
            fail(rid_prefix + "013", "API rechaza Tocada inexistente", "%s %s" % (est, ebody))

        # Clear y resolve-next EMPTY.
        _, qc = post_json(base + "/api/queue/clear", {})
        _, rn = get_json(base + "/api/resolve-next")
        if qc.get("ok") is True and not qc.get("queue") and rn.get("status") == "EMPTY":
            pass_(rid_prefix + "014", "Vaciar cola + resolve-next EMPTY")
        else:
            fail(rid_prefix + "014", "Vaciar cola + resolve-next EMPTY", "%s / %s" % (qc, rn))

        # resolve-next con una canción realmente mapeada del catálogo.
        if mapped:
            _, mq = post_json(base + "/api/queue/add", {
                "id": str(mapped.get("id")),
                "number": "903",
                "title": str(mapped.get("title") or "REG MAPPED")
            })
            _, mr = get_json(base + "/api/resolve-next")
            if mr.get("ok") is True and mr.get("songId") == str(mapped.get("id")) and mr.get("status") in ("OK", "MISSING"):
                pass_(rid_prefix + "015", "resolve-next resuelve canción mapeada", mr.get("status"))
            else:
                fail(rid_prefix + "015", "resolve-next resuelve canción mapeada", mr)
            post_json(base + "/api/queue/clear", {})
        else:
            fail(rid_prefix + "015", "resolve-next resuelve canción mapeada", "sin canción mapeada para probar")

        # Custom song sandbox.
        cid = "custom-regresion-v1"
        _, cs = post_json(base + "/api/custom-songs", {
            "customSongs": [{
                "id": cid,
                "titulo": "REGRESION CUSTOM",
                "artista": "EGP"
            }]
        })
        _, csget = get_json(base + "/api/custom-songs")
        ids = [str(x.get("id")) for x in (csget.get("customSongs") or [])]
        if cs.get("ok") is True and cid in ids:
            pass_(rid_prefix + "016", "Custom songs escribir/leer")
        else:
            fail(rid_prefix + "016", "Custom songs escribir/leer", ids)

        # Fotos sandbox: escribir y leer sin tocar Storage/Firebase ni SQLite viva.
        photo_value = {"url": "egp-regresion://sandbox", "marker": "REGRESION_V1"}
        _, phw = post_json(base + "/api/photos", {"photos": {"portada__desktop": photo_value}})
        _, phr = get_json(base + "/api/photos")
        got_photo = (phr.get("photos") or {}).get("portada__desktop")
        if phw.get("ok") is True and got_photo == photo_value:
            pass_(rid_prefix + "017", "Fotos escribir/leer en sandbox")
        else:
            fail(rid_prefix + "017", "Fotos escribir/leer en sandbox", "%s / %s" % (phw, got_photo))

        # Changes deben registrar mutaciones.
        _, ch = get_json(base + "/api/changes?limit=100")
        if ch.get("ok") is True and len(ch.get("changes") or []) >= 8:
            pass_(rid_prefix + "018", "Changes registra mutaciones", len(ch.get("changes") or []))
        else:
            fail(rid_prefix + "018", "Changes registra mutaciones", ch)

        # Finalizar show.
        _, fin = post_json(base + "/api/show", {
            "active": False,
            "venue": "",
            "show_session_id": "reg-session-A",
            "show_id": "reg-1001"
        })
        pc = fin.get("publicConfig") or {}
        if fin.get("ok") is True and (fin.get("show") or {}).get("active") is False and int(pc.get("inicio_show") or 0) == 0:
            pass_(rid_prefix + "019", "Finalizar show limpia estado activo")
        else:
            fail(rid_prefix + "019", "Finalizar show limpia estado activo", fin)

        # Confirmar nuevamente al final que el Core siguió usando la DB aislada.
        h = http_json(base + "/api/health")
        db_end_raw = str(h.get("db") or "").strip()
        db_end = Path(os.path.realpath(str((root / db_end_raw) if db_end_raw and not Path(db_end_raw).is_absolute() else db_end_raw))) if db_end_raw else None
        if db_end is not None and db_end == db_real and db_end != prod_real:
            pass_(rid_prefix + "020", "Mutaciones permanecieron aisladas", str(db_end))
        else:
            fail(rid_prefix + "020", "Mutaciones permanecieron aisladas", str(db_end_raw))

    except Exception as e:
        fail(rid_prefix + "999", "Sandbox Core", "%s: %s" % (type(e).__name__, e))
    finally:
        disarm_sandbox_mutations()
        if proc is not None:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        for fh in (stdout, stderr):
            try:
                if fh is not None:
                    fh.close()
            except Exception:
                pass
        try:
            shutil.rmtree(temp)
        except Exception:
            pass

def save_report():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "schema": 1,
        "tool": "EGP-REGRESION-V1",
        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "results": RESULTS,
        "summary": {}
    }
    counts = {}
    for r in RESULTS:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    data["summary"] = counts
    p = REPORT_DIR / "last-report.json"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return p, counts

def main():
    emit("============================================================")
    emit(" EGP REGRESION V1")
    emit(" PRODUCCION: SOLO LECTURA")
    emit(" MUTACIONES: SOLO EN CORE SANDBOX TEMPORAL")
    emit("============================================================")

    # 1. Infraestructura básica.
    emit("")
    emit("=== 1. BASE / FUENTES / VERSIONADO ===")

    if (REPO / ".git").is_dir():
        pass_("BASE001", "Repo fuerte existe")
    else:
        fail("BASE001", "Repo fuerte existe", str(REPO))

    branch = run(["git", "-C", str(REPO), "branch", "--show-current"])
    if branch.returncode == 0 and branch.stdout.strip() == "main":
        pass_("BASE002", "Branch main")
    else:
        fail("BASE002", "Branch main", branch.stdout.strip())

    head = run(["git", "-C", str(REPO), "rev-parse", "HEAD"])
    remote = run(["git", "-C", str(REPO), "ls-remote", "origin", "refs/heads/main"])
    lh = head.stdout.strip() if head.returncode == 0 else ""
    rh = remote.stdout.strip().split()[0] if remote.returncode == 0 and remote.stdout.strip() else ""
    if lh and rh and lh == rh:
        pass_("BASE003", "HEAD local = GitHub/main", lh)
    else:
        fail("BASE003", "HEAD local = GitHub/main", "local=%s remoto=%s" % (lh, rh))

    status = run(["git", "-C", str(REPO), "status", "--porcelain"])
    allow_candidate_dirty = os.environ.get("EGP_REGRESION_ALLOW_DIRTY_CANDIDATE") == "1"
    if status.returncode == 0 and not status.stdout.strip():
        pass_("BASE004", "Repo limpio")
    elif allow_candidate_dirty:
        pass_("BASE004", "Repo candidato controlado por instalador", "cambios esperados antes del commit")
    else:
        warn("BASE004", "Repo limpio", "hay cambios en desarrollo; revisar antes de publicar")

    # 2. Código crítico.
    emit("")
    emit("=== 2. CONTRATOS DE CODIGO CRITICO ===")

    files_required = [
        REPO / "panel.html",
        REPO / "panel.js",
        REPO / "pwa.js",
        REPO / "service-worker-6.36.103.js",
        REPO / "musicos/index.html",
        REPO / "musicos/app.js",
        REPO / "musicos/service-worker.js",
        REPO / "script.js",
        REPO / "egp-system/variants/caddy-public/script.js",
        REPO / "egp-system/runtime/core/egp_local_core.py",
        REPO / "egp-system/runtime/cloud-sync/egp_cloud_sync.py",
        REPO / "egp-system/runtime/caddy/Caddyfile",
    ]
    missing = [str(p) for p in files_required if not p.is_file()]
    if not missing:
        pass_("SRC001", "Archivos críticos presentes")
    else:
        fail("SRC001", "Archivos críticos presentes", " | ".join(missing))

    checks = [
        ("PNL001", REPO/"panel.html", ["EGP_BOOTSTRAP_AUTHORITY_GATE_V2"], "Panel gate de autoridad antes de pintar"),
        ("PNL002", REPO/"panel.js", ["EGP_SINGLE_SHOW_PANEL_GUARD_V2", "CORE_SYNC_STALE"], "Panel guard de un solo show"),
        ("PNL003", REPO/"panel.js", ["EGP_AUTONOMOUS_CORE_FIREBASE_SYNC_V2"], "Panel no compite con Cloud Sync"),
        ("PNL004", REPO/"panel.js", ["EGP_FAILOVER_VISUAL_STABILITY_V2"], "Failover no repinta estado viejo"),
        ("PNL005", REPO/"panel.js", ["EGP_CORE_SHOW_AUTHORITY_V1"], "Core conserva autoridad de show en LAN"),
        ("PNL006", REPO/"panel.js", ["EGP_DEVICE_CORE_FIREBASE_RELAY_V1", "EGP_DEVICE_RELAY_HEARTBEAT_V1", "core_sync_heartbeat", "core_sync_host", "pedidos_panel_lista"], "Panel puede relevar Core completo a Firebase sin cambiar autoridad"),
        ("PNL009", REPO/"panel.js", ["EGP_INSTALLED_PWA_AUTH_BYPASS_V1", "egpInstalledPwaContextV1", "display-mode: standalone", "navigator.standalone", "android-app://"], "PWA instalada puede saltar login por contexto standalone"),
        ("PWA003", REPO/"panel.html", ["EGP_INSTALLED_PWA_AUTH_BOOT_V1", "egp-installed-pwa", "display-mode: standalone", "navigator.standalone"], "PWA oculta login desde bootstrap sin flash"),
        # EGP_REG_CORE_FIRST_STARTUP_V1
        ("PNL011", REPO/"panel.js", ["EGP_CORE_FIRST_STARTUP_V1", "if(startup){", "coreResult=await egpReadCoreAuthorityV2()", "queueMicrotask", "remoteResult=await egpReadFirebaseAuthorityV2()"], "Arranque Panel prioriza Core y no espera Firebase"),
        # EGP_REG_SHOW_SYNC_REAL_PROGRESS_V1
        ("PWA005", REPO/"panel.html", ["EGP_SHOW_SYNC_PROGRESS_V1", "EGP_SHOW_SYNC_REAL_PROGRESS_STYLE_V1", "egp-show-sync-track", "egp-show-sync-fill"], "Sincronizando show usa barra funcional por etapas"),
        ("PNL012", REPO/"panel.js", ["EGP_SHOW_SYNC_REAL_PROGRESS_V1", "Buscando conexión por Internet", "Conectando con Firebase", "Leyendo estado del show", "Estado recibido", "Aplicando estado del show"], "Progreso de Internet ligado a hitos reales"),
        # EGP_REG_PUBLICIDAD_CONFIG_DOM_V2
        ("PNL013", REPO/"panel.js", ["EGP_PUBLICIDAD_CONFIG_DOM_V2", "publicidadConfigGroup", "appendChild(adCard)", "appendChild(profileField)"], "Publicidad mueve físicamente controles en orden"),
        ("PNL014", REPO/"panel.js", ["EGP_REPERTORIO_PRINCIPAL_DIARIO_DEFAULT_V2", "EGP_REPERTORIO_PRINCIPAL_DIARIO_BUILD_V3", "principalDiarioOption", "savedExists", "principal diario"], "Principal Diario se decide dentro de buildRepertoires sin depender de timing"),
        # EGP_REG_REPERTOIRES_FULL_SYNC_V1
        ("PNL018", REPO/"panel.js", ["EGP_REPERTOIRES_FULL_SYNC_V1", "/api/library", "customRepertoires", "EGP_REPERTOIRES_CORE_LIVE_SYNC_V1"], "Repertorios guardan biblioteca completa y reflejan Core"),
        ("CORE021", REPO/"egp-system/runtime/core/egp_local_core.py", ["EGP_LIBRARY_CORE_V1", "def library_snapshot()", "def write_library_state(data)", "/api/library"], "Core persiste biblioteca completa"),
        ("CLD021", REPO/"egp-system/runtime/cloud-sync/egp_cloud_sync.py", ["EGP_LIBRARY_BIDIRECTIONAL_SYNC_V1", "egp_sync_library_bidirectional", "biblioteca_updated_at"], "Cloud Sync reconcilia biblioteca"),
        ("PUB021", REPO/"script.js", ["EGP_PUBLIC_LIBRARY_CORE_SYNC_V1", "/__egp_core/api/library", "repertoriosRemotosNombres"], "Carta 2 refleja repertorios desde Core"),
        ("PNL015", REPO/"panel.html", ["EGP_PUBLICIDAD_CONFIG_DOM_V2_STYLE", "publicidadConfigHeader", "publicidadConfigBody"], "Desplegable Publicidad estilizado"),
        # EGP_REG_STATIC_CONFIG_BOOT_V3
        ("PNL016", REPO/"panel.html", ["EGP_PUBLICIDAD_CONFIG_STATIC_V3", "publicidadConfigGroup", "advertisingToggle", "profileSelect"], "Publicidad existe físicamente en HTML"),
        # EGP_REG_PUBLICIDAD_MATCH_PEDIDOS_V2
        ("PNL017", REPO/"panel.html", ["EGP_PUBLICIDAD_MATCH_PEDIDOS_V2", "#configView #pedidosConfigGroup,", "#configView #publicidadConfigGroup{", "grid-column:1!important", "justify-self:stretch!important"], "Publicidad usa misma caja que Pedidos"),
        ("PWA006", REPO/"panel.html", ["EGP_BOOT_LOADER_FIRST_PIXEL_V3", "EGP_BOOT_LOADER_FIRST_PIXEL_V3_STYLE", "egpShowSyncOverlayV1", "Iniciando Panel"], "Loader existe desde el primer HTML"),
        # EGP_REG_PUBLIC_NO_FLICKER_V1
        ("PWA007", REPO/"script.js", ["EGP_PUBLIC_UI_NO_FLICKER_V1", "egpFirmaVisualListaPublica", "egpFirmaVisualEstadoPublico", "renderizar(false)", "firmaRenderPublico", "firmaEstadoPublico"], "Web pública evita rerender y animación en sincronización idéntica"),
        ("PWA001", REPO/"pwa.js", ["registrationRef.update()", "controllerchange", "SKIP_WAITING", "updateViaCache"], "Panel auto-update PWA"),
        ("PWA002", REPO/"service-worker-6.36.103.js", ["skipWaiting", "clients.claim", "networkFirst", "ignoreSearch"], "Panel SW actualización/offline"),
        ("MUS001", REPO/"musicos/app.js", ['const LOCAL_CORE = "https://core.elenagirjoaba.com"', "firebaseOnline", "latestFirebaseState"], "Músicos Core primero + Firebase fallback"),
        ("MUS002", REPO/"musicos/app.js", ["saveLastState", "loadLastState"], "Músicos último estado offline"),
        ("MUS003", REPO/"musicos/app.js", ["serviceWorker.register", 'updateViaCache: "none"', "registration.update"], "Músicos auto-update SW"),
        ("MUS004", REPO/"musicos/index.html", ["monitorSetup", "egpUi24rOverlay", "ui.elenagirjoaba.com"], "Músicos monitoreo Ui24R"),
        ("MUS005", REPO/"musicos/service-worker.js", ["skipWaiting", "clients.claim", "egp-musicos-"], "Músicos SW limpia versiones viejas"),
        ("MUS006", REPO/"musicos/app.js", ["EGP_MUSICOS_CORE_FIREBASE_RELAY_V1", "egpMusicosMirrorCoreToFirebase", "core_sync_heartbeat", "core_sync_host", "pedidos_panel_lista"], "Músicos puede relevar Core completo a Firebase"),
        ("PUB001", REPO/"egp-system/variants/caddy-public/script.js", ["lanAutoritativa", "EGP_CORE_PUBLIC_URL", "/__egp_core", "/__egp_lan"], "Cliente Caddy prioriza LAN/Core"),
        ("COR001", REPO/"egp-system/runtime/core/egp_local_core.py", ["EGP_SINGLE_SHOW_SESSION_GUARD_V2", "EGP_UNIFIED_SHOW_STATE_CORE_V1"], "Core un solo show + estado unificado"),
        ("COR002", REPO/"egp-system/runtime/core/egp_local_core.py", ["/api/queue/add", "/api/queue/played", "/api/queue/remove", "/api/queue/reorder", "/api/queue/clear"], "Core endpoints de cola"),
        ("COR003", REPO/"egp-system/runtime/core/egp_local_core.py", ["/api/custom-songs", "/api/photos", "/api/bridge/state", "/api/resolve-next", "/api/public-config", "/api/catalog"], "Core endpoints auxiliares"),
        ("SYN001", REPO/"egp-system/runtime/cloud-sync/egp_cloud_sync.py", ["EGP_BIDIRECTIONAL_SHOW_SYNC_V2", "SYNC TOTAL BIDIRECCIONAL V2"], "Cloud Sync bidireccional V2"),
    ]

    for rid, path, tokens, label in checks:
        if not path.is_file():
            fail(rid, label, "archivo ausente")
            continue
        miss = contains_all(path, tokens)
        if miss:
            fail(rid, label, "faltan: " + ", ".join(miss))
        else:
            pass_(rid, label)

    # EGP_REG_RELAY_INTERNET_V1
    # El relay es SOLO Core -> Firebase; el puente bidireccional viejo del
    # Panel debe seguir desactivado por EGP_AUTONOMOUS_CORE_FIREBASE_SYNC_V2.
    try:
        panel_text=(REPO/"panel.js").read_text(encoding="utf-8")
        musicos_text=(REPO/"musicos/app.js").read_text(encoding="utf-8")
        if (
            "const EGP_AUTONOMOUS_CORE_FIREBASE_SYNC_V2=true;" in panel_text and
            "const EGP_DEVICE_CORE_FIREBASE_RELAY_V1=true;" in panel_text and
            "function egpMirrorCoreSnapshotToFirebase(snapshot){\n    if(!EGP_DEVICE_CORE_FIREBASE_RELAY_V1)return;" in panel_text
        ):
            pass_("PNL007", "Relay Panel no reactiva puente bidireccional antiguo")
        else:
            fail("PNL007", "Relay Panel no reactiva puente bidireccional antiguo")

        required_fields=[
            "lista_activa", "repertorio_activo_ids", "show_activo",
            "show_session_id", "pedidos_whatsapp", "pedidos_panel",
            "pedidos_modo", "mostrar_cola", "cronometro_elapsed_ms",
            "cronometro_running", "cola", "tocadas",
            "core_sync_heartbeat", "core_sync_host"
        ]
        missing_panel=[x for x in required_fields if x not in panel_text]
        missing_mus=[x for x in required_fields if x not in musicos_text]
        if not missing_panel:
            pass_("PNL008", "Relay Panel conserva contrato completo Core -> Firebase")
        else:
            fail("PNL008", "Relay Panel conserva contrato completo Core -> Firebase", ", ".join(missing_panel))
        if not missing_mus:
            pass_("MUS007", "Relay Músicos conserva contrato completo Core -> Firebase")
        else:
            fail("MUS007", "Relay Músicos conserva contrato completo Core -> Firebase", ", ".join(missing_mus))
    except Exception as e:
        fail("PNL007", "Relay Panel no reactiva puente bidireccional antiguo", e)
        fail("PNL008", "Relay Panel conserva contrato completo Core -> Firebase", e)
        fail("MUS007", "Relay Músicos conserva contrato completo Core -> Firebase", e)

    # EGP_REG_INSTALLED_PWA_AUTH_V1
    # Regla fundamental:
    # - standalone instalado puede pasar sin contraseña;
    # - navegador normal NO recibe token persistente de bypass;
    # - la contraseña de navegador conserva el flujo existente por sessionStorage.
    try:
        panel_auth_text=(REPO/"panel.js").read_text(encoding="utf-8")
        panel_auth_html=(REPO/"panel.html").read_text(encoding="utf-8")
        installed_condition=(
            "egpInstalledPwaAuthBypassV1 || panelAuthSessionValid()" in panel_auth_text and
            "function panelAuthValid(){return egpInstalledPwaContextV1() || $('#panelLogin')?.hidden===true;}" in panel_auth_text and
            "EGP_INSTALLED_PWA_AUTH_RESUME_V1" in panel_auth_text
        )
        if installed_condition:
            pass_("PNL010", "PWA instalada salta puerta; navegador conserva login")
        else:
            fail("PNL010", "PWA instalada salta puerta; navegador conserva login")

        browser_safe=(
            "sessionStorage.setItem(PANEL_AUTH_SESSION_KEY,'1')" in panel_auth_text and
            "localStorage.setItem(PANEL_AUTH_SESSION_KEY" not in panel_auth_text and
            "if(installed)document.documentElement.classList.add('egp-installed-pwa')" in panel_auth_html
        )
        if browser_safe:
            pass_("PWA004", "Bypass PWA no se persiste ni autentica el navegador")
        else:
            fail("PWA004", "Bypass PWA no se persiste ni autentica el navegador")
    except Exception as e:
        fail("PNL010", "PWA instalada salta puerta; navegador conserva login", e)
        fail("PWA004", "Bypass PWA no se persiste ni autentica el navegador", e)

    # Python syntax without .pyc.
    check_code_syntax_python(REPO/"egp-system/runtime/core/egp_local_core.py", "SYN002", "Sintaxis Core Python")
    check_code_syntax_python(REPO/"egp-system/runtime/cloud-sync/egp_cloud_sync.py", "SYN003", "Sintaxis Cloud Sync Python")

    check_node_syntax([
        REPO/"panel.js",
        REPO/"pwa.js",
        REPO/"service-worker-6.36.103.js",
        REPO/"script.js",
        REPO/"musicos/app.js",
        REPO/"musicos/service-worker.js",
    ])

    # 3. Variant tracking.
    emit("")
    emit("=== 3. VARIANTES DECLARADAS ===")
    try:
        vm = json.loads(VARIANT_META.read_text(encoding="utf-8"))
        base_path = REPO / safe_rel(vm["base_source"])
        var_path = REPO / safe_rel(vm["variant_source"])
        base_ok = sha_file(base_path) == vm.get("base_source_sha256")
        var_ok = sha_file(var_path) == vm.get("variant_sha256")
        caddy_ok = sha_file(CADDY_WEB/"script.js") == vm.get("variant_sha256")
        if base_ok:
            pass_("VAR001", "Variante Caddy revisada contra script.js actual")
        else:
            fail("VAR001", "Variante Caddy revisada contra script.js actual", "script.js cambió; rebase/revisión obligatoria")
        if var_ok and caddy_ok:
            pass_("VAR002", "Variante Caddy publicada coincide con declarada")
        else:
            fail("VAR002", "Variante Caddy publicada coincide con declarada")
    except Exception as e:
        fail("VAR001", "Metadata variante Caddy", e)
        fail("VAR002", "Variante Caddy publicada coincide con declarada", e)

    # 4. Package alignment derived from current source, not just release.
    emit("")
    emit("=== 4. WEB / CADDY / LAN — MISMA FUNCION ===")
    try:
        assets = parse_static_assets(REPO/"service-worker-6.36.103.js")
        assets |= html_deps(REPO/"panel.html")
        assets |= html_deps(REPO/"musicos/index.html", prefix="musicos")
        assets |= {
            "panel-profile-switch-20260901.js",
            "gallery-panel-firebase-sync.js",
            "egp-photo-responsive.js",
            "musicos/limpiar.html",
        }
        assets = sorted(x for x in assets if x and not x.startswith("egp-system/"))

        caddy_bad = []
        lan_bad = []
        for rel in assets:
            src = REPO / rel
            if not src.is_file():
                caddy_bad.append((rel, "FUENTE AUSENTE"))
                lan_bad.append((rel, "FUENTE AUSENTE"))
                continue

            src_sha = sha_file(src)

            # Caddy script.js is a declared variant.
            if rel == "script.js":
                try:
                    vm = json.loads(VARIANT_META.read_text(encoding="utf-8"))
                    expected_caddy = vm["variant_sha256"]
                except Exception:
                    expected_caddy = ""
            else:
                expected_caddy = src_sha

            cp = CADDY_WEB / rel
            lp = LAN_WEB / rel

            if not cp.is_file() or sha_file(cp) != expected_caddy:
                caddy_bad.append((rel, "AUSENTE/DIFERENTE"))
            if not lp.is_file() or sha_file(lp) != src_sha:
                lan_bad.append((rel, "AUSENTE/DIFERENTE"))

        if allow_candidate_dirty:
            skip(
                "SURF001",
                "Caddy Web alineado con fuentes actuales",
                "candidato pre-deploy: producción conserva release certificada anterior"
            )
            skip(
                "SURF002",
                "LAN Web alineado con fuentes actuales",
                "candidato pre-deploy: producción conserva release certificada anterior"
            )
        else:
            if not caddy_bad:
                pass_("SURF001", "Caddy Web alineado con fuentes actuales", "%d archivos" % len(assets))
            else:
                fail("SURF001", "Caddy Web alineado con fuentes actuales", str(caddy_bad[:12]))

            if not lan_bad:
                pass_("SURF002", "LAN Web alineado con fuentes actuales", "%d archivos" % len(assets))
            else:
                fail("SURF002", "LAN Web alineado con fuentes actuales", str(lan_bad[:12]))

    except Exception as e:
        fail("SURF001", "Caddy Web alineado con fuentes actuales", e)
        fail("SURF002", "LAN Web alineado con fuentes actuales", e)

    # Runtime canonical -> active.
    pairs = [
        ("SURF003", REPO/"egp-system/runtime/core/egp_local_core.py", CORE, "Core activo = canónico"),
        ("SURF004", REPO/"egp-system/runtime/cloud-sync/egp_cloud_sync.py", CLOUD_SYNC, "Cloud Sync activo = canónico"),
        ("SURF005", REPO/"egp-system/runtime/caddy/Caddyfile", CADDYFILE, "Caddyfile activo = canónico"),
    ]
    for rid, src, dst, label in pairs:
        try:
            if src.is_file() and dst.is_file() and sha_file(src) == sha_file(dst):
                pass_(rid, label)
            else:
                fail(rid, label)
        except Exception as e:
            fail(rid, label, e)

    # 5. Live read-only.
    emit("")
    emit("=== 5. PRODUCCION VIVA — SOLO LECTURA ===")
    api_schema_live()

    uid = str(os.getuid())
    p = run(["/bin/launchctl", "print", "gui/%s/com.egp.cloud-sync" % uid], timeout=6)
    if p.returncode == 0:
        pass_("LIVE101", "Cloud Sync LaunchAgent cargado")
    else:
        fail("LIVE101", "Cloud Sync LaunchAgent cargado")

    if proc_running("/Library/Application Support/EGP-Network/bin/caddy run"):
        pass_("LIVE102", "Caddy corriendo")
    else:
        fail("LIVE102", "Caddy corriendo")

    if LEGACY_BRIDGE_SYNC.is_file():
        if proc_running(str(LEGACY_BRIDGE_SYNC)):
            fail("LIVE103", "Legacy Bridge sync detenido", "CORRIENDO")
        else:
            pass_("LIVE103", "Legacy Bridge sync detenido")
    else:
        warn("LIVE103", "Legacy Bridge sync detenido", "archivo legacy no encontrado")

    # Caddy HTTPS real local.
    smoke = [
        ("LIVE104", "https://elenagirjoaba.com/panel.html", "elenagirjoaba.com:443:127.0.0.1", b"EGP_BOOTSTRAP_AUTHORITY_GATE_V2", "Panel Caddy carga"),
        ("LIVE105", "https://elenagirjoaba.com/musicos/index.html", "elenagirjoaba.com:443:127.0.0.1", b"EGP M", "Músicos Caddy carga"),
        ("LIVE106", "https://elenagirjoaba.com/script.js", "elenagirjoaba.com:443:127.0.0.1", b"EGP_CORE_PUBLIC_URL", "Cliente público Caddy usa variante LAN"),
        ("LIVE107", "https://core.elenagirjoaba.com/api/health", "core.elenagirjoaba.com:443:127.0.0.1", b"PERSISTENT_DB_V7", "Core HTTPS por Caddy"),
    ]
    for rid, url, resolve, needle, label in smoke:
        try:
            raw = http_bytes(url, resolve=resolve, timeout=6)
            if needle in raw:
                pass_(rid, label)
            else:
                fail(rid, label, "respuesta no contiene marcador esperado")
        except Exception as e:
            fail(rid, label, e)

    # Core direct static.
    direct = [
        ("LIVE108", "http://127.0.0.1:8788/panel/panel.html", b"EGP_BOOTSTRAP_AUTHORITY_GATE_V2", "Core sirve Panel"),
        ("LIVE109", "http://127.0.0.1:8788/panel/musicos/index.html", b"EGP M", "Core sirve Músicos"),
        ("LIVE110", "http://127.0.0.1:8788/panel/egp-photo-responsive.js", b"EGP FOTO RESPONSIVE", "Core sirve photo-responsive"),
    ]
    for rid, url, needle, label in direct:
        try:
            raw = http_bytes(url)
            if needle in raw:
                pass_(rid, label)
            else:
                fail(rid, label, "marcador ausente")
        except Exception as e:
            fail(rid, label, e)

    # Caddy config syntax if possible. El binario activo puede estar protegido
    # contra ejecución directa del usuario; eso no es una regresión si ya pasaron
    # hash canónico + proceso vivo + smoke tests HTTPS.
    if CADDY_BIN.is_file() and os.access(str(CADDY_BIN), os.X_OK):
        cmd = [str(CADDY_BIN), "validate", "--config", str(CADDYFILE), "--adapter", "caddyfile"]
        if CADDY_ENV.is_file():
            cmd += ["--envfile", str(CADDY_ENV)]
        try:
            cv = run(cmd, timeout=15)
            if cv.returncode == 0:
                pass_("LIVE111", "Caddyfile valida con Caddy")
            else:
                warn("LIVE111", "Caddyfile valida con Caddy", (cv.stderr or cv.stdout).strip()[:500])
        except Exception as e:
            warn("LIVE111", "Caddyfile valida con Caddy", e)
    elif CADDY_BIN.is_file():
        skip("LIVE111", "Caddyfile validate directo", "binario protegido; runtime/hash/HTTPS se validan por reglas separadas")
    else:
        fail("LIVE111", "Caddy binario presente", "binario no encontrado")

    # 6. Bridge contract.
    emit("")
    emit("=== 6. BRIDGE — COMPATIBILIDAD, NO AUTO-UPDATE ===")
    try:
        c = json.loads(COMPAT.read_text(encoding="utf-8"))
        expected = str(c.get("launcher_sha256") or "")
        if BRIDGE.is_file() and sha_file(BRIDGE) == expected:
            pass_("BRG001", "Bridge launcher hash")
        else:
            fail("BRG001", "Bridge launcher hash")
        if c.get("auto_update") is False and c.get("policy") == "verify_only":
            pass_("BRG002", "Bridge fuera de auto-update")
        else:
            fail("BRG002", "Bridge fuera de auto-update")
        if c.get("core_contract") == "EGP_CORE_BRIDGE_CONTRACT_V1":
            pass_("BRG003", "Contrato Bridge/Core V1")
        else:
            fail("BRG003", "Contrato Bridge/Core V1", c.get("core_contract"))
        for i, ep in enumerate(c.get("required_core_endpoints") or [], 1):
            try:
                d = http_json("http://127.0.0.1:8788" + str(ep))
                if d.get("ok") is True:
                    pass_("BRG%03d" % (3+i), "Bridge endpoint " + str(ep))
                else:
                    fail("BRG%03d" % (3+i), "Bridge endpoint " + str(ep))
            except Exception as e:
                fail("BRG%03d" % (3+i), "Bridge endpoint " + str(ep), e)
    except Exception as e:
        fail("BRG001", "Bridge compatibility.json", e)

    # 7. 1.6 frozen.
    emit("")
    emit("=== 7. 1.6 — AISLAMIENTO ===")
    try:
        p = run([
            "git", "ls-remote",
            "https://github.com/danieldelgado29/elena-girjoaba-music-version-1.6.git",
            "refs/heads/main"
        ], timeout=20)
        got = p.stdout.strip().split()[0] if p.returncode == 0 and p.stdout.strip() else ""
        if got == EXPECTED_16_MAIN:
            pass_("ISO001", "1.6 main congelada", got)
        else:
            fail("ISO001", "1.6 main congelada", "actual=%s esperado=%s" % (got, EXPECTED_16_MAIN))
    except Exception as e:
        fail("ISO001", "1.6 main congelada", e)

    # 8. Sandbox functional API.
    emit("")
    emit("=== 8. CORE SANDBOX — PRUEBAS FUNCIONALES DESTRUCTIVAS AISLADAS ===")
    sandbox_core_tests()

    # 9. Datos/hardware manual.
    emit("")
    emit("=== 9. COBERTURA MANUAL QUE NINGUN SCRIPT PUEDE GARANTIZAR ===")
    if SQLITE.is_file():
        pass_("DATA001", "SQLite producción existe", str(SQLITE))
    else:
        fail("DATA001", "SQLite producción existe", str(SQLITE))

    manual("MAN001", "Editor iPhone", "pellizco/zoom/dibujo/borrador con pantalla real")
    manual("MAN002", "Editor Android", "gestos táctiles reales")
    manual("MAN003", "Mac trackpad + mouse", "zoom/pan/rueda física")
    manual("MAN004", "Windows mouse/touchpad", "interacción física")
    manual("MAN005", "Ui24R real", "audio, mixer y AUX con hardware conectado")
    manual("MAN006", "Logic Bridge real", "STOP → cerrar → 2 s → abrir siguiente")
    manual("MAN007", "PWA instalada real", "cerrar/abrir y actualización en iPhone/Android")
    manual("MAN008", "Red show real", "router con Internet → sin Internet → vuelve Internet")
    manual("MAN009", "Dynamic Island / Safe Area", "posición visual en iPhone físico")

    # 10. Report.
    emit("")
    emit("============================================================")
    emit(" RESULTADO REGRESION")
    emit("============================================================")
    report, counts = save_report()
    fails = counts.get("FAIL", 0)
    passes = counts.get("PASS", 0)
    warns = counts.get("WARN", 0)
    skips = counts.get("SKIP", 0)
    manuals = counts.get("MANUAL", 0)

    emit("AUTOMATICOS OK    : %d" % passes)
    emit("AUTOMATICOS FALLAN: %d" % fails)
    emit("AVISOS            : %d" % warns)
    emit("SKIP              : %d" % skips)
    emit("MANUALES          : %d" % manuals)
    emit("REPORTE           : %s" % report)
    emit("")

    if fails:
        emit("REGRESION AUTOMATICA = BLOQUEADA")
        emit("EL CAMBIO NO SE CONSIDERA TERMINADO")
        emit("============================================================")
        return 30

    emit("REGRESION AUTOMATICA = APROBADA")
    emit("NO SE DETECTO REGRESION EN LAS REGLAS AUTOMATIZADAS")
    emit("")
    emit("IMPORTANTE: las reglas MANUAL siguen requiriendo dispositivo/hardware")
    emit("cuando el cambio afecte esas areas.")
    emit("============================================================")
    return 0

if __name__ == "__main__":
    sys.exit(main())

