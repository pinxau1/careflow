env "prod" {
  url = "mysql://s25101336_test:${getenv("DB_PASSWORD")}@localhost/s25101336_test"
  src = "file://database.sql"
  dev = "mysql://s25101336_test:${getenv("DB_PASSWORD")}@localhost/s25101336_atlas_dev"
}
