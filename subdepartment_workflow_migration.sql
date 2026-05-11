USE s25101336_test;

ALTER TABLE users
  MODIFY role ENUM('owner','admin','staff','doctor','patient') NOT NULL DEFAULT 'patient';

ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS counter_id INT NULL AFTER department_id;

CREATE TABLE IF NOT EXISTS subdepartments (
  subdepartment_id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  status ENUM('open','break','closed') NOT NULL DEFAULT 'open',
  current_queue_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,

  KEY idx_subdepartments_department (department_id),
  KEY idx_subdepartments_current_queue (current_queue_id),

  CONSTRAINT fk_subdepartments_department
    FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE,
  CONSTRAINT fk_subdepartments_current_queue
    FOREIGN KEY (current_queue_id) REFERENCES queues(queue_id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE queues
  ADD COLUMN IF NOT EXISTS subdepartment_id INT NULL AFTER counter_id;

CREATE INDEX IF NOT EXISTS idx_queues_subdepartment_status ON queues(subdepartment_id, status);

ALTER TABLE queues
  ADD CONSTRAINT fk_queues_subdepartment
  FOREIGN KEY (subdepartment_id) REFERENCES subdepartments(subdepartment_id)
  ON DELETE SET NULL;
