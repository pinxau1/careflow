-- Smart subdepartment queue rebalancing support indexes.
-- Safe to run manually on MariaDB; existing indexes are checked before creation.

DELIMITER //

DROP PROCEDURE IF EXISTS add_smart_subdepartment_rebalance_indexes//

CREATE PROCEDURE add_smart_subdepartment_rebalance_indexes()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'queue_subdepartment_requirements'
      AND index_name = 'idx_qsr_subdepartment_status_queued'
  ) THEN
    CREATE INDEX idx_qsr_subdepartment_status_queued
      ON queue_subdepartment_requirements(subdepartment_id, status, queued_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'queue_subdepartment_requirements'
      AND index_name = 'idx_qsr_transfer_status_subdepartment'
  ) THEN
    CREATE INDEX idx_qsr_transfer_status_subdepartment
      ON queue_subdepartment_requirements(transfer_id, status, subdepartment_id);
  END IF;
END//

DELIMITER ;

CALL add_smart_subdepartment_rebalance_indexes();
DROP PROCEDURE add_smart_subdepartment_rebalance_indexes;
