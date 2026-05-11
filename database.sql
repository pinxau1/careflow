USE s25101336_test;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  contact_number VARCHAR(50) UNIQUE,
  email VARCHAR(255) NULL,
  google_id VARCHAR(255) NULL,
  auth_provider VARCHAR(50) DEFAULT 'local',
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('owner', 'admin', 'staff', 'doctor', 'patient') NOT NULL DEFAULT 'patient',
  full_name VARCHAR(150),
  age INT,
  gender VARCHAR(30) NULL,
  department_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE departments (
  department_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  code VARCHAR(10) NOT NULL UNIQUE,
  queue_status ENUM('open','pause','closed') DEFAULT 'open',
  pause_message VARCHAR(255) NULL,
  paused_until DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE INDEX idx_users_department ON users(department_id);

ALTER TABLE users
  ADD CONSTRAINT fk_users_department
  FOREIGN KEY (department_id) REFERENCES departments(department_id)
  ON DELETE SET NULL;

CREATE TABLE department_schedules (
  schedule_id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  day_of_week TINYINT NOT NULL,
  opens_at TIME NULL,
  closes_at TIME NULL,
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_department_day (department_id, day_of_week),
  CONSTRAINT chk_department_schedule_day CHECK (day_of_week BETWEEN 0 AND 6),
  FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE counters (
  counter_id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,

  name VARCHAR(50) NOT NULL,

  status ENUM('open','break','closed') NOT NULL DEFAULT 'open',
  break_until TIME NULL,

  current_queue_id INT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,

  FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE subdepartments (
  subdepartment_id INT AUTO_INCREMENT PRIMARY KEY,
  department_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  status ENUM('open','break','closed') NOT NULL DEFAULT 'open',
  current_queue_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,

  KEY idx_subdepartments_department (department_id),

  FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE visits (
  visit_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  visit_date DATE NOT NULL,
  global_number INT NOT NULL,
  status ENUM('active','completed','cancelled','void') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uniq_visits_date_number (visit_date, global_number),
  KEY idx_visits_user_status (user_id, status),
  KEY idx_visits_date_number (visit_date, global_number),

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE queues (
  queue_id INT AUTO_INCREMENT PRIMARY KEY,

  full_name VARCHAR(150),
  age INT NULL,
  gender VARCHAR(30) NULL,
  user_id INT NOT NULL,
  department_id INT NOT NULL,
  counter_id INT NULL,
  subdepartment_id INT NULL,
  visit_id INT NOT NULL,

  code VARCHAR(32) NOT NULL,

  category ENUM(
    'general','support','priority','complaint'
  ) NOT NULL,

  status ENUM('waiting','serving','done','no_show','void','cancelled')
    DEFAULT 'waiting',

  visit_description TEXT NULL,
  ai_suggested_department VARCHAR(100) NULL,
  ai_category VARCHAR(50) NULL,
  ai_priority_level VARCHAR(30) NULL,
  ai_reason TEXT NULL,

  is_priority BOOLEAN DEFAULT FALSE,
  is_emergency BOOLEAN DEFAULT FALSE,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  called_at DATETIME NULL,
  finished_at DATETIME NULL,
  referred_from_queue_id INT NULL,
  transfer_reason TEXT NULL,
  transferred_by_user_id INT NULL,
  transferred_at DATETIME NULL,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE RESTRICT,
  CONSTRAINT fk_queues_visit
    FOREIGN KEY (visit_id) REFERENCES visits(visit_id) ON DELETE RESTRICT,
  CONSTRAINT fk_queues_referred_from
    FOREIGN KEY (referred_from_queue_id) REFERENCES queues(queue_id) ON DELETE SET NULL,
  CONSTRAINT fk_queues_transferred_by
    FOREIGN KEY (transferred_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE queues
  ADD CONSTRAINT fk_queues_counter
  FOREIGN KEY (counter_id) REFERENCES counters(counter_id)
  ON DELETE SET NULL;

ALTER TABLE queues
  ADD CONSTRAINT fk_queues_subdepartment
  FOREIGN KEY (subdepartment_id) REFERENCES subdepartments(subdepartment_id)
  ON DELETE SET NULL;

CREATE INDEX idx_counters_current_queue ON counters(current_queue_id);
CREATE INDEX idx_subdepartments_current_queue ON subdepartments(current_queue_id);

ALTER TABLE counters
  ADD CONSTRAINT fk_counters_current_queue
  FOREIGN KEY (current_queue_id) REFERENCES queues(queue_id)
  ON DELETE SET NULL;

ALTER TABLE subdepartments
  ADD CONSTRAINT fk_subdepartments_current_queue
  FOREIGN KEY (current_queue_id) REFERENCES queues(queue_id)
  ON DELETE SET NULL;

CREATE TABLE queue_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,

  queue_id INT NULL,
  actor_user_id INT NULL,
  department_id INT NULL,

  action VARCHAR(50) NOT NULL,
  details TEXT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (queue_id) REFERENCES queues(queue_id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE SET NULL
) ENGINE=InnoDB;


CREATE TABLE daily_counters (
  id INT AUTO_INCREMENT PRIMARY KEY,

  date DATE NOT NULL,
  department_id INT NOT NULL,
  last_number INT DEFAULT 0,

  UNIQUE KEY unique_date_department (date, department_id),

  FOREIGN KEY (department_id) REFERENCES departments(department_id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE visit_daily_counters (
  date DATE PRIMARY KEY,
  last_number INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE system_settings (
  id INT PRIMARY KEY DEFAULT 1,

  queue_status ENUM('open','pause','closed') DEFAULT 'open',

  max_slots INT DEFAULT 50,
  current_slots INT DEFAULT 0,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;




CREATE INDEX idx_queue_status ON queues(status);
CREATE INDEX idx_queue_user ON queues(user_id);
CREATE INDEX idx_queue_created ON queues(created_at);
CREATE INDEX idx_queue_department_status ON queues(department_id, status);
CREATE INDEX idx_queue_referred_from ON queues(referred_from_queue_id);
CREATE INDEX idx_queues_visit ON queues(visit_id);
CREATE INDEX idx_queues_counter_status ON queues(counter_id, status);
CREATE INDEX idx_queues_subdepartment_status ON queues(subdepartment_id, status);

CREATE UNIQUE INDEX unique_users_email ON users(email);
CREATE UNIQUE INDEX unique_users_google_id ON users(google_id);

CREATE INDEX idx_logs_queue ON queue_logs(queue_id);
CREATE INDEX idx_logs_actor ON queue_logs(actor_user_id);
CREATE INDEX idx_logs_department ON queue_logs(department_id);
CREATE INDEX idx_logs_created ON queue_logs(created_at);
CREATE INDEX idx_logs_action ON queue_logs(action);

CREATE INDEX idx_department_schedules_department ON department_schedules(department_id);
