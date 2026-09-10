#!/usr/bin/env python3
import json, os, shutil, signal, socket, sqlite3, sys, threading, time, urllib.parse, unicodedata, mimetypes, subprocess, ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PANEL_ROOT = ROOT / "panel-real"
MUSICOS_ROOT = PANEL_ROOT / "musicos"
CURRENT_ID_PATH = Path("/tmp/egp-bridge-current-id")
BRIDGE_HIDDEN_PATH = Path("/tmp/egp-bridge-hidden-current")
PLAY_GUARD_PATH = Path("/tmp/egp-bridge-song-playing")
SEED_DB_PATH = ROOT / "data" / "egp_local.sqlite3"
DATA_DIR = Path(os.environ.get("EGP_LOCAL_DATA_DIR") or (Path.home() / "Library" / "Application Support" / "EGP Local Core"))
DB_PATH = DATA_DIR / "egp_local.sqlite3"
CATALOG_DIR = ROOT / "catalogo"
SONGS_JSON = CATALOG_DIR / "canciones.json"
MAP_JSON = CATALOG_DIR / "mapa-logic.json"
PID_PATH = Path("/tmp/egp-local-core.pid")
LOG_PATH = Path("/tmp/egp-local-core.log")
CLOUD_STATUS_PATH = Path("/tmp/egp-cloud-sync-status.json")
PORT = int(os.environ.get("EGP_LOCAL_PORT", "8788"))
HTTPS_PORT = int(os.environ.get("EGP_LOCAL_HTTPS_PORT", "8789"))
HOST = "0.0.0.0"
TLS_DIR = DATA_DIR / "tls"
CA_KEY = TLS_DIR / "EGP-Local-CA.key"
CA_CERT = TLS_DIR / "EGP-Local-CA.crt"
SERVER_KEY = TLS_DIR / "EGP-Local-Server.key"
SERVER_CERT = TLS_DIR / "EGP-Local-Server.crt"
SERVER_CSR = TLS_DIR / "EGP-Local-Server.csr"
SERVER_EXT = TLS_DIR / "EGP-Local-Server.ext"
TLS_TARGET_IP = os.environ.get("EGP_LOCAL_TLS_IP", "10.10.10.2")
DB_LOCK = threading.RLock()



def ensure_tls_material():
    """Create a private local CA + server cert once, persisted outside the ZIP.
    The CA private key never leaves the Mac. Staff devices install only the .crt.
    """
    TLS_DIR.mkdir(parents=True, exist_ok=True)
    openssl = "/usr/bin/openssl"
    if not Path(openssl).exists():
        openssl = shutil.which("openssl") or ""
    if not openssl:
        raise RuntimeError("openssl no disponible")

    # If CA exists but server certificate is missing/expired/corrupt, reuse the CA.
    if not (CA_KEY.exists() and CA_CERT.exists()):
        subprocess.run([openssl,"genrsa","-out",str(CA_KEY),"2048"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run([openssl,"req","-x509","-new","-nodes","-key",str(CA_KEY),"-sha256","-days","3650",
                        "-subj","/CN=EGP Local CA","-out",str(CA_CERT)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try: os.chmod(CA_KEY,0o600)
        except Exception: pass

    need_server = not (SERVER_KEY.exists() and SERVER_CERT.exists())
    if not need_server:
        # Reissue if the current certificate does not contain the fixed LAN IP.
        try:
            txt=subprocess.check_output([openssl,"x509","-in",str(SERVER_CERT),"-noout","-text"],text=True,stderr=subprocess.DEVNULL)
            need_server = f"IP Address:{TLS_TARGET_IP}" not in txt
        except Exception:
            need_server=True

    if need_server:
        subprocess.run([openssl,"genrsa","-out",str(SERVER_KEY),"2048"],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run([openssl,"req","-new","-key",str(SERVER_KEY),"-subj",f"/CN={TLS_TARGET_IP}","-out",str(SERVER_CSR)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        SERVER_EXT.write_text(
            f"subjectAltName=IP:{TLS_TARGET_IP},IP:127.0.0.1,DNS:localhost\n"
            "extendedKeyUsage=serverAuth\n"
            "keyUsage=digitalSignature,keyEncipherment\n",
            encoding="utf-8"
        )
        subprocess.run([openssl,"x509","-req","-in",str(SERVER_CSR),"-CA",str(CA_CERT),"-CAkey",str(CA_KEY),
                        "-CAcreateserial","-out",str(SERVER_CERT),"-days","825","-sha256","-extfile",str(SERVER_EXT)],
                       check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try: os.chmod(SERVER_KEY,0o600)
        except Exception: pass
    return CA_CERT, SERVER_CERT, SERVER_KEY

def now_ms(): return int(time.time() * 1000)

def db_connect():
    con = sqlite3.connect(str(DB_PATH), timeout=10, isolation_level=None, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=10000")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def ensure_photos_table():
    with DB_LOCK, db_connect() as con:
        con.execute("""
        CREATE TABLE IF NOT EXISTS photos_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
        """)


def photos_snapshot():
    ensure_photos_table()
    data={}
    with DB_LOCK, db_connect() as con:
        rows=con.execute(
            "SELECT key,value,updated_at FROM photos_state ORDER BY key"
        ).fetchall()

    updated_at=0

    for row in rows:
        try:
            value=json.loads(row["value"])
        except Exception:
            value=row["value"]

        data[row["key"]]=value
        updated_at=max(updated_at,int(row["updated_at"] or 0))

    return {
        "ok":True,
        "photos":data,
        "updated_at":updated_at
    }


def write_photos(data):
    ensure_photos_table()
    if not isinstance(data,dict):
        raise ValueError("payload inválido")

    photos=data.get("photos",data)

    if not isinstance(photos,dict):
        raise ValueError("photos debe ser un objeto")

    allowed={
        "portada__desktop",
        "portada__mobile",
        "info__desktop",
        "info__mobile",
        "bio__desktop",
        "bio__mobile",
        "carta1__desktop",
        "carta1__mobile",
        "carta2__desktop",
        "carta2__mobile"
    }

    stamp=now_ms()

    with DB_LOCK, db_connect() as con:
        for key,value in photos.items():
            key=str(key or "")

            if key not in allowed:
                continue

            raw=json.dumps(
                value,
                ensure_ascii=False,
                separators=(",",":")
            )

            con.execute(
                """
                INSERT INTO photos_state(key,value,updated_at)
                VALUES(?,?,?)
                ON CONFLICT(key) DO UPDATE SET
                  value=excluded.value,
                  updated_at=excluded.updated_at
                """,
                (key,raw,stamp)
            )

    return photos_snapshot()


def norm_text(v):
    s = unicodedata.normalize("NFKD", str(v or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(s.lower().strip().split())

def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DB_PATH.exists() and SEED_DB_PATH.exists():
        shutil.copy2(str(SEED_DB_PATH), str(DB_PATH))
    with DB_LOCK, db_connect() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA synchronous=NORMAL")
        con.executescript("""
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS show_state (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          show_active INTEGER NOT NULL DEFAULT 0,
          venue TEXT NOT NULL DEFAULT '',
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queue (
          id TEXT PRIMARY KEY,
          number TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          position INTEGER NOT NULL,
          played INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_queue_position ON queue(position);
        CREATE TABLE IF NOT EXISTS changes (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          ts INTEGER NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT NOT NULL DEFAULT '',
          op TEXT NOT NULL,
          payload TEXT NOT NULL,
          sync_state TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_changes_sync ON changes(sync_state, seq);
        CREATE TABLE IF NOT EXISTS songs (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          artist TEXT NOT NULL DEFAULT '',
          title_norm TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_songs_title_norm ON songs(title_norm);
        CREATE TABLE IF NOT EXISTS logic_map (
          song_id TEXT PRIMARY KEY,
          path TEXT NOT NULL
        );
        """)
        con.execute("INSERT OR IGNORE INTO show_state(singleton,show_active,venue,updated_at) VALUES(1,0,'',?)", (now_ms(),))
        con.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version','2')")
    import_catalog()

def import_catalog():
    songs = json.loads(SONGS_JSON.read_text(encoding='utf-8'))
    mp = json.loads(MAP_JSON.read_text(encoding='utf-8'))

    with DB_LOCK, db_connect() as con:
        con.execute("BEGIN IMMEDIATE")

        # La base permanente sigue siendo canciones.json.
        # Conservamos aparte solamente los custom ya sincronizados
        # para que un reinicio sin Internet no los pierda.
        preserved_custom=[
            dict(r)
            for r in con.execute(
                "SELECT id,title,artist,title_norm,payload "
                "FROM songs WHERE id LIKE 'custom-%'"
            ).fetchall()
        ]

        con.execute("DELETE FROM songs")
        con.execute("DELETE FROM logic_map")

        for s in songs:
            sid = str(s.get('id') or '').strip()
            title = str(s.get('titulo') or '').strip()

            if not sid or not title:
                continue

            con.execute(
                "INSERT INTO songs"
                "(id,title,artist,title_norm,payload) "
                "VALUES(?,?,?,?,?)",
                (
                    sid,
                    title,
                    str(s.get('artista') or ''),
                    norm_text(title),
                    json.dumps(
                        s,
                        ensure_ascii=False,
                        separators=(',',':')
                    )
                )
            )

        # Si algún día un ID custom pasa a formar parte del catálogo
        # base, la base gana y no se duplica.
        for r in preserved_custom:
            con.execute(
                "INSERT OR IGNORE INTO songs"
                "(id,title,artist,title_norm,payload) "
                "VALUES(?,?,?,?,?)",
                (
                    r['id'],
                    r['title'],
                    r['artist'],
                    r['title_norm'],
                    r['payload']
                )
            )

        for sid, path in mp.items():
            sid, path = str(sid).strip(), str(path).strip()

            if sid and path:
                con.execute(
                    "INSERT INTO logic_map(song_id,path) VALUES(?,?)",
                    (sid,path)
                )

        con.execute(
            "INSERT OR REPLACE INTO meta(key,value) "
            "VALUES('catalog_imported_at',?)",
            (str(now_ms()),)
        )

        con.execute("COMMIT")
def append_change(con, entity, entity_id, op, payload):
    con.execute("INSERT INTO changes(ts,entity,entity_id,op,payload,sync_state) VALUES(?,?,?,?,?,'pending')",
                (now_ms(), entity, entity_id or '', op, json.dumps(payload, ensure_ascii=False, separators=(',',':'))))

def health_snapshot():
    try:
        with DB_LOCK, db_connect() as con:
            con.execute("SELECT 1").fetchone()
            pending = con.execute("SELECT COUNT(*) c FROM queue WHERE played=0").fetchone()['c']
        return {"ok":True,"version":7,"build":"PERSISTENT_DB_V7","mode":"LOCAL_ONLY","port":PORT,"db":str(DB_PATH),"pending":pending,"time":now_ms()}
    except Exception as e:
        return {"ok":False,"version":7,"build":"PERSISTENT_DB_V7","error":"database unavailable","detail":str(e),"db":str(DB_PATH),"time":now_ms()}

# EGP_CUSTOM_SONGS_API_V1
# Expone SOLO canciones personalizadas desde la SQLite persistente.
# No altera /api/catalog ni consumidores existentes.
def custom_songs_snapshot():
    with DB_LOCK, db_connect() as con:
        rows=con.execute(
            "SELECT id,title,artist,payload "
            "FROM songs WHERE id LIKE 'custom-%' ORDER BY id"
        ).fetchall()

    songs=[]

    for row in rows:
        try:
            payload=json.loads(row['payload'] or '{}')
        except Exception:
            payload={}

        if not isinstance(payload,dict):
            payload={}

        item=dict(payload)
        item['id']=str(item.get('id') or row['id'])
        item['titulo']=str(item.get('titulo') or row['title'] or '')
        item['artista']=str(item.get('artista') or row['artist'] or '')
        songs.append(item)

    return {
        'ok':True,
        'customSongs':songs,
        'count':len(songs)
    }


# EGP_CUSTOM_SONGS_WRITE_V1
# Guarda el payload completo de customSongs en la SQLite persistente.
# No toca logic_map ni canciones base.
def write_custom_songs(data):
    songs=data.get('customSongs') if isinstance(data,dict) else None
    if not isinstance(songs,list):
        raise ValueError('customSongs inválido')

    clean=[]
    for item in songs:
        if not isinstance(item,dict):
            continue
        sid=str(item.get('id') or '').strip()
        title=str(item.get('titulo') or '').strip()
        artist=str(item.get('artista') or '')
        if not sid.startswith('custom-') or not title:
            continue
        payload=dict(item)
        payload['id']=sid
        payload['titulo']=title
        payload['artista']=artist
        clean.append((sid,title,artist,payload))

    with DB_LOCK, db_connect() as con:
        con.execute('BEGIN IMMEDIATE')
        for sid,title,artist,payload in clean:
            con.execute(
                'INSERT INTO songs(id,title,artist,title_norm,payload) '
                'VALUES(?,?,?,?,?) '
                'ON CONFLICT(id) DO UPDATE SET '
                'title=excluded.title,artist=excluded.artist,'
                'title_norm=excluded.title_norm,payload=excluded.payload',
                (sid,title,artist,norm_text(title),json.dumps(payload,ensure_ascii=False,separators=(',',':')))
            )
        con.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('custom_songs_updated_at',?)",
            (str(now_ms()),)
        )
        con.execute('COMMIT')

    return custom_songs_snapshot()



# EGP_LIBRARY_CORE_V1
# Biblioteca editable separada del catálogo Logic.
LIBRARY_META_KEY='library_state_json'
LIBRARY_UPDATED_META_KEY='library_updated_at'

def _library_clean(payload):
    payload=payload if isinstance(payload,dict) else {}
    edits=payload.get('songEdits') if isinstance(payload.get('songEdits'),dict) else {}
    songs=payload.get('customSongs') if isinstance(payload.get('customSongs'),list) else []
    raw_reps=payload.get('customRepertoires') if isinstance(payload.get('customRepertoires'),list) else []
    reps=[]; seen=set()
    for item in raw_reps:
        if not isinstance(item,dict): continue
        rid=clean_text(item.get('id'),120); name=clean_text(item.get('name'),200)
        if not rid or not name or rid in seen: continue
        seen.add(rid); reps.append({'id':rid,'name':name})
    return {'songEdits':edits,'customSongs':[x for x in songs if isinstance(x,dict)],'customRepertoires':reps}

def library_snapshot():
    raw=''; updated=0
    with DB_LOCK,db_connect() as con:
        row=con.execute('SELECT value FROM meta WHERE key=?',(LIBRARY_META_KEY,)).fetchone()
        rev=con.execute('SELECT value FROM meta WHERE key=?',(LIBRARY_UPDATED_META_KEY,)).fetchone()
    if row: raw=str(row['value'] or '')
    if rev:
        try: updated=int(rev['value'] or 0)
        except Exception: updated=0
    if raw:
        try: data=json.loads(raw)
        except Exception: data={}
    else:
        data={'songEdits':{},'customSongs':custom_songs_snapshot().get('customSongs',[]),'customRepertoires':[]}
    clean=_library_clean(data)
    return {'ok':True,'biblioteca':clean,'songEdits':clean['songEdits'],'customSongs':clean['customSongs'],'customRepertoires':clean['customRepertoires'],'biblioteca_updated_at':updated}

def write_library_state(data):
    if not isinstance(data,dict): raise ValueError('payload inválido')
    payload=data.get('biblioteca',data)
    if not isinstance(payload,dict): raise ValueError('biblioteca debe ser un objeto')
    clean=_library_clean(payload)
    write_custom_songs({'customSongs':clean['customSongs']})
    current=library_snapshot()
    try: current_rev=int(current.get('biblioteca_updated_at') or 0)
    except Exception: current_rev=0
    try: incoming=int(data.get('biblioteca_updated_at') or data.get('updated_at') or 0)
    except Exception: incoming=0
    source=clean_text(data.get('source'),80) or 'panel'
    revision=incoming if source in {'firebase','cloud-sync'} and incoming>0 else max(now_ms(),current_rev+1,incoming)
    raw=json.dumps(clean,ensure_ascii=False,separators=(',',':'))
    with DB_LOCK,db_connect() as con:
        con.execute('BEGIN IMMEDIATE')
        con.execute('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',(LIBRARY_META_KEY,raw))
        con.execute('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)',(LIBRARY_UPDATED_META_KEY,str(revision)))
        append_change(con,'library','biblioteca','set',{'updatedAt':revision,'source':source,'customRepertoires':len(clean['customRepertoires']),'customSongs':len(clean['customSongs']),'songEdits':len(clean['songEdits'])})
        con.execute('COMMIT')
    return library_snapshot()


def catalog_status():
    with DB_LOCK, db_connect() as con:
        sc = con.execute("SELECT COUNT(*) c FROM songs").fetchone()['c']
        mc = con.execute("SELECT COUNT(*) c FROM logic_map").fetchone()['c']
        mapped = con.execute("SELECT COUNT(*) c FROM songs s JOIN logic_map m ON m.song_id=s.id").fetchone()['c']
    return {"ok":True,"songs":sc,"logicMaps":mc,"songsMapped":mapped,"version":7}

def catalog_snapshot(q='', limit=500):
    qn = norm_text(q)
    limit = max(1, min(int(limit), 500))
    with DB_LOCK, db_connect() as con:
        if qn:
            rows=con.execute("SELECT s.id,s.title,s.artist,m.path FROM songs s LEFT JOIN logic_map m ON m.song_id=s.id WHERE s.title_norm LIKE ? OR lower(s.id) LIKE ? ORDER BY s.title LIMIT ?", ('%'+qn+'%','%'+qn+'%',limit)).fetchall()
        else:
            rows=con.execute("SELECT s.id,s.title,s.artist,m.path FROM songs s LEFT JOIN logic_map m ON m.song_id=s.id ORDER BY s.title LIMIT ?", (limit,)).fetchall()
    return {"ok":True,"songs":[{"id":r['id'],"title":r['title'],"artist":r['artist'],"mapped":bool(r['path'])} for r in rows]}

def current_bridge_id():
    try:
        return CURRENT_ID_PATH.read_text(encoding="utf-8").strip()[:120]
    except Exception:
        return ""


def bridge_hidden_id():
    try:
        return clean_text(BRIDGE_HIDDEN_PATH.read_text(),120) if BRIDGE_HIDDEN_PATH.exists() else ""
    except Exception:
        return ""

def set_bridge_hidden(item_id):
    item_id=clean_text(item_id,120)
    try:
        if item_id:
            BRIDGE_HIDDEN_PATH.write_text(item_id)
        elif BRIDGE_HIDDEN_PATH.exists():
            BRIDGE_HIDDEN_PATH.unlink()
    except Exception:
        pass

def state_snapshot():
    # EGP_UNIFIED_SHOW_STATE_CORE_V1
    # /api/state expone UNA sola verdad del show.
    with DB_LOCK, db_connect() as con:
        show = con.execute(
            "SELECT show_active,venue,updated_at FROM show_state WHERE singleton=1"
        ).fetchone()
        items = con.execute(
            "SELECT id,number,title,position,played,updated_at "
            "FROM queue ORDER BY position ASC, updated_at ASC"
        ).fetchall()
        pending = con.execute(
            "SELECT COUNT(*) c FROM changes WHERE sync_state='pending'"
        ).fetchone()['c']

    cfg=public_config_snapshot()

    if isinstance(cfg,dict) and (
        'show_active' in cfg or 'show_activo' in cfg
    ):
        active=bool(cfg.get('show_active',cfg.get('show_activo',False)))
        venue=str(cfg.get('lugar',show['venue']) or '')
        cfg['show_active']=active
        cfg['show_activo']=active
    else:
        active=bool(show['show_active'])
        venue=str(show['venue'] or '')

    try:
        cfg_updated=int(cfg.get('updated_at') or 0)
    except Exception:
        cfg_updated=0
    try:
        cfg_revision=int(cfg.get('show_revision') or 0)
    except Exception:
        cfg_revision=0

    show_updated=max(
        int(show['updated_at'] or 0),
        cfg_updated,
        cfg_revision
    )

    st=catalog_status()

    return {
        "ok":True,
        "serverTime":now_ms(),
        "show":{
            "active":active,
            "venue":venue,
            "updatedAt":show_updated
        },
        "queue":[
            dict(r) | {"played":bool(r['played'])}
            for r in items
        ],
        "currentId":current_bridge_id(),
        "pendingSync":pending,
        "mode":"LOCAL_ONLY",
        "publicConfig":cfg,
        "catalog":{
            "songs":st['songs'],
            "logicMaps":st['logicMaps'],
            "songsMapped":st['songsMapped']
        }
    }

def clean_text(v,maxlen=200): return str(v or '').strip()[:maxlen]

PUBLIC_CONFIG_META_KEY='public_config_json'
PUBLIC_CONFIG_FIELDS={
    'show_active','show_activo','show_id','show_session_id',
    'show_revision','show_writer',
    'pedidos_panel','pedidos_modo','pedidos_whatsapp',
    'mostrar_cola','lista_activa','listaActiva',
    'repertorio_nombre','repertorio_activo_ids','repertorioActivoIds',
    'lugar','perfil_clientes','uso_publicidad',
    'inicio_show','cronometro_schema','cronometro_elapsed_ms',
    'cronometro_running','cronometro_started_at'
}

def public_config_snapshot():
    with DB_LOCK, db_connect() as con:
        row=con.execute("SELECT value FROM meta WHERE key=?",(PUBLIC_CONFIG_META_KEY,)).fetchone()
    if not row:
        return {}
    try:
        data=json.loads(row['value'])
    except Exception:
        return {}
    return data if isinstance(data,dict) else {}

def write_public_config(data):
    # EGP_UNIFIED_SHOW_STATE_CORE_V1
    # publicConfig + show_state se actualizan en la MISMA transacción.
    if not isinstance(data,dict):
        raise ValueError('payload inválido')

    payload=data.get('publicConfig',data)
    if not isinstance(payload,dict):
        raise ValueError('publicConfig debe ser un objeto')

    cfg=public_config_snapshot()
    old_show_id=str(cfg.get('show_id') or '')

    def as_int(value,default=0):
        try:
            return int(value or 0)
        except Exception:
            return default

    bool_fields={
        'show_active','show_activo',
        'pedidos_panel','pedidos_whatsapp',
        'mostrar_cola','uso_publicidad',
        'cronometro_running'
    }
    list_fields={'repertorio_activo_ids','repertorioActivoIds'}
    int_fields={
        'show_revision','inicio_show','cronometro_schema',
        'cronometro_elapsed_ms','cronometro_started_at'
    }
    text_fields={
        'show_id','show_session_id','show_writer',
        'lista_activa','listaActiva','repertorio_nombre',
        'lugar','perfil_clientes'
    }

    for key in PUBLIC_CONFIG_FIELDS:
        if key not in payload:
            continue

        value=payload[key]

        if key in bool_fields:
            cfg[key]=bool(value)

        elif key in list_fields:
            if not isinstance(value,list):
                raise ValueError(f'{key} debe ser una lista')
            cfg[key]=[
                clean_text(x,120)
                for x in value
                if clean_text(x,120)
            ][:1000]

        elif key=='pedidos_modo':
            cfg[key]='uno_por_turno' if value=='uno_por_turno' else 'libre'

        elif key=='perfil_clientes':
            cfg[key]=clean_text(value,60) or 'medio'

        elif key in int_fields:
            cfg[key]=max(0,as_int(value))

        elif key in text_fields:
            text=clean_text(value,200)
            if key in {'show_id','show_session_id'} and text in {'','0'}:
                continue
            cfg[key]=text

    if 'show_activo' in payload:
        active=bool(payload.get('show_activo'))
    elif 'show_active' in payload:
        active=bool(payload.get('show_active'))
    else:
        active=bool(cfg.get('show_active',cfg.get('show_activo',False)))

    cfg['show_active']=active
    cfg['show_activo']=active

    if 'listaActiva' in payload and payload.get('listaActiva'):
        cfg['lista_activa']=clean_text(payload.get('listaActiva'),200)
    elif 'lista_activa' in cfg:
        cfg['listaActiva']=cfg.get('lista_activa','')

    if 'repertorioActivoIds' in payload:
        cfg['repertorio_activo_ids']=cfg.get(
            'repertorioActivoIds',
            cfg.get('repertorio_activo_ids',[])
        )
    elif 'repertorio_activo_ids' in cfg:
        cfg['repertorioActivoIds']=list(
            cfg.get('repertorio_activo_ids') or []
        )

    ts=now_ms()

    incoming_show_id=str(payload.get('show_id') or '')
    incoming_start=as_int(payload.get('inicio_show'))

    if active:
        start=(
            incoming_start or
            as_int(cfg.get('inicio_show')) or
            as_int(cfg.get('show_id')) or
            ts
        )
        cfg['inicio_show']=start

        if incoming_show_id not in {'','0'}:
            cfg['show_id']=clean_text(incoming_show_id,120)
        elif str(cfg.get('show_id') or '') in {'','0'}:
            cfg['show_id']=str(start)

        explicit_session=clean_text(
            payload.get('show_session_id'),
            120
        )
        new_show=(
            incoming_show_id not in {'','0'} and
            incoming_show_id!=old_show_id
        )

        if explicit_session:
            cfg['show_session_id']=explicit_session
        elif new_show or not cfg.get('show_session_id'):
            cfg['show_session_id']=f"show-{cfg['show_id']}"

    else:
        cfg['inicio_show']=0
        cfg['cronometro_schema']=max(
            3,
            as_int(cfg.get('cronometro_schema'))
        )
        cfg['cronometro_elapsed_ms']=0
        cfg['cronometro_running']=False
        cfg['cronometro_started_at']=0

    current_rev=max(
        as_int(cfg.get('show_revision')),
        as_int(cfg.get('updated_at'))
    )
    incoming_rev=as_int(payload.get('show_revision'))
    revision=max(ts,current_rev+1,incoming_rev)

    cfg['show_revision']=revision
    cfg['updated_at']=revision

    writer=clean_text(payload.get('show_writer'),120)
    if writer:
        cfg['show_writer']=writer
    elif not cfg.get('show_writer'):
        cfg['show_writer']='local-core'

    venue=clean_text(cfg.get('lugar'),120)

    raw=json.dumps(
        cfg,
        ensure_ascii=False,
        separators=(',',':')
    )

    with DB_LOCK, db_connect() as con:
        con.execute("BEGIN IMMEDIATE")
        con.execute(
            "INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
            (PUBLIC_CONFIG_META_KEY,raw)
        )
        con.execute(
            "UPDATE show_state "
            "SET show_active=?,venue=?,updated_at=? "
            "WHERE singleton=1",
            (1 if active else 0,venue,revision)
        )
        append_change(
            con,
            'show',
            'estado',
            'set',
            {
                "active":active,
                "venue":venue,
                "showRevision":revision,
                "showSessionId":cfg.get('show_session_id',''),
                "updatedAt":revision
            }
        )
        con.execute("COMMIT")

    return state_snapshot()

# EGP_SINGLE_SHOW_SESSION_GUARD_V2
_egp_write_public_config_original_v2 = write_public_config

def write_public_config(data):
    incoming = data if isinstance(data, dict) else {}
    incoming_active = (
        incoming.get("show_active") is True
        or incoming.get("show_activo") is True
    )

    try:
        current = state_snapshot()
    except Exception:
        current = {}

    current_show = current.get("show") if isinstance(current, dict) else {}
    current_pub = current.get("publicConfig") if isinstance(current, dict) else {}
    current_show = current_show if isinstance(current_show, dict) else {}
    current_pub = current_pub if isinstance(current_pub, dict) else {}

    current_active = current_show.get("active") is True

    incoming_session = str(
        incoming.get("show_session_id")
        or incoming.get("show_id")
        or incoming.get("inicio_show")
        or ""
    )

    current_session = str(
        current_pub.get("show_session_id")
        or current_pub.get("show_id")
        or current_pub.get("inicio_show")
        or ""
    )

    if (
        current_active
        and incoming_active
        and current_session
        and incoming_session
        and incoming_session != current_session
    ):
        return {
            "ok": False,
            "error": "SHOW_ALREADY_ACTIVE",
            "message": "Ya existe un show activo con otra sesión.",
            "show_session_id": current_session,
            "show_id": str(current_pub.get("show_id") or ""),
        }

    return _egp_write_public_config_original_v2(incoming)


def next_position(con): return int(con.execute("SELECT COALESCE(MAX(position),0)+1 n FROM queue").fetchone()['n'])

def write_show(data):
    # EGP_UNIFIED_SHOW_STATE_CORE_V1
    # /api/show se mantiene compatible pero usa la misma autoridad.
    if not isinstance(data,dict):
        raise ValueError('payload inválido')

    active=bool(data.get('active'))
    venue=clean_text(data.get('venue'),120)

    patch={
        'show_active':active,
        'show_activo':active,
        'lugar':venue
    }

    for key in (
        'show_id','show_session_id','show_revision','show_writer',
        'inicio_show','cronometro_schema','cronometro_elapsed_ms',
        'cronometro_running','cronometro_started_at'
    ):
        if key in data:
            patch[key]=data[key]

    return write_public_config(patch)

def add_item(data):
    requested_id=clean_text(data.get('id'),120)
    title=clean_text(data.get('title'),200)
    number=clean_text(data.get('number'),30)
    with DB_LOCK,db_connect() as con:
        if requested_id:
            cat=con.execute("SELECT id,title FROM songs WHERE id=?",(requested_id,)).fetchone()
            if cat:
                item_id=cat['id']; title=cat['title']
            else: item_id=requested_id
        else: item_id='local-'+str(now_ms())
        if not title: raise ValueError('title requerido')
        ts=now_ms(); con.execute("BEGIN IMMEDIATE"); pos=next_position(con)
        con.execute("INSERT INTO queue(id,number,title,position,played,updated_at) VALUES(?,?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET number=excluded.number,title=excluded.title,position=excluded.position,played=0,updated_at=excluded.updated_at", (item_id,number,title,pos,ts))
        append_change(con,'queue',item_id,'upsert',{"id":item_id,"number":number,"title":title,"position":pos,"played":False,"updatedAt":ts})
        con.execute("COMMIT")
    return state_snapshot()

def set_played(data):
    item_id=clean_text(data.get('id'),120); played=1 if bool(data.get('played',True)) else 0
    if not item_id: raise ValueError('id requerido')
    ts=now_ms()
    with DB_LOCK,db_connect() as con:
        con.execute("BEGIN IMMEDIATE"); cur=con.execute("UPDATE queue SET played=?,updated_at=? WHERE id=?",(played,ts,item_id))
        if cur.rowcount==0: con.execute("ROLLBACK"); raise ValueError('canción no encontrada')
        append_change(con,'queue',item_id,'played',{"id":item_id,"played":bool(played),"updatedAt":ts}); con.execute("COMMIT")
    if played and bridge_hidden_id()==item_id:
        set_bridge_hidden("")
    return state_snapshot()

def remove_item(data):
    item_id=clean_text(data.get('id'),120)
    if not item_id: raise ValueError('id requerido')
    with DB_LOCK,db_connect() as con:
        con.execute("BEGIN IMMEDIATE"); con.execute("DELETE FROM queue WHERE id=?",(item_id,)); append_change(con,'queue',item_id,'remove',{"id":item_id,"updatedAt":now_ms()})
        rows=con.execute("SELECT id FROM queue ORDER BY position ASC,updated_at ASC").fetchall()
        for i,r in enumerate(rows,1): con.execute("UPDATE queue SET position=? WHERE id=?",(i,r['id']))
        con.execute("COMMIT")
    if bridge_hidden_id()==item_id:
        set_bridge_hidden("")
    return state_snapshot()

def remove_bridge_pending(data):
    item_id=clean_text(data.get('id'),120)
    if not item_id: raise ValueError('id requerido')
    current_id=current_bridge_id()

    # X sobre SONANDO: solo ocultarla de la cola del Bridge.
    # La fila canónica permanece en Local Core hasta el STOP real para que
    # marcar-tocada.sh pueda poner played=true y Cloud Sync lo refleje en Panel.
    # Nunca tocamos Logic ni /tmp/egp-bridge-current-id.
    if current_id and item_id==current_id and PLAY_GUARD_PATH.exists():
        with DB_LOCK,db_connect() as con:
            exists=con.execute("SELECT 1 FROM queue WHERE id=? LIMIT 1",(item_id,)).fetchone() is not None
        if exists:
            set_bridge_hidden(item_id)
        return bridge_state_snapshot()

    # Si el proyecto actual todavía NO entró en PLAY, la X se comporta como
    # una eliminación normal. Lo mismo para cualquier pendiente real.
    return remove_item({'id':item_id})

def reorder_queue(data):
    raw=data.get('order')
    if not isinstance(raw,list): raise ValueError('order requerido')

    requested=[]
    seen=set()
    for value in raw:
        item_id=clean_text(value,120)
        if item_id and item_id not in seen:
            requested.append(item_id)
            seen.add(item_id)

    with DB_LOCK,db_connect() as con:
        con.execute("BEGIN IMMEDIATE")
        rows=con.execute("SELECT id,played,position FROM queue ORDER BY position ASC,updated_at ASC").fetchall()
        existing=[r['id'] for r in rows]
        existing_set=set(existing)

        requested=[x for x in requested if x in existing_set]
        requested_set=set(requested)
        final=requested+[x for x in existing if x not in requested_set]

        # Solo la canción REAL que el Bridge tiene abierta queda protegida.
        current_id=current_bridge_id()
        rows_by_id={r['id']:r for r in rows}
        current_row=rows_by_id.get(current_id)
        if current_row is not None and not bool(current_row['played']) and current_id in final:
            final=[current_id]+[x for x in final if x!=current_id]

        ts=now_ms()
        for i,item_id in enumerate(final,1):
            con.execute("UPDATE queue SET position=?,updated_at=? WHERE id=?",(i,ts,item_id))

        append_change(con,'queue','*','reorder',{"order":final,"currentId":current_id,"updatedAt":ts})
        con.execute("COMMIT")
    return state_snapshot()

def clear_queue():
    with DB_LOCK,db_connect() as con:
        con.execute("BEGIN IMMEDIATE"); con.execute("DELETE FROM queue"); append_change(con,'queue','*','clear',{"updatedAt":now_ms()}); con.execute("COMMIT")
    return state_snapshot()

def resolve_next():
    with DB_LOCK, db_connect() as con:
        item=con.execute("SELECT id,number,title,position FROM queue WHERE played=0 ORDER BY position ASC,updated_at ASC LIMIT 1").fetchone()
        if not item: return {"ok":True,"status":"EMPTY"}
        local_id=item['id']; title=item['title']; song_id=None
        exact=con.execute("SELECT id FROM songs WHERE id=?",(local_id,)).fetchone()
        if exact: song_id=exact['id']
        else:
            matches=con.execute("SELECT id FROM songs WHERE title_norm=?",(norm_text(title),)).fetchall()
            if len(matches)==1: song_id=matches[0]['id']
            elif len(matches)>1: return {"ok":True,"status":"AMBIGUOUS","localId":local_id,"title":title,"matches":[r['id'] for r in matches]}
        if not song_id: return {"ok":True,"status":"UNMAPPED","localId":local_id,"title":title}
        row=con.execute("SELECT path FROM logic_map WHERE song_id=?",(song_id,)).fetchone()
        if not row: return {"ok":True,"status":"UNMAPPED","songId":song_id,"localId":local_id,"title":title}
        path=row['path']; exists=Path(path).exists()
        return {"ok":True,"status":"OK" if exists else "MISSING","songId":song_id,"localId":local_id,"title":title,"logicPath":path,"pathExists":exists,"position":item['position']}

def changes_snapshot(limit=200):
    limit=max(1,min(int(limit),1000))
    with DB_LOCK,db_connect() as con: rows=con.execute("SELECT seq,ts,entity,entity_id,op,payload,sync_state FROM changes ORDER BY seq DESC LIMIT ?",(limit,)).fetchall()
    out=[]
    for r in rows:
        d=dict(r)
        try:d['payload']=json.loads(d['payload'])
        except Exception:pass
        out.append(d)
    return {"ok":True,"changes":out}


def local_ip():
    # macOS: prefer the real address of common physical interfaces.
    for iface in ("en0","en1","en2","en3"):
        try:
            r=subprocess.run(
                ["/usr/sbin/ipconfig","getifaddr",iface],
                capture_output=True,text=True,timeout=1
            )
            ip=(r.stdout or "").strip()
            if ip and not ip.startswith("127."):
                return ip
        except Exception:
            pass

    # Generic fallback. UDP connect does not send traffic; it asks the OS
    # which local interface would be used.
    for target in (("192.168.1.1",80),("10.0.0.1",80),("8.8.8.8",80)):
        try:
            sk=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
            sk.connect(target)
            ip=sk.getsockname()[0]
            sk.close()
            if ip and not ip.startswith("127."):
                return ip
        except Exception:
            pass
    return "127.0.0.1"

def cloud_status_snapshot():
    obj={"state":"OFF","message":"Sin sincronizador","http":"","pendingLocal":0}
    try:
        if CLOUD_STATUS_PATH.exists():
            data=json.loads(CLOUD_STATUS_PATH.read_text(encoding="utf-8"))
            if isinstance(data,dict):
                obj.update(data)
    except Exception:
        pass
    try:
        with DB_LOCK,db_connect() as con:
            obj["pendingLocal"]=int(con.execute(
                "SELECT COUNT(*) c FROM changes WHERE sync_state='pending'"
            ).fetchone()["c"])
    except Exception:
        pass
    return obj

def _safe_panel_file(url_path):
    rel=urllib.parse.unquote(url_path[len('/panel/'):])
    if not rel: rel='panel.html'
    target=(PANEL_ROOT/rel).resolve()
    base=PANEL_ROOT.resolve()
    if target!=base and base not in target.parents:return None
    return target

def _safe_musicos_file(url_path):
    rel=urllib.parse.unquote(url_path[len('/musicos/'):])
    if not rel: rel='index.html'
    target=(MUSICOS_ROOT/rel).resolve()
    base=MUSICOS_ROOT.resolve()
    if target!=base and base not in target.parents:return None
    return target

def bridge_state_snapshot():
    snap=state_snapshot()
    hidden=bridge_hidden_id()
    if hidden:
        snap["queue"]=[item for item in snap.get("queue",[]) if clean_text(item.get("id"),120)!=hidden]
    snap["bridgeHiddenId"]=hidden
    return snap

def connectivity_snapshot():
    ip=local_ip()
    return {
        "ok":True,
        "mode":"LOCAL_FIRST",
        "lanIp":ip,
        "lanUrl":f"http://{ip}:{PORT}/",
        "secureLanUrl":f"https://{TLS_TARGET_IP}:{HTTPS_PORT}/",
        "localUrl":f"http://127.0.0.1:{PORT}/",
        "secureLocalUrl":f"https://127.0.0.1:{HTTPS_PORT}/",
        "cloud":cloud_status_snapshot(),
        "time":now_ms()
    }

class Handler(BaseHTTPRequestHandler):
    server_version='EGPLocalCore/7.0'
    def log_message(self,fmt,*args):
        try:
            with LOG_PATH.open('a',encoding='utf-8') as f:f.write('%s - %s\n'%(time.strftime('%Y-%m-%d %H:%M:%S'),fmt%args))
        except Exception:pass
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); self.send_header('Access-Control-Allow-Headers','Content-Type'); self.send_header('Access-Control-Allow-Private-Network','true'); self.send_header('Cache-Control','no-store')
    def _json(self,obj,code=200):
        raw=json.dumps(obj,ensure_ascii=False).encode('utf-8'); self.send_response(code); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self._cors(); self.end_headers(); self.wfile.write(raw)
    def _file(self,path,content_type):
        try: raw=path.read_bytes()
        except FileNotFoundError: return self._json({"ok":False,"error":"not found"},404)
        self.send_response(200); self.send_header('Content-Type',content_type); self.send_header('Content-Length',str(len(raw))); self._cors(); self.end_headers(); self.wfile.write(raw)
    def _body(self):
        n=int(self.headers.get('Content-Length','0') or '0')
        limit=8_000_000 if self.path=='/api/library' else 1_000_000
        if n>limit: raise ValueError('payload demasiado grande')
        raw=self.rfile.read(n) if n else b'{}'; return json.loads(raw.decode('utf-8') or '{}')
    def do_OPTIONS(self): self.send_response(204); self._cors(); self.end_headers()
    def do_GET(self):
        try:
            parsed=urllib.parse.urlparse(self.path); path=parsed.path; qs=urllib.parse.parse_qs(parsed.query)
            if path in ('/','/index.html'): return self._file(ROOT/'web'/'index.html','text/html; charset=utf-8')
            if path=='/egp-local-ca.crt':
                if not CA_CERT.exists():
                    try: ensure_tls_material()
                    except Exception as e: return self._json({"ok":False,"error":"certificado no disponible","detail":str(e)},500)
                return self._file(CA_CERT,'application/x-x509-ca-cert')
            if path in ('/offline-setup','/offline-setup/'):
                return self._file(ROOT/'web'/'offline-setup.html','text/html; charset=utf-8')
            if path in ('/panel','/panel/'):
                if path=='/panel':
                    self.send_response(302); self.send_header('Location','/panel/'+(('?'+parsed.query) if parsed.query else '')); self._cors(); self.end_headers(); return
                return self._file(PANEL_ROOT/'panel.html','text/html; charset=utf-8')
            if path.startswith('/panel/'):
                target=_safe_panel_file(path)
                if target is None:return self._json({"ok":False,"error":"ruta inválida"},400)
                mime=mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                if mime.startswith('text/') or mime in ('application/javascript','application/json'): mime += '; charset=utf-8'
                return self._file(target,mime)
            # Compatibilidad con iconos/PWA de EGP MUSICOS instalados desde la ruta web histórica.
            # IMPORTANTE: no redirigir fuera de esa ruta. En iPhone/iPad un salto fuera del
            # scope de la web app puede mostrar la barra/dirección del navegador. Servimos
            # los mismos archivos de MUSICOS_ROOT directamente bajo el scope histórico.
            legacy_musicos='/elena-girjoaba-music-version-1.6/musicos'
            if path in (legacy_musicos, legacy_musicos+'/'):
                return self._file(MUSICOS_ROOT/'index.html','text/html; charset=utf-8')
            if path.startswith(legacy_musicos+'/'):
                rel=urllib.parse.unquote(path[len(legacy_musicos+'/'):])
                if not rel: rel='index.html'
                target=(MUSICOS_ROOT/rel).resolve(); base=MUSICOS_ROOT.resolve()
                if target!=base and base not in target.parents:return self._json({"ok":False,"error":"ruta inválida"},400)
                mime=mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                if mime.startswith('text/') or mime in ('application/javascript','application/json','application/manifest+json'): mime += '; charset=utf-8'
                return self._file(target,mime)
            if path in ('/musicos','/musicos/'):
                if path=='/musicos':
                    self.send_response(302); self.send_header('Location','/musicos/'+(('?'+parsed.query) if parsed.query else '')); self._cors(); self.end_headers(); return
                return self._file(MUSICOS_ROOT/'index.html','text/html; charset=utf-8')
            if path.startswith('/musicos/'):
                target=_safe_musicos_file(path)
                if target is None:return self._json({"ok":False,"error":"ruta inválida"},400)
                mime=mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                if mime.startswith('text/') or mime in ('application/javascript','application/json','application/manifest+json'): mime += '; charset=utf-8'
                return self._file(target,mime)
            if path=='/api/health':
                h=health_snapshot(); return self._json(h,200 if h.get('ok') else 500)
            if path=='/api/state': return self._json(state_snapshot())
            if path=='/api/photos': return self._json(photos_snapshot())
            if path=='/api/bridge/state': return self._json(bridge_state_snapshot())
            if path=='/api/catalog/status': return self._json(catalog_status())
            if path=='/api/custom-songs': return self._json(custom_songs_snapshot())
            if path=='/api/library': return self._json(library_snapshot())
            if path=='/api/catalog': return self._json(catalog_snapshot(qs.get('q',[''])[0],qs.get('limit',[500])[0]))
            if path=='/api/resolve-next': return self._json(resolve_next())
            if path=='/api/changes': return self._json(changes_snapshot(qs.get('limit',[200])[0]))
            if path=='/api/connectivity': return self._json(connectivity_snapshot())
            return self._json({"ok":False,"error":"ruta no encontrada"},404)
        except Exception as e:
            self.log_message('GET ERROR %s %r', self.path, e)
            return self._json({"ok":False,"error":"error interno","detail":str(e)},500)
    def do_POST(self):
        try:
            data=self._body()
            if self.path=='/api/custom-songs': return self._json(write_custom_songs(data))
            if self.path=='/api/library': return self._json(write_library_state(data))
            if self.path=='/api/show': return self._json(write_show(data))
            if self.path=='/api/public-config': return self._json(write_public_config(data))
            if self.path=='/api/photos': return self._json(write_photos(data))
            if self.path=='/api/queue/add': return self._json(add_item(data))
            if self.path=='/api/queue/played': return self._json(set_played(data))
            if self.path=='/api/queue/remove': return self._json(remove_item(data))
            if self.path=='/api/bridge/queue/remove': return self._json(remove_bridge_pending(data))
            if self.path=='/api/queue/reorder': return self._json(reorder_queue(data))
            if self.path=='/api/queue/clear': return self._json(clear_queue())
            return self._json({"ok":False,"error":"ruta no encontrada"},404)
        except (ValueError,json.JSONDecodeError) as e:return self._json({"ok":False,"error":str(e)},400)
        except Exception as e:self.log_message('ERROR %r',e); return self._json({"ok":False,"error":"error interno"},500)

def main():
    init_db()
    try: PID_PATH.write_text(str(os.getpid()))
    except Exception:pass

    httpd=ThreadingHTTPServer((HOST,PORT),Handler); httpd.daemon_threads=True
    httpsd=None
    tls_error=""
    try:
        _, cert_path, key_path = ensure_tls_material()
        httpsd=ThreadingHTTPServer((HOST,HTTPS_PORT),Handler); httpsd.daemon_threads=True
        ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(cert_path),keyfile=str(key_path))
        httpsd.socket=ctx.wrap_socket(httpsd.socket,server_side=True)
    except Exception as e:
        tls_error=str(e)
        httpsd=None

    servers=[httpd]+([httpsd] if httpsd else [])
    def shutdown(signum,frame):
        for srv in servers:
            threading.Thread(target=srv.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,shutdown); signal.signal(signal.SIGINT,shutdown)

    if httpsd:
        threading.Thread(target=httpsd.serve_forever,kwargs={'poll_interval':.5},daemon=True).start()

    ip=local_ip(); st=catalog_status()
    print('=== EGP LOCAL CORE v8 — OFFLINE REAL + HTTPS PWA ===',flush=True)
    print('HTTP Mac:   http://127.0.0.1:%d/'%PORT,flush=True)
    print('HTTP LAN:   http://%s:%d/'%(ip,PORT),flush=True)
    if httpsd:
        print('HTTPS PWA:  https://%s:%d/'%(TLS_TARGET_IP,HTTPS_PORT),flush=True)
        print('Instalación certificado: http://%s:%d/offline-setup'%(TLS_TARGET_IP,PORT),flush=True)
    else:
        print('HTTPS PWA:  ERROR %s'%tls_error,flush=True)
    print('Modo:  OFFLINE REAL — app cacheada + Local Core cuando la red EGP está disponible',flush=True)
    print('Catálogo: %d canciones / %d mapas Logic'%(st['songs'],st['logicMaps']),flush=True); print('',flush=True)
    try:httpd.serve_forever(poll_interval=.5)
    finally:
        try:PID_PATH.unlink(missing_ok=True)
        except Exception:pass
        for srv in servers:
            try:srv.server_close()
            except Exception:pass
if __name__=='__main__': main()
