"""Master-data fixes made from the validation UI.

Writes are disabled unless ALLOW_WRITES=true. Every request must name the
operator (X-User header); when ADMIN_TOKEN is set it must also send a matching
X-Admin-Token. Each change runs in one transaction together with a row in
master.rim_validation_audit holding the before/after values.

Rim sizes are always picked from master.rim_master (active rims only) and are
written as rim_master.rim_id (default), or as the name when RIM_SIZE_VALUE=name.
Rims are compared by name (master.fn_rim_name), since rim_master has one
rim_id per rim per area.
"""
import hmac
import os
from typing import Callable, Optional

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

DATABASE_URL = os.environ.get("DATABASE_URL", "")
STATEMENT_TIMEOUT_MS = int(os.environ.get("STATEMENT_TIMEOUT_MS", "60000"))
ALLOW_WRITES = os.environ.get("ALLOW_WRITES", "false").lower() in ("1", "true", "yes")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
RIM_SIZE_VALUE = os.environ.get("RIM_SIZE_VALUE", "rim_id")

router = APIRouter()


def config() -> dict:
    return {
        "writes_enabled": ALLOW_WRITES,
        "token_required": bool(ADMIN_TOKEN),
        "rim_size_value": RIM_SIZE_VALUE,
    }


def operator(
    x_user: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None),
) -> str:
    """Authorise a write and return the operator name."""
    if not ALLOW_WRITES:
        raise HTTPException(403, "Editing is switched off on this server (set ALLOW_WRITES=true)")
    if ADMIN_TOKEN and not hmac.compare_digest(x_admin_token or "", ADMIN_TOKEN):
        raise HTTPException(401, "Admin token is missing or wrong")
    user = (x_user or "").strip()
    if not user or len(user) > 50:
        raise HTTPException(422, "Enter your name (1-50 characters) before making changes")
    return user


def run_write(fn: Callable[[psycopg.Connection], dict]) -> dict:
    """Run fn inside one transaction; any exception rolls everything back."""
    try:
        with psycopg.connect(
            DATABASE_URL, row_factory=dict_row, options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}"
        ) as conn:
            with conn.transaction():
                return fn(conn)
    except psycopg.Error as exc:
        raise HTTPException(500, f"Database error: {exc}") from exc


def audit(conn, user, action, table, ref, before=None, after=None) -> None:
    conn.execute(
        """INSERT INTO master.rim_validation_audit (user_name, action, table_name, row_ref, before, after)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (user, action, table, ref,
         Jsonb(before) if before is not None else None,
         Jsonb(after) if after is not None else None),
    )


def active_rim(conn, rim_id: int, area_id: Optional[int]) -> dict:
    """Return the rim_master row if it is active (and usable in the area)."""
    rim = conn.execute(
        "SELECT rim_id, name, isactive, local_area_id FROM master.rim_master WHERE rim_id = %s",
        (rim_id,),
    ).fetchone()
    if not rim:
        raise HTTPException(404, f"rim_id {rim_id} not found in rim_master")
    if not rim["isactive"]:
        raise HTTPException(409, f"Rim {rim['name']} is inactive in rim_master; reactivate it first")
    if area_id is not None and rim["local_area_id"] is not None and rim["local_area_id"] != area_id:
        raise HTTPException(409, f"Rim {rim['name']} belongs to area {rim['local_area_id']}, not {area_id}")
    return rim


def rim_value(rim: dict) -> str:
    return rim["name"] if RIM_SIZE_VALUE == "name" else str(rim["rim_id"])


# ---- request bodies ---------------------------------------------------------
class MaterialRimIn(BaseModel):
    material_id: int
    rim_id: int
    area_id: Optional[int] = None


class AreaIn(BaseModel):
    area_id: int


class DedupeIn(BaseModel):
    material_id: int
    area_id: Optional[int] = None
    rim_size: str = Field(min_length=1, max_length=50)


class RunningIn(BaseModel):
    rim_id: int


# ---- material_size_lookup ---------------------------------------------------
@router.post("/api/fix/material-rim")
def add_material_rim(body: MaterialRimIn, user: str = Depends(operator)):
    """Map an active rim to a material (a material may accept several rims)."""
    def tx(conn):
        rim = active_rim(conn, body.rim_id, body.area_id)
        if (rim["name"] or "").strip().upper() == "NONE":
            raise HTTPException(409, "Rim None means 'equipment not available' and can't be mapped to a material")
        exists = conn.execute(
            """SELECT id FROM master.material_size_lookup
               WHERE material_id = %s AND area_id IS NOT DISTINCT FROM %s
                 AND master.fn_rim_name(rim_size) = master.fn_rim_name(%s)""",
            (body.material_id, body.area_id, rim_value(rim)),
        ).fetchone()
        if exists:
            raise HTTPException(409, f"Material {body.material_id} is already mapped to rim {rim['name']} (id {exists['id']})")
        row = conn.execute(
            """INSERT INTO master.material_size_lookup (material_id, rim_size, area_id, created_by, dtandtime)
               VALUES (%s, %s, %s, %s, now())
               RETURNING id, to_jsonb(material_size_lookup.*) AS after""",
            (body.material_id, rim_value(rim), body.area_id, user),
        ).fetchone()
        audit(conn, user, "map_rim", "material_size_lookup", f"id={row['id']}", after=row["after"])
        return {"ok": True, "message": f"Material {body.material_id} now accepts rim {rim['name']}", "id": row["id"]}
    return run_write(tx)


@router.delete("/api/fix/material-rim/{row_id}")
def remove_material_rim(row_id: int, user: str = Depends(operator)):
    def tx(conn):
        row = conn.execute(
            """DELETE FROM master.material_size_lookup t WHERE t.id = %s
               RETURNING t.material_id, master.fn_rim_name(t.rim_size) AS rim_name, to_jsonb(t.*) AS before""",
            (row_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, f"Mapping id {row_id} not found")
        audit(conn, user, "unmap_rim", "material_size_lookup", f"id={row_id}", before=row["before"])
        return {"ok": True, "message": f"Removed rim {row['rim_name']} from material {row['material_id']}"}
    return run_write(tx)


@router.patch("/api/fix/material-rim/{row_id}")
def set_material_rim_area(row_id: int, body: AreaIn, user: str = Depends(operator)):
    def tx(conn):
        before = conn.execute(
            "SELECT to_jsonb(t.*) AS j FROM master.material_size_lookup t WHERE t.id = %s FOR UPDATE", (row_id,)
        ).fetchone()
        if not before:
            raise HTTPException(404, f"Mapping id {row_id} not found")
        row = conn.execute(
            """UPDATE master.material_size_lookup t SET area_id = %s WHERE t.id = %s
               RETURNING to_jsonb(t.*) AS after""",
            (body.area_id, row_id),
        ).fetchone()
        audit(conn, user, "set_area", "material_size_lookup", f"id={row_id}", before["j"], row["after"])
        return {"ok": True, "message": f"Mapping {row_id} set to area {body.area_id}"}
    return run_write(tx)


@router.post("/api/fix/material-rim/dedupe")
def dedupe_material_rim(body: DedupeIn, user: str = Depends(operator)):
    """Keep the oldest row of a duplicated material/area/rim mapping, delete the rest."""
    def tx(conn):
        rows = conn.execute(
            """DELETE FROM master.material_size_lookup t
               WHERE  t.material_id = %(m)s AND t.area_id IS NOT DISTINCT FROM %(a)s
                 AND  master.fn_rim_name(t.rim_size) = master.fn_rim_name(%(r)s)
                 AND  t.id > (SELECT min(k.id) FROM master.material_size_lookup k
                              WHERE k.material_id = %(m)s AND k.area_id IS NOT DISTINCT FROM %(a)s
                                AND master.fn_rim_name(k.rim_size) = master.fn_rim_name(%(r)s))
               RETURNING t.id, to_jsonb(t.*) AS before""",
            {"m": body.material_id, "a": body.area_id, "r": body.rim_size},
        ).fetchall()
        for r in rows:
            audit(conn, user, "dedupe", "material_size_lookup", f"id={r['id']}", before=r["before"])
        return {"ok": True, "message": f"Removed {len(rows)} duplicate row(s)"}
    return run_write(tx)


# ---- runningsize_lookup -----------------------------------------------------
@router.put("/api/fix/running/{equipment_id}")
def set_running_rim(equipment_id: int, body: RunningIn, user: str = Depends(operator)):
    """Set (or create) the running rim of an equipment - i.e. record a changeover."""
    def tx(conn):
        rim = active_rim(conn, body.rim_id, None)
        before = conn.execute(
            "SELECT to_jsonb(t.*) AS j FROM master.runningsize_lookup t WHERE t.equipment_id = %s FOR UPDATE",
            (equipment_id,),
        ).fetchone()
        row = conn.execute(
            """INSERT INTO master.runningsize_lookup AS t (equipment_id, rim_size, created_by, dtandtime)
               VALUES (%s, %s, %s, now())
               ON CONFLICT (equipment_id) DO UPDATE
                   SET rim_size = EXCLUDED.rim_size, created_by = EXCLUDED.created_by, dtandtime = EXCLUDED.dtandtime
               RETURNING to_jsonb(t.*) AS after""",
            (equipment_id, rim_value(rim), user),
        ).fetchone()
        audit(conn, user, "set_running_rim", "runningsize_lookup", f"equipment_id={equipment_id}",
              before["j"] if before else None, row["after"])
        return {"ok": True, "message": f"Equipment {equipment_id} now running rim {rim['name']}"}
    return run_write(tx)


# ---- rim_master -------------------------------------------------------------
@router.post("/api/fix/rim/{rim_id}/activate")
def activate_rim(rim_id: int, user: str = Depends(operator)):
    def tx(conn):
        before = conn.execute(
            "SELECT to_jsonb(t.*) AS j FROM master.rim_master t WHERE t.rim_id = %s FOR UPDATE", (rim_id,)
        ).fetchone()
        if not before:
            raise HTTPException(404, f"rim_id {rim_id} not found in rim_master")
        row = conn.execute(
            "UPDATE master.rim_master t SET isactive = true WHERE t.rim_id = %s RETURNING t.name, to_jsonb(t.*) AS after",
            (rim_id,),
        ).fetchone()
        audit(conn, user, "activate_rim", "rim_master", f"rim_id={rim_id}", before["j"], row["after"])
        return {"ok": True, "message": f"Rim {row['name']} is active again"}
    return run_write(tx)
