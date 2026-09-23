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
