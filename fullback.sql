
SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT;
SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS;
SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION;
SET NAMES utf8mb4;
SET @OLD_TIME_ZONE=@@TIME_ZONE;
SET TIME_ZONE='+00:00';
SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';
SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0;

USE `s25101336_test`;

DROP TABLE IF EXISTS `queue_logs`;
DROP TABLE IF EXISTS `counters`;
DROP TABLE IF EXISTS `queues`;
DROP TABLE IF EXISTS `daily_counters`;
DROP TABLE IF EXISTS `ui_settings`;
DROP TABLE IF EXISTS `system_settings`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `departments`;
DROP TABLE IF EXISTS `USER`;

CREATE TABLE `USER` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `first_name` varchar(255) NOT NULL,
  `last_name` varchar(255) NOT NULL,
  `age` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `departments` (
  `department_id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `code` varchar(10) NOT NULL,
  `queue_status` enum('open','pause','closed') DEFAULT 'open',
  `pause_message` varchar(255) DEFAULT NULL,
  `paused_until` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`department_id`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('owner','admin','staff','patient') NOT NULL DEFAULT 'patient',
  `department_id` int(11) DEFAULT NULL,
  `full_name` varchar(150) DEFAULT NULL,
  `age` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `contact_number` (`contact_number`),
  KEY `fk_users_department` (`department_id`),
  CONSTRAINT `fk_users_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `queues` (
  `queue_id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(150) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `department_id` int(11) NOT NULL,
  `code` varchar(10) NOT NULL,
  `category` enum('general','support','priority','complaint') NOT NULL,
  `status` enum('waiting','serving','done','no_show','void') DEFAULT 'waiting',
  `visit_description` text DEFAULT NULL,
  `is_priority` tinyint(1) DEFAULT 0,
  `is_emergency` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `called_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`queue_id`),
  KEY `department_id` (`department_id`),
  KEY `idx_queue_status` (`status`),
  KEY `idx_queue_user` (`user_id`),
  KEY `idx_queue_created` (`created_at`),
  KEY `idx_queue_department_status` (`department_id`,`status`),
  CONSTRAINT `queues_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `queues_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=92 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `counters` (
  `counter_id` int(11) NOT NULL AUTO_INCREMENT,
  `department_id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `status` enum('open','break','closed') NOT NULL DEFAULT 'open',
  `break_until` time DEFAULT NULL,
  `current_queue_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`counter_id`),
  KEY `department_id` (`department_id`),
  KEY `idx_counters_current_queue` (`current_queue_id`),
  CONSTRAINT `counters_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_counters_current_queue` FOREIGN KEY (`current_queue_id`) REFERENCES `queues` (`queue_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `daily_counters` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `department_id` int(11) NOT NULL,
  `last_number` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_date_department` (`date`,`department_id`),
  KEY `department_id` (`department_id`),
  CONSTRAINT `daily_counters_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=95 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `queue_logs` (
  `log_id` int(11) NOT NULL AUTO_INCREMENT,
  `queue_id` int(11) NOT NULL,
  `actor_user_id` int(11) DEFAULT NULL,
  `action` enum('created','called','skipped','no_show','void','recall','served','transferred','assigned_counter') NOT NULL,
  `counter_id` int(11) DEFAULT NULL,
  `from_department_id` int(11) DEFAULT NULL,
  `to_department_id` int(11) DEFAULT NULL,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`log_id`),
  KEY `idx_logs_queue` (`queue_id`),
  KEY `idx_logs_actor` (`actor_user_id`),
  KEY `idx_logs_counter` (`counter_id`),
  KEY `idx_logs_from_department` (`from_department_id`),
  KEY `idx_logs_to_department` (`to_department_id`),
  KEY `idx_logs_created` (`created_at`),
  KEY `idx_logs_action` (`action`),
  CONSTRAINT `queue_logs_ibfk_1` FOREIGN KEY (`queue_id`) REFERENCES `queues` (`queue_id`) ON DELETE CASCADE,
  CONSTRAINT `queue_logs_ibfk_2` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queue_logs_counter` FOREIGN KEY (`counter_id`) REFERENCES `counters` (`counter_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queue_logs_from_department` FOREIGN KEY (`from_department_id`) REFERENCES `departments` (`department_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queue_logs_to_department` FOREIGN KEY (`to_department_id`) REFERENCES `departments` (`department_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `system_settings` (
  `id` int(11) NOT NULL DEFAULT 1,
  `queue_status` enum('open','pause','closed') DEFAULT 'open',
  `max_slots` int(11) DEFAULT 50,
  `current_slots` int(11) DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `ui_settings` (
  `id` int(11) NOT NULL DEFAULT 1,
  `system_name` varchar(100) DEFAULT 'CareFlow',
  `logo_text` varchar(100) DEFAULT 'CareFlow',
  `primary_color` varchar(20) DEFAULT '#1d9c6c',
  `footer_text` varchar(255) DEFAULT 'CareFlow Queue Management',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

LOCK TABLES `departments` WRITE;
ALTER TABLE `departments` DISABLE KEYS;
INSERT INTO `departments`
  (`department_id`, `name`, `code`, `queue_status`, `pause_message`, `paused_until`, `created_at`)
VALUES
  (5,'General Medicine','GM','open',NULL,NULL,'2026-04-28 06:32:38'),
  (6,'Pediatrics','PD','open',NULL,NULL,'2026-04-28 06:32:38'),
  (7,'Obstetrics','OB','open',NULL,NULL,'2026-04-28 06:32:38'),
  (8,'Emergency Room','ER','open',NULL,NULL,'2026-04-28 06:32:38'),
  (9,'Laboratory','LB','open',NULL,NULL,'2026-04-28 06:32:38'),
  (10,'Pharmacy','PH','open',NULL,NULL,'2026-04-28 06:32:38');
ALTER TABLE `departments` ENABLE KEYS;
UNLOCK TABLES;

LOCK TABLES `users` WRITE;
ALTER TABLE `users` DISABLE KEYS;
INSERT INTO `users`
  (`user_id`, `username`, `contact_number`, `password_hash`, `role`, `department_id`, `full_name`, `age`, `created_at`)
VALUES
  (3,'jiwoo','12321312321','$2b$10$sKxWAzHWXLUJOiQMlHAEWeQvYEAvr4WWzXTqcai4fxEbI.FNRUXlq','patient',NULL,'jiwoo',NULL,'2026-04-22 01:59:37'),
  (4,'admin',NULL,'$2a$12$B62rw7hBYX0x2gUHPW8puuANd.tLgWkr0Nb3ayO9yo/nQHORrFo02','admin',NULL,NULL,NULL,'2026-04-22 02:01:23'),
  (5,'kairi dynasty','09111111111','$2b$10$SLO4b61MaxxKQol391mfUuXbAZ827AxM5rI1mAjWqYbZwNxmb8lAi','patient',NULL,'kairi dynasty',NULL,'2026-04-28 03:02:49'),
  (6,'ian','10231209382','$2b$10$lARQL7/GlTysaOJSJg3sC.iQsdUU1HfakQydubX0LpmscT7FGVKC2','patient',NULL,'ian',NULL,'2026-04-28 10:53:58'),
  (7,'stella','10293812093','$2b$10$F7qPyydaS39h7gcKkoLiCOTY54ZPARgbeyZ9UNSSap4jXOmWgCid2','patient',NULL,'stella',NULL,'2026-04-28 10:54:24'),
  (9,'tartarus','10293801938','$2b$10$8Y8ssuCXRXHib0csQSkPreRRvJxn1Wia9M2jS/RLHj9qghsrZsyli','staff',5,'tartarus',NULL,'2026-04-28 12:32:49'),
  (10,'Vinz','secret','$2b$10$boVE2V.dvJQMNDoXKlP3seylVa/3if1vAyNoyrdsceRlX6fgQa5Yy','patient',NULL,'Vincent Pansoy',NULL,'2026-04-28 12:52:01'),
  (13,'dylan','09064959465','$2b$10$STNI.1vjsmL2Embu/RyAWuukobeTj/gG/9RhIW43IT7cgCyAU93/q','patient',NULL,'Dy',NULL,'2026-04-28 13:16:04'),
  (16,'panchoy','09012830918','$2b$10$w6jfqDWsk23gMtPO85kpE.9WE.pXIaRFNb/tAvVNr7Zu8bezrjA9y','patient',NULL,'pansoy',NULL,'2026-04-28 23:37:21');
ALTER TABLE `users` ENABLE KEYS;
UNLOCK TABLES;

LOCK TABLES `queues` WRITE;
ALTER TABLE `queues` DISABLE KEYS;
INSERT INTO `queues`
  (`queue_id`, `full_name`, `user_id`, `department_id`, `code`, `category`, `status`, `visit_description`, `is_priority`, `is_emergency`, `created_at`, `called_at`, `finished_at`)
VALUES
  (81,'kairi dynasty',5,9,'LB002','general','done','in dire need of a checkup',0,0,'2026-04-29 08:22:48','2026-04-29 08:23:00','2026-04-29 08:23:13'),
  (82,'Nick Gurr',3,5,'GM002','general','done','im 67 years old and i have diabetes',0,0,'2026-04-29 08:38:46','2026-04-29 08:39:14','2026-04-29 08:39:38'),
  (83,'Nick Gurr',3,5,'GM003','general','no_show','I have diabetes',0,0,'2026-04-29 08:40:33','2026-04-29 08:40:43',NULL),
  (84,'six seven',3,5,'GM004','priority','no_show','im 67 years old',1,0,'2026-04-29 08:41:30','2026-04-29 08:47:37',NULL),
  (85,'nick gurr III',3,5,'GM005','general','no_show','im diabetes',0,0,'2026-04-29 08:48:04','2026-04-29 08:48:23',NULL),
  (86,'nick gurr IV',3,5,'GM006','general','done','im diabetes',0,0,'2026-04-29 08:48:40','2026-04-29 15:48:55','2026-04-29 15:49:10'),
  (87,'normal',7,5,'GM007','general','done','adik adik',0,0,'2026-04-29 08:51:11','2026-04-29 15:49:10','2026-04-29 15:49:11'),
  (88,'Hermesa',3,8,'ER002','general','done','ano?',0,0,'2026-04-29 19:27:23','2026-04-29 19:28:02','2026-04-29 19:28:12'),
  (89,'amazing',3,5,'GM008','general','done','almat',0,0,'2026-04-29 19:30:28','2026-04-29 19:30:47','2026-04-29 19:30:49'),
  (90,'alksdfj',3,5,'GM009','general','done','aslkdfjalkdsfj',0,0,'2026-04-29 19:38:06','2026-04-29 19:38:17','2026-04-29 19:38:18'),
  (91,'asdfsaf',3,8,'ER003','general','done','adsfafa',0,0,'2026-04-29 19:38:50','2026-04-29 19:39:05','2026-04-29 19:39:30');
ALTER TABLE `queues` ENABLE KEYS;
UNLOCK TABLES;

LOCK TABLES `daily_counters` WRITE;
ALTER TABLE `daily_counters` DISABLE KEYS;
INSERT INTO `daily_counters`
  (`id`, `date`, `department_id`, `last_number`)
VALUES
  (57,'2026-04-28',5,19),
  (58,'2026-04-28',10,2),
  (78,'2026-04-29',5,9),
  (79,'2026-04-29',7,1),
  (80,'2026-04-29',10,1),
  (81,'2026-04-29',9,2),
  (82,'2026-04-29',8,3),
  (83,'2026-04-29',6,1);
ALTER TABLE `daily_counters` ENABLE KEYS;
UNLOCK TABLES;

LOCK TABLES `system_settings` WRITE;
ALTER TABLE `system_settings` DISABLE KEYS;
INSERT INTO `system_settings`
  (`id`, `queue_status`, `max_slots`, `current_slots`, `updated_at`)
VALUES
  (1,'open',50,0,'2026-04-28 06:32:39');
ALTER TABLE `system_settings` ENABLE KEYS;
UNLOCK TABLES;

LOCK TABLES `ui_settings` WRITE;
ALTER TABLE `ui_settings` DISABLE KEYS;
INSERT INTO `ui_settings`
  (`id`, `system_name`, `logo_text`, `primary_color`, `footer_text`, `updated_at`)
VALUES
  (1,'CareFlow','CareFlow','#1d9c6c','CareFlow Queue Management','2026-04-28 12:35:32');
ALTER TABLE `ui_settings` ENABLE KEYS;
UNLOCK TABLES;

SET TIME_ZONE=@OLD_TIME_ZONE;
SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;
SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT;
SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS;
SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION;
SET SQL_NOTES=@OLD_SQL_NOTES;

