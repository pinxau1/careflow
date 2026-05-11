-- Doctor/subdepartment transfer workflow hardening.
-- Run this against the selected application database.
-- This migration does not drop legacy transfer_groups data.

CREATE INDEX IF NOT EXISTS idx_queue_transfers_queue
  ON queue_transfers(queue_id);

CREATE INDEX IF NOT EXISTS idx_queue_subdepartment_requirements_transfer_status
  ON queue_subdepartment_requirements(transfer_id, status);

CREATE INDEX IF NOT EXISTS idx_queue_subdepartment_requirements_subdepartment_status
  ON queue_subdepartment_requirements(subdepartment_id, status);

SET @duplicate_queue_transfers := (
  SELECT COUNT(*)
  FROM (
    SELECT queue_id
    FROM queue_transfers
    GROUP BY queue_id
    HAVING COUNT(*) > 1
  ) AS duplicate_rows
);

SET @queue_transfer_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'queue_transfers'
    AND index_name = 'uniq_queue_transfers_queue'
);

SET @sql := IF(
  @queue_transfer_unique_exists = 0 AND @duplicate_queue_transfers = 0,
  'CREATE UNIQUE INDEX uniq_queue_transfers_queue ON queue_transfers(queue_id)',
  'SELECT ''Skipped uniq_queue_transfers_queue: index exists or duplicate queue_id rows must be cleaned first.'' AS migration_note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @duplicate_requirements := (
  SELECT COUNT(*)
  FROM (
    SELECT transfer_id, subdepartment_id
    FROM queue_subdepartment_requirements
    GROUP BY transfer_id, subdepartment_id
    HAVING COUNT(*) > 1
  ) AS duplicate_rows
);

SET @requirement_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'queue_subdepartment_requirements'
    AND index_name = 'uniq_qsr_transfer_subdepartment'
);

SET @sql := IF(
  @requirement_unique_exists = 0 AND @duplicate_requirements = 0,
  'CREATE UNIQUE INDEX uniq_qsr_transfer_subdepartment ON queue_subdepartment_requirements(transfer_id, subdepartment_id)',
  'SELECT ''Skipped uniq_qsr_transfer_subdepartment: index exists or duplicate requirement rows must be cleaned first.'' AS migration_note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verification queries.
SELECT department_id, name, status, current_queue_id
FROM subdepartments
WHERE deleted_at IS NULL
ORDER BY department_id, name;

SELECT status, COUNT(*) AS count
FROM queue_transfers
GROUP BY status
ORDER BY status;

SELECT subdepartment_id, status, COUNT(*) AS count
FROM queue_subdepartment_requirements
GROUP BY subdepartment_id, status
ORDER BY subdepartment_id, status;

SELECT queue_id, COUNT(*) AS duplicate_transfer_count
FROM queue_transfers
GROUP BY queue_id
HAVING COUNT(*) > 1;

SELECT transfer_id, subdepartment_id, COUNT(*) AS duplicate_requirement_count
FROM queue_subdepartment_requirements
GROUP BY transfer_id, subdepartment_id
HAVING COUNT(*) > 1;
