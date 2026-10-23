-- Dev only: runs once, on an empty data volume. The app connects as this role;
-- migrations connect as POSTGRES_USER (the owner). Never reuse this password.
create role omniio_app login password 'omniio_app' nosuperuser nobypassrls nocreatedb nocreaterole;
