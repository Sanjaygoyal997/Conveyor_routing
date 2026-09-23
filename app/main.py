"""Rim-size validation UI: WIP between Curing and DBM, master-data gaps, barcode check,
and (when ALLOW_WRITES=true) fixes to the master data - see app/fixes.py.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 8000
DB:   DATABASE_URL (libpq conninfo/URL) or the standard PG* environment variables.
"""
import os
from pathlib import Path
from typing import Optional

import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg.rows import dict_row

from app import fixes

DATABASE_URL = os.environ.get("DATABASE_URL", "")
STATEMENT_TIMEOUT_MS = int(os.environ.get("STATEMENT_TIMEOUT_MS", "60000"))
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Rim Size Validation")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.include_router(fixes.router)


def query(sql: str, params: dict) -> list[dict]:
    """Run one read-only query and return rows as dicts."""
    try:
        with psycopg.connect(
            DATABASE_URL,
            row_factory=dict_row,
            options=f"-c default_transaction_read_only=on -c statement_timeout={STATEMENT_TIMEOUT_MS}",
        ) as conn:
            return conn.execute(sql, params).fetchall()
    except psycopg.Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc


def int_list(value: Optional[str], name: str) -> Optional[list[int]]:
    """'1, 2,3' -> [1, 2, 3]; blank -> None (no filter)."""
    if value is None or not value.strip():
        return None
    try:
        return [int(v) for v in value.split(",") if v.strip()]
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} must be a comma-separated list of integers")


def wip_params(hours, wip_states, ok_quality, area_id, exclude_at_dbm) -> dict:
    return {
        "hours": hours,
        "wip_states": int_list(wip_states, "wip_states"),
        "ok_quality": int_list(ok_quality, "ok_quality"),
        "area_id": area_id,
        "exclude_at_dbm": exclude_at_dbm,
    }


WIP_ARGS = """
    p_from           => (now() - make_interval(hours => %(hours)s))::timestamp,
    p_to             => now()::timestamp,
    p_wip_states     => %(wip_states)s::int[],
    p_ok_quality     => %(ok_quality)s::int[],
    p_area_id        => %(area_id)s::int,
    p_exclude_at_dbm => %(exclude_at_dbm)s::boolean"""

Hours = Query(48, ge=1, le=24 * 31, description="Look-back window in hours (default 2 days)")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    return query("SELECT now()::timestamp AS db_time, current_database() AS database", {})[0]


@app.get("/api/wip/readiness")
def wip_readiness(
    hours: int = Hours,
    wip_states: Optional[str] = None,
    ok_quality: Optional[str] = None,
    area_id: Optional[int] = None,
    exclude_at_dbm: bool = True,
):
    """One row per recipe + material in WIP (cured, not yet at DBM)."""
    return query(
        f"SELECT * FROM master.fn_wip_rim_readiness({WIP_ARGS})",
        wip_params(hours, wip_states, ok_quality, area_id, exclude_at_dbm),
    )


@app.get("/api/wip/demand")
def wip_demand(
    hours: int = Hours,
    wip_states: Optional[str] = None,
    ok_quality: Optional[str] = None,
    area_id: Optional[int] = None,
    exclude_at_dbm: bool = True,
):
    """One row per rim size: WIP tires needing it vs equipment running it."""
    return query(
        f"SELECT * FROM master.fn_wip_rim_demand({WIP_ARGS})",
        wip_params(hours, wip_states, ok_quality, area_id, exclude_at_dbm),
    )


@app.get("/api/gaps")
def master_data_gaps(hours: int = Hours, area_id: Optional[int] = None):
    return query(
        """SELECT * FROM master.fn_rim_master_data_gaps(
               p_from    => (now() - make_interval(hours => %(hours)s))::timestamp,
               p_to      => now()::timestamp,
               p_area_id => %(area_id)s::int)""",
        {"hours": hours, "area_id": area_id},
    )


@app.get("/api/config")
def get_config():
    return fixes.config()


@app.get("/api/running-sizes")
def running_sizes(area_id: Optional[int] = None, hours: int = Hours):
    """Equipment in runningsize_lookup, plus DBM equipment seen in the window without a row."""
    return query(
        """SELECT r.equipment_id, r.rim_size, master.fn_rim_name(r.rim_size) AS rim_name,
                  CASE master.fn_rim_name(r.rim_size)
                       WHEN 'NONE'         THEN 'NOT AVAILABLE'
                       WHEN 'UNIVERSALRIM' THEN 'UNIVERSAL'
                       ELSE master.fn_rim_status(r.rim_size, %(area_id)s::int) END AS rim_master_status,
                  r.created_by, r.dtandtime
           FROM   master.runningsize_lookup r
           UNION ALL
           SELECT DISTINCT d.equipment_id, NULL, NULL, 'NOT SET', NULL, NULL::timestamp
           FROM   dbm.o_production d
           WHERE  d.dtandtime >= (now() - make_interval(hours => %(hours)s))::timestamp
             AND  d.equipment_id IS NOT NULL
             AND  NOT EXISTS (SELECT 1 FROM master.runningsize_lookup r WHERE r.equipment_id = d.equipment_id)
           ORDER  BY 1""",
        {"area_id": area_id, "hours": hours},
    )


@app.get("/api/rims")
def rims():
    """rim_master, for picking a rim in the fix dialogs."""
    return query(
        """SELECT rim_id, name, master.fn_rim_key(name) AS rim_key, isactive, local_area_id, description
           FROM   master.rim_master
           ORDER  BY isactive DESC NULLS LAST, master.fn_rim_key(name), rim_id""",
        {},
    )


@app.get("/api/material/{material_id}")
def material_mapping(material_id: int):
    """Rim mappings of one material with rim status and the equipment running each rim."""
    return query(
        """SELECT m.id, m.material_id, m.rim_size, master.fn_rim_name(m.rim_size) AS rim_name,
                  m.area_id, m.created_by, m.dtandtime,
                  master.fn_rim_status(m.rim_size) AS rim_master_status,
                  (SELECT rm.rim_id FROM master.rim_master rm
                   WHERE  rm.rim_id::text = master.fn_rim_key(m.rim_size)
                      OR  master.fn_rim_key(rm.name) = master.fn_rim_key(m.rim_size)
                   ORDER  BY (rm.rim_id::text = master.fn_rim_key(m.rim_size)) DESC,
                             (rm.local_area_id IS NOT DISTINCT FROM m.area_id) DESC, rm.rim_id LIMIT 1) AS rim_id,
                  (SELECT array_agg(r.equipment_id ORDER BY r.equipment_id)
                   FROM   master.runningsize_lookup r
                   WHERE  master.fn_rim_name(r.rim_size) = master.fn_rim_name(m.rim_size)
                     AND  master.fn_rim_name(r.rim_size) <> 'NONE') AS equipment_running
           FROM   master.material_size_lookup m
           WHERE  m.material_id = %(material_id)s
           ORDER  BY m.id""",
        {"material_id": material_id},
    )


@app.get("/api/audit")
def audit_log(limit: int = Query(100, ge=1, le=1000)):
    return query(
        """SELECT id, dtandtime, user_name, action, table_name, row_ref, before, after
           FROM   master.rim_validation_audit
           ORDER  BY id DESC LIMIT %(limit)s""",
        {"limit": limit},
    )


@app.get("/api/barcode/{barcode}")
def barcode_check(
    barcode: str,
    equipment_id: Optional[int] = None,
    area_id: Optional[int] = None,
    ok_quality: Optional[str] = None,
):
    barcode = barcode.strip()
    if not barcode or len(barcode) > 150:
        raise HTTPException(status_code=422, detail="Invalid barcode")
    params = {
        "barcode": barcode,
        "equipment_id": equipment_id,
        "area_id": area_id,
        "ok_quality": int_list(ok_quality, "ok_quality"),
    }
    return {
        "validation": query(
            """SELECT * FROM master.fn_validate_tire_barcode(
                   %(barcode)s, %(equipment_id)s::int, %(area_id)s::int, %(ok_quality)s::int[])""",
            params,
        ),
        "curing": query(
            """SELECT o.dtandtime, o.equipment_id, o.recipe_id, o.material_id, o.mould_code, o.side,
                      o.quality_status, o.state
               FROM   curing.o_production o
               WHERE  o.production_id = %(barcode)s
               ORDER  BY o.dtandtime DESC LIMIT 10""",
            params,
        ),
        "dbm": query(
            """SELECT d.dtandtime, d.equipment_id, d.model, d.code, d.total_rank, d.ro_total
               FROM   dbm.o_production d
               WHERE  d.barcode = %(barcode)s
               ORDER  BY d.dtandtime DESC LIMIT 10""",
            params,
        ),
    }
