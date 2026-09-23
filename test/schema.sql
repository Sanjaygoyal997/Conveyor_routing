-- Minimal copy of the production tables, for local testing only.
CREATE SCHEMA IF NOT EXISTS master;
CREATE SCHEMA IF NOT EXISTS curing;

CREATE TABLE master.users  (id int PRIMARY KEY);
CREATE TABLE master.reason (reason_id int PRIMARY KEY);
CREATE TABLE master.recipe (recipe_id int PRIMARY KEY);

CREATE TABLE master.runningsize_lookup (
    id serial PRIMARY KEY, equipment_id int NOT NULL UNIQUE, rim_size varchar NOT NULL,
    created_by varchar, dtandtime timestamp, spare varchar);

CREATE TABLE master.material_size_lookup (
    id serial PRIMARY KEY, material_id int NOT NULL, rim_size varchar NOT NULL,
    created_by varchar, dtandtime timestamp, area_id int);

CREATE TABLE master.rim_master (
    id int, name varchar, description varchar, isactive boolean,
    rim_id int PRIMARY KEY, local_area_id int);

CREATE TABLE curing.o_production (
    id serial PRIMARY KEY, equipment_id int NOT NULL,
    recipe_id int REFERENCES master.recipe (recipe_id),
    production_id varchar NOT NULL, workorder_no varchar, material_id int NOT NULL,
    quantity int NOT NULL, mould_code varchar, side varchar, quality_status int NOT NULL,
    reason_id int NOT NULL REFERENCES master.reason (reason_id), cycletime int NOT NULL,
    dtandtime timestamp NOT NULL, weight real,
    user_id int NOT NULL REFERENCES master.users (id),
    modified_dtandtime timestamp, remark varchar, state int NOT NULL,
    spare1 varchar, spare2 varchar, spare3 int);

-- dbm.o_production: only the columns the validation uses, plus a few results.
CREATE SCHEMA IF NOT EXISTS dbm;
CREATE TABLE dbm.o_production (
    id serial PRIMARY KEY, equipment_id int, dtandtime timestamp,
    model varchar(150), code varchar(150), barcode varchar(150),
    total_rank varchar(150), ro_total varchar(150));
CREATE INDEX idx_dbm_barcode ON dbm.o_production (barcode);

-- master.area_master (plant FK left out for the test DB)
CREATE TABLE master.area_master (
    id serial, name varchar(50) NOT NULL, description varchar(100),
    local_area_id int PRIMARY KEY, continuous int DEFAULT 0, plant_id int NOT NULL,
    local_bu_id int NOT NULL, slug varchar(100), created_by varchar, dtandtime time);
