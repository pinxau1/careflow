env "prod" {
  url = "mysql://s25101336_test:${getenv("DB_PASSWORD")}@127.0.0.1:3307/s25101336_test"
  src = "file://database.sql"
  dev = "mysql://s25101336_atlas_dev:${getenv("DB_DEV_PASSWORD")}@127.0.0.1:3307/s25101336_atlas_dev"
}
