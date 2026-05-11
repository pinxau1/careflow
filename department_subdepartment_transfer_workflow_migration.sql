USE s25101336_test;

CREATE TABLE IF NOT EXISTS queue_transfers (
  transfer_id INT AUTO_INCREMENT PRIMARY KEY,
  queue_id INT NOT NULL,
  from_department_id INT NOT NULL,
  to_department_id INT NOT NULL,
  status ENUM('waiting_department_call','in_subdepartment','completed','cancelled') NOT NULL DEFAULT 'waiting_department_call',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at DATETIME NULL,
  completed_at DATETIME NULL,

  KEY idx_queue_transfers_queue (queue_id),
  KEY idx_queue_transfers_status (status),
  KEY idx_queue_transfers_target_status (to_department_id, status),

  CONSTRAINT fk_queue_transfers_queue
    FOREIGN KEY (queue_id) REFERENCES queues(queue_id) ON DELETE CASCADE,
  CONSTRAINT fk_queue_transfers_from_department
    FOREIGN KEY (from_department_id) REFERENCES departments(department_id) ON DELETE RESTRICT,
  CONSTRAINT fk_queue_transfers_to_department
    FOREIGN KEY (to_department_id) REFERENCES departments(department_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS queue_subdepartment_requirements (
  requirement_id INT AUTO_INCREMENT PRIMARY KEY,
  transfer_id INT NOT NULL,
  subdepartment_id INT NOT NULL,
  status ENUM('pending','queued','serving','done','skipped') NOT NULL DEFAULT 'pending',
  queued_at DATETIME NULL,
  called_at DATETIME NULL,
  finished_at DATETIME NULL,

  KEY idx_queue_subdepartment_requirements_transfer_status (transfer_id, status),
  KEY idx_queue_subdepartment_requirements_subdepartment_status (subdepartment_id, status),

  CONSTRAINT fk_queue_subdepartment_requirements_transfer
    FOREIGN KEY (transfer_id) REFERENCES queue_transfers(transfer_id) ON DELETE CASCADE,
  CONSTRAINT fk_queue_subdepartment_requirements_subdepartment
    FOREIGN KEY (subdepartment_id) REFERENCES subdepartments(subdepartment_id) ON DELETE RESTRICT
) ENGINE=InnoDB;
