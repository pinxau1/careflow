/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19  Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: s25101336_test
-- ------------------------------------------------------
-- Server version	10.11.14-MariaDB-0+deb12u2

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `USER`
--

DROP TABLE IF EXISTS `USER`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `USER` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `first_name` varchar(255) NOT NULL,
  `last_name` varchar(255) NOT NULL,
  `age` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `USER`
--

LOCK TABLES `USER` WRITE;
/*!40000 ALTER TABLE `USER` DISABLE KEYS */;
/*!40000 ALTER TABLE `USER` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `counters`
--

DROP TABLE IF EXISTS `counters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
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
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `counters`
--

LOCK TABLES `counters` WRITE;
/*!40000 ALTER TABLE `counters` DISABLE KEYS */;
INSERT INTO `counters` VALUES
(16,5,'Counter 1','closed',NULL,NULL,'2026-05-02 09:13:00','2026-05-02 17:23:45'),
(17,5,'Counter 1','closed',NULL,NULL,'2026-05-02 09:13:00','2026-05-03 11:37:39'),
(18,9,'HIV test','closed',NULL,NULL,'2026-05-04 03:27:43','2026-05-08 00:41:52'),
(19,9,'XRAY','closed',NULL,NULL,'2026-05-04 03:28:16','2026-05-08 00:41:57');
/*!40000 ALTER TABLE `counters` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `daily_counters`
--

DROP TABLE IF EXISTS `daily_counters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `daily_counters` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `department_id` int(11) NOT NULL,
  `last_number` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_date_department` (`date`,`department_id`),
  KEY `department_id` (`department_id`),
  CONSTRAINT `daily_counters_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=149 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `daily_counters`
--

LOCK TABLES `daily_counters` WRITE;
/*!40000 ALTER TABLE `daily_counters` DISABLE KEYS */;
INSERT INTO `daily_counters` VALUES
(57,'2026-04-28',5,19),
(58,'2026-04-28',10,2),
(78,'2026-04-29',5,9),
(79,'2026-04-29',7,1),
(80,'2026-04-29',10,1),
(81,'2026-04-29',9,2),
(83,'2026-04-29',6,1),
(98,'2026-05-02',6,1),
(100,'2026-05-02',5,7),
(107,'2026-05-03',5,9),
(110,'2026-05-03',9,4),
(111,'2026-05-03',7,2),
(115,'2026-05-03',10,1),
(124,'2026-05-04',9,4),
(125,'2026-05-04',7,2),
(127,'2026-05-04',5,9),
(133,'2026-05-04',6,2),
(141,'2026-05-07',5,1);
/*!40000 ALTER TABLE `daily_counters` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `department_schedules`
--

DROP TABLE IF EXISTS `department_schedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `department_schedules` (
  `schedule_id` int(11) NOT NULL AUTO_INCREMENT,
  `department_id` int(11) NOT NULL,
  `day_of_week` tinyint(4) NOT NULL,
  `opens_at` time DEFAULT NULL,
  `closes_at` time DEFAULT NULL,
  `is_closed` tinyint(1) NOT NULL DEFAULT 0,
  `note` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`schedule_id`),
  UNIQUE KEY `unique_department_day` (`department_id`,`day_of_week`),
  KEY `idx_department_schedules_department` (`department_id`),
  CONSTRAINT `fk_department_schedules_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE CASCADE,
  CONSTRAINT `chk_department_schedule_day` CHECK (`day_of_week` between 0 and 6)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `department_schedules`
--

LOCK TABLES `department_schedules` WRITE;
/*!40000 ALTER TABLE `department_schedules` DISABLE KEYS */;
INSERT INTO `department_schedules` VALUES
(1,5,1,'08:00:00','17:00:00',0,'Regular clinic hours','2026-05-03 00:57:12','2026-05-03 00:57:12'),
(2,9,1,'09:00:00','20:00:00',0,NULL,'2026-05-03 01:09:03','2026-05-03 01:09:03'),
(3,9,2,'09:00:00','20:00:00',0,NULL,'2026-05-03 01:09:03','2026-05-03 01:09:03'),
(4,9,3,'09:00:00','20:00:00',0,NULL,'2026-05-03 01:09:04','2026-05-03 01:09:04'),
(5,9,4,'09:00:00','20:00:00',0,NULL,'2026-05-03 01:09:04','2026-05-03 01:09:04'),
(6,9,5,'09:00:00','20:00:00',0,NULL,'2026-05-03 01:09:04','2026-05-03 01:09:04'),
(7,10,0,'09:00:00','20:00:00',0,NULL,'2026-05-03 03:58:28','2026-05-03 03:58:28'),
(8,10,1,'09:00:00','20:00:00',0,NULL,'2026-05-03 03:58:28','2026-05-03 03:58:28'),
(9,10,2,'09:00:00','20:00:00',0,NULL,'2026-05-03 03:58:28','2026-05-03 03:58:28'),
(10,10,3,'09:00:00','20:00:00',0,NULL,'2026-05-03 03:58:29','2026-05-03 03:58:29'),
(11,10,4,'09:00:00','20:00:00',0,NULL,'2026-05-03 03:58:29','2026-05-03 03:58:29'),
(12,10,5,'09:00:00','20:00:00',0,NULL,'2026-05-03 03:58:29','2026-05-03 03:58:29'),
(13,10,6,'09:00:00','20:00:00',0,NULL,'2026-05-03 03:58:30','2026-05-03 03:58:30'),
(14,7,0,'06:00:00','23:00:00',0,NULL,'2026-05-03 03:58:52','2026-05-03 03:58:52'),
(15,7,2,'06:00:00','23:00:00',0,NULL,'2026-05-03 03:58:52','2026-05-03 03:58:52'),
(16,7,6,'06:00:00','23:00:00',0,NULL,'2026-05-03 03:58:53','2026-05-03 03:58:53'),
(17,6,0,'08:30:00','21:00:00',0,NULL,'2026-05-03 04:54:39','2026-05-03 04:54:39'),
(18,6,2,'08:30:00','21:00:00',0,NULL,'2026-05-03 04:54:40','2026-05-03 04:54:40'),
(19,6,3,'08:30:00','21:00:00',0,NULL,'2026-05-03 04:54:40','2026-05-03 04:54:40'),
(20,6,4,'08:30:00','21:00:00',0,NULL,'2026-05-03 04:54:40','2026-05-03 04:54:40'),
(21,6,5,'08:30:00','21:00:00',0,NULL,'2026-05-03 04:54:40','2026-05-03 04:54:40'),
(22,6,6,'08:30:00','21:00:00',0,NULL,'2026-05-03 04:54:41','2026-05-03 04:54:41');
/*!40000 ALTER TABLE `department_schedules` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `departments`
--

DROP TABLE IF EXISTS `departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `departments` (
  `department_id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `code` varchar(10) NOT NULL,
  `queue_status` enum('open','closed') DEFAULT 'open',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`department_id`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `departments`
--

LOCK TABLES `departments` WRITE;
/*!40000 ALTER TABLE `departments` DISABLE KEYS */;
INSERT INTO `departments` VALUES
(5,'General Medicine','GM','open',NULL,NULL,'2026-04-28 06:32:38'),
(6,'Pediatrics','PD','open',NULL,NULL,'2026-04-28 06:32:38'),
(7,'Obstetrics','OB','open',NULL,NULL,'2026-04-28 06:32:38'),
(9,'Laboratory','LB','open',NULL,NULL,'2026-04-28 06:32:38'),
(10,'Pharmacy','PH','open',NULL,NULL,'2026-04-28 06:32:38');
/*!40000 ALTER TABLE `departments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `queue_logs`
--

DROP TABLE IF EXISTS `queue_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `queue_logs` (
  `log_id` int(11) NOT NULL AUTO_INCREMENT,
  `queue_id` int(11) DEFAULT NULL,
  `actor_user_id` int(11) DEFAULT NULL,
  `department_id` int(11) DEFAULT NULL,
  `action` varchar(50) NOT NULL,
  `details` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`log_id`),
  KEY `idx_logs_queue` (`queue_id`),
  KEY `idx_logs_actor` (`actor_user_id`),
  KEY `idx_logs_created` (`created_at`),
  KEY `idx_logs_action` (`action`),
  KEY `fk_queue_logs_department` (`department_id`),
  CONSTRAINT `fk_queue_logs_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queue_logs_queue` FOREIGN KEY (`queue_id`) REFERENCES `queues` (`queue_id`) ON DELETE SET NULL,
  CONSTRAINT `queue_logs_ibfk_2` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=245 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `queue_logs`
--

LOCK TABLES `queue_logs` WRITE;
/*!40000 ALTER TABLE `queue_logs` DISABLE KEYS */;
INSERT INTO `queue_logs` VALUES
(1,NULL,7,NULL,'created',NULL,'2026-04-29 14:51:32'),
(2,NULL,6,NULL,'created',NULL,'2026-04-29 14:55:52'),
(3,NULL,9,NULL,'called',NULL,'2026-04-29 14:56:29'),
(4,NULL,9,NULL,'recall',NULL,'2026-04-29 14:56:37'),
(5,NULL,9,NULL,'served',NULL,'2026-04-29 14:56:41'),
(6,NULL,9,NULL,'called',NULL,'2026-04-29 14:56:41'),
(7,NULL,9,NULL,'served',NULL,'2026-04-29 14:56:50'),
(8,NULL,3,NULL,'created',NULL,'2026-04-29 15:28:06'),
(9,NULL,4,NULL,'called',NULL,'2026-05-02 07:11:40'),
(10,NULL,4,NULL,'served',NULL,'2026-05-02 07:11:44'),
(11,NULL,3,NULL,'created',NULL,'2026-05-02 07:45:21'),
(12,NULL,7,NULL,'created',NULL,'2026-05-02 07:47:58'),
(13,NULL,4,NULL,'called',NULL,'2026-05-02 07:50:09'),
(14,NULL,4,NULL,'served',NULL,'2026-05-02 07:50:26'),
(15,NULL,NULL,NULL,'called',NULL,'2026-05-02 07:53:00'),
(16,NULL,NULL,NULL,'served',NULL,'2026-05-02 07:53:07'),
(17,NULL,7,NULL,'created',NULL,'2026-05-02 07:55:54'),
(18,NULL,4,NULL,'called',NULL,'2026-05-02 08:12:22'),
(19,NULL,4,NULL,'served',NULL,'2026-05-02 08:12:24'),
(20,NULL,4,NULL,'created',NULL,'2026-05-02 08:12:44'),
(21,NULL,4,NULL,'called',NULL,'2026-05-02 08:55:13'),
(22,NULL,4,NULL,'recall',NULL,'2026-05-02 08:55:15'),
(23,NULL,4,NULL,'recall',NULL,'2026-05-02 08:57:01'),
(24,NULL,4,NULL,'served',NULL,'2026-05-02 09:11:07'),
(25,NULL,3,NULL,'created',NULL,'2026-05-02 13:20:49'),
(26,NULL,7,NULL,'created',NULL,'2026-05-02 13:21:56'),
(27,NULL,6,NULL,'created',NULL,'2026-05-02 13:22:09'),
(28,NULL,4,NULL,'called',NULL,'2026-05-02 13:22:23'),
(29,NULL,4,NULL,'served',NULL,'2026-05-02 13:22:28'),
(30,NULL,4,NULL,'called',NULL,'2026-05-02 13:22:29'),
(31,NULL,4,NULL,'served',NULL,'2026-05-02 13:22:33'),
(32,NULL,4,NULL,'called',NULL,'2026-05-02 13:22:34'),
(33,NULL,4,NULL,'served',NULL,'2026-05-02 13:22:37'),
(34,NULL,3,NULL,'created',NULL,'2026-05-02 13:39:07'),
(35,NULL,3,NULL,'cancelled',NULL,'2026-05-02 13:39:12'),
(36,NULL,3,NULL,'created',NULL,'2026-05-02 13:39:33'),
(37,NULL,4,NULL,'cancelled',NULL,'2026-05-02 13:39:48'),
(38,NULL,3,5,'queue_created','{\"code\":\"GM001\",\"patientName\":\"alkdjf\",\"category\":\"general\",\"source\":\"patient\"}','2026-05-02 16:25:58'),
(39,NULL,4,5,'admin_added_queue','{\"code\":\"GM002\",\"patientName\":\"AMAZING GLAK\",\"category\":\"general\",\"source\":\"admin\"}','2026-05-02 16:31:14'),
(40,NULL,4,5,'admin_added_queue','{\"code\":\"GM003\",\"patientName\":\"gangalang alskdj\",\"category\":\"general\",\"source\":\"admin\"}','2026-05-02 16:31:35'),
(41,NULL,4,5,'called_next','{\"code\":\"GM001\",\"counter_id\":17,\"counter_name\":\"Counter 1\"}','2026-05-02 16:45:54'),
(42,NULL,4,5,'served','{\"counter_id\":17,\"source\":\"call_next\"}','2026-05-03 00:37:34'),
(43,NULL,4,5,'called_next','{\"code\":\"GM002\",\"counter_id\":17,\"counter_name\":\"Counter 1\"}','2026-05-03 00:37:34'),
(44,NULL,4,5,'served','{\"counter_id\":17,\"source\":\"call_next\"}','2026-05-03 00:37:39'),
(45,NULL,4,5,'called_next','{\"code\":\"GM003\",\"counter_id\":17,\"counter_name\":\"Counter 1\"}','2026-05-03 00:37:39'),
(46,NULL,4,5,'served','{\"counter_id\":17,\"source\":\"call_next\"}','2026-05-03 00:37:45'),
(47,NULL,6,9,'queue_created','{\"code\":\"LB001\",\"patientName\":\"Jiwoo\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-03 01:59:57'),
(48,NULL,6,9,'queue_cancelled','{\"code\":\"LB001\",\"cancelled_by\":\"patient\"}','2026-05-03 02:00:15'),
(49,NULL,3,7,'queue_created','{\"code\":\"OB001\",\"patientName\":\"Tatay Digong\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-03 03:43:00'),
(50,NULL,3,7,'queue_cancelled','{\"code\":\"OB001\",\"cancelled_by\":\"patient\"}','2026-05-03 03:43:13'),
(51,NULL,3,NULL,'queue_created','{\"code\":\"ER001\",\"patientName\":\"Tatay Digong\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-03 03:43:18'),
(52,NULL,3,NULL,'queue_cancelled','{\"code\":\"ER001\",\"cancelled_by\":\"patient\"}','2026-05-03 03:51:42'),
(53,NULL,3,9,'queue_created','{\"code\":\"LB002\",\"patientName\":\"Test\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-03 03:53:43'),
(54,NULL,3,9,'queue_cancelled','{\"code\":\"LB002\",\"cancelled_by\":\"patient\"}','2026-05-03 03:53:48'),
(55,NULL,3,9,'queue_created','{\"code\":\"LB003\",\"patientName\":\"Tatay Digong\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-03 03:57:17'),
(56,NULL,3,9,'queue_cancelled','{\"code\":\"LB003\",\"cancelled_by\":\"patient\"}','2026-05-03 03:57:21'),
(57,NULL,6,10,'queue_created','{\"code\":\"PH001\",\"patientName\":\"Kent Andrew\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-03 04:00:17'),
(58,NULL,6,10,'queue_cancelled','{\"code\":\"PH001\",\"cancelled_by\":\"patient\"}','2026-05-03 04:00:24'),
(59,NULL,3,5,'queue_created','{\"code\":\"GM004\",\"patientName\":\"AAAAAAAAAAAW\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-03 05:43:04'),
(60,NULL,6,5,'queue_created','{\"code\":\"GM005\",\"patientName\":\"AWXZ\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-03 05:43:21'),
(61,NULL,4,7,'status_changed','{\"change\":\"transferred\",\"from_department_id\":5,\"to_department_id\":\"7\",\"notes\":null}','2026-05-03 05:43:43'),
(62,NULL,4,7,'called_next','{\"code\":\"GM004\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 05:44:10'),
(63,NULL,4,7,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 05:44:18'),
(64,NULL,4,5,'called_next','{\"code\":\"GM005\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 06:23:33'),
(65,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:23:38'),
(66,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:35:29'),
(67,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:43:57'),
(68,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:14'),
(69,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:34'),
(70,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:35'),
(71,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:35'),
(72,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:35'),
(73,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:35'),
(74,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:35'),
(75,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:36'),
(76,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:36'),
(77,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 06:44:54'),
(78,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 06:59:17'),
(79,NULL,4,5,'admin_added_queue','{\"code\":\"GM006\",\"patientName\":\"ALKAW alkfj\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"admin\"}','2026-05-03 06:59:53'),
(80,NULL,4,5,'called_next','{\"code\":\"GM006\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 07:00:06'),
(81,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 07:00:12'),
(82,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 07:02:04'),
(83,NULL,4,5,'admin_added_queue','{\"code\":\"GM007\",\"patientName\":\"JAK TRAM\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"admin\"}','2026-05-03 07:27:17'),
(84,NULL,4,5,'called_next','{\"code\":\"GM007\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 07:27:28'),
(85,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-03 07:27:49'),
(86,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 07:45:12'),
(87,NULL,4,5,'admin_added_queue','{\"code\":\"GM008\",\"patientName\":\"alskdfj lkajsdlfkj\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"admin\"}','2026-05-03 08:12:42'),
(88,NULL,4,5,'called_next','{\"code\":\"GM008\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 08:12:48'),
(89,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 08:24:42'),
(90,NULL,4,5,'called_next','{\"code\":\"GM007\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 08:24:42'),
(91,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 08:24:47'),
(92,NULL,4,5,'called_next','{\"code\":\"GM007\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 08:24:48'),
(93,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 08:24:53'),
(94,NULL,4,5,'called_next','{\"code\":\"GM007\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 08:24:53'),
(95,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 08:24:58'),
(96,NULL,4,5,'transferred','{\"source_queue_id\":116,\"source_queue_code\":\"GM007\",\"target_queue_id\":118,\"target_queue_code\":\"OB002\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_department_id\":7,\"target_department\":\"Obstetrics\",\"reason\":null}','2026-05-03 08:25:04'),
(97,NULL,4,7,'queue_created_from_transfer','{\"source_queue_id\":116,\"source_queue_code\":\"GM007\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_queue_code\":\"OB002\",\"reason\":null}','2026-05-03 08:25:04'),
(98,NULL,4,7,'called_next','{\"code\":\"OB002\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 08:25:10'),
(99,NULL,4,7,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 08:25:13'),
(100,NULL,19,5,'queue_created','{\"code\":\"GM009\",\"patientName\":\"Dyla\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-03 10:07:14'),
(101,NULL,4,5,'called_next','{\"code\":\"GM009\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 10:08:15'),
(102,NULL,4,5,'email_notification_failed','{\"type\":\"call\",\"to\":\"d@usc.edu.ph\",\"queue_code\":\"GM009\",\"error\":\"connect ECONNREFUSED 127.0.0.1:587\"}','2026-05-03 10:08:15'),
(103,NULL,3,9,'queue_created','{\"code\":\"LB004\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-03 10:34:29'),
(104,NULL,4,9,'called_next','{\"code\":\"LB004\",\"counter_id\":null,\"counter_name\":null}','2026-05-03 10:34:48'),
(105,NULL,4,9,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-03 10:35:02'),
(106,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-04 01:38:38'),
(107,NULL,4,5,'email_notification_failed','{\"type\":\"recall\",\"to\":\"d@usc.edu.ph\",\"queue_code\":\"GM009\",\"error\":\"connect ECONNREFUSED 127.0.0.1:587\"}','2026-05-04 01:38:38'),
(108,NULL,22,9,'queue_created','{\"code\":\"LB001\",\"patientName\":\"Kent Andrew Rojas\",\"age\":19,\"gender\":\"Male\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-04 01:42:52'),
(109,NULL,4,9,'called_next','{\"code\":\"LB001\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 01:43:14'),
(110,NULL,4,9,'email_notification_failed','{\"type\":\"call\",\"to\":\"23102075@usc.edu.ph\",\"queue_code\":\"LB001\",\"error\":\"connect ECONNREFUSED ::1:587\"}','2026-05-04 01:43:14'),
(111,NULL,4,9,'recalled','{\"status\":\"serving\"}','2026-05-04 01:43:23'),
(112,NULL,4,9,'email_notification_failed','{\"type\":\"recall\",\"to\":\"23102075@usc.edu.ph\",\"queue_code\":\"LB001\",\"error\":\"connect ECONNREFUSED ::1:587\"}','2026-05-04 01:43:23'),
(113,NULL,4,9,'recalled','{\"status\":\"serving\"}','2026-05-04 01:43:40'),
(114,NULL,4,9,'email_notification_failed','{\"type\":\"recall\",\"to\":\"23102075@usc.edu.ph\",\"queue_code\":\"LB001\",\"error\":\"connect ECONNREFUSED ::1:587\"}','2026-05-04 01:43:40'),
(115,NULL,4,9,'recalled','{\"status\":\"serving\"}','2026-05-04 01:51:38'),
(116,NULL,4,9,'email_notification_failed','{\"type\":\"recall\",\"to\":\"23102075@usc.edu.ph\",\"queue_code\":\"LB001\",\"error\":\"connect ECONNREFUSED 127.0.0.1:587\"}','2026-05-04 01:51:38'),
(117,NULL,4,9,'recalled','{\"status\":\"serving\"}','2026-05-04 01:52:34'),
(118,NULL,4,9,'email_notification_sent','{\"type\":\"recall\",\"to\":\"23102075@usc.edu.ph\",\"queue_code\":\"LB001\"}','2026-05-04 01:52:38'),
(119,NULL,4,9,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 02:07:25'),
(120,NULL,4,9,'transferred','{\"source_queue_id\":121,\"source_queue_code\":\"LB001\",\"target_queue_id\":122,\"target_queue_code\":\"OB001\",\"source_department_id\":9,\"source_department\":\"Laboratory\",\"target_department_id\":7,\"target_department\":\"Obstetrics\",\"reason\":null}','2026-05-04 02:07:29'),
(121,NULL,4,7,'queue_created_from_transfer','{\"source_queue_id\":121,\"source_queue_code\":\"LB001\",\"source_department_id\":9,\"source_department\":\"Laboratory\",\"target_queue_code\":\"OB001\",\"reason\":null}','2026-05-04 02:07:29'),
(122,NULL,4,7,'called_next','{\"code\":\"OB001\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 02:07:42'),
(123,NULL,4,7,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 02:07:45'),
(124,NULL,4,7,'email_notification_sent','{\"type\":\"call\",\"to\":\"23102075@usc.edu.ph\",\"queue_code\":\"OB001\"}','2026-05-04 02:07:46'),
(125,NULL,4,5,'status_changed','{\"scope\":\"department_queue_status\",\"queue_status\":\"closed\"}','2026-05-04 02:08:08'),
(126,NULL,4,5,'status_changed','{\"scope\":\"department_queue_status\",\"queue_status\":\"open\"}','2026-05-04 02:08:31'),
(127,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 02:09:54'),
(128,NULL,5,7,'queue_created','{\"code\":\"OB002\",\"patientName\":\"kairi dynasty\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-04 02:16:29'),
(129,NULL,5,7,'queue_cancelled','{\"code\":\"OB002\",\"cancelled_by\":\"patient\"}','2026-05-04 02:17:02'),
(130,NULL,5,5,'queue_created','{\"code\":\"GM001\",\"patientName\":\"kairi dynasty\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 02:17:27'),
(131,NULL,4,5,'called_next','{\"code\":\"GM001\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 02:19:46'),
(132,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 02:20:15'),
(133,NULL,4,5,'transferred','{\"source_queue_id\":124,\"source_queue_code\":\"GM001\",\"target_queue_id\":125,\"target_queue_code\":\"LB002\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_department_id\":9,\"target_department\":\"Laboratory\",\"reason\":null}','2026-05-04 02:20:40'),
(134,NULL,4,9,'queue_created_from_transfer','{\"source_queue_id\":124,\"source_queue_code\":\"GM001\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_queue_code\":\"LB002\",\"reason\":null}','2026-05-04 02:20:40'),
(135,NULL,4,9,'called_next','{\"code\":\"LB002\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 02:20:45'),
(136,NULL,4,9,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 02:22:37'),
(137,NULL,5,5,'queue_created','{\"code\":\"GM002\",\"patientName\":\"kairi dynasty\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 02:57:29'),
(138,NULL,4,5,'called_next','{\"code\":\"GM002\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 02:57:37'),
(139,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 02:57:44'),
(140,NULL,5,5,'queue_created','{\"code\":\"GM003\",\"patientName\":\"kairi dynasty\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 02:57:53'),
(141,NULL,4,5,'deleted','{\"previous_status\":\"waiting\",\"deleted_as\":\"void\"}','2026-05-04 02:58:04'),
(142,NULL,3,5,'queue_created','{\"code\":\"GM004\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":\"urgent_review\",\"source\":\"patient\"}','2026-05-04 03:01:56'),
(143,NULL,4,5,'called_next','{\"code\":\"GM004\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 03:02:39'),
(144,NULL,4,5,'recalled','{\"status\":\"serving\"}','2026-05-04 03:02:52'),
(145,NULL,4,5,'skipped','{\"notes\":null}','2026-05-04 03:03:05'),
(146,NULL,3,5,'queue_created','{\"code\":\"GM005\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 03:04:30'),
(147,NULL,4,5,'called_next','{\"code\":\"GM005\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 03:04:35'),
(148,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 03:04:39'),
(149,NULL,4,5,'transferred','{\"source_queue_id\":129,\"source_queue_code\":\"GM005\",\"target_queue_id\":130,\"target_queue_code\":\"PD001\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_department_id\":6,\"target_department\":\"Pediatrics\",\"reason\":\"Child\"}','2026-05-04 03:05:14'),
(150,NULL,4,6,'queue_created_from_transfer','{\"source_queue_id\":129,\"source_queue_code\":\"GM005\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_queue_code\":\"PD001\",\"reason\":\"Child\"}','2026-05-04 03:05:14'),
(151,NULL,4,6,'called_next','{\"code\":\"PD001\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 03:05:22'),
(152,NULL,4,6,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 03:05:49'),
(153,NULL,3,5,'queue_created','{\"code\":\"GM006\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 03:07:47'),
(154,NULL,6,5,'queue_created','{\"code\":\"GM007\",\"patientName\":\"ian\",\"age\":12,\"gender\":\"Prefer not to say\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 03:08:02'),
(155,NULL,7,5,'queue_created','{\"code\":\"GM008\",\"patientName\":\"stella\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 03:08:22'),
(156,NULL,22,9,'queue_created','{\"code\":\"LB003\",\"patientName\":\"Kent Andrew Rojas\",\"age\":19,\"gender\":\"Male\",\"category\":\"general\",\"ai_priority_level\":\"normal\",\"source\":\"patient\"}','2026-05-04 03:08:25'),
(157,NULL,5,5,'queue_created','{\"code\":\"GM009\",\"patientName\":\"kairi dynasty\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 03:08:34'),
(158,NULL,4,5,'called_next','{\"code\":\"GM006\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 03:08:53'),
(159,NULL,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 03:09:13'),
(160,NULL,4,5,'called_next','{\"code\":\"GM007\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 03:09:13'),
(161,NULL,4,5,'transferred','{\"source_queue_id\":131,\"source_queue_code\":\"GM006\",\"target_queue_id\":136,\"target_queue_code\":\"LB004\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_department_id\":9,\"target_department\":\"Laboratory\",\"reason\":null}','2026-05-04 03:10:37'),
(162,NULL,4,9,'queue_created_from_transfer','{\"source_queue_id\":131,\"source_queue_code\":\"GM006\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_queue_code\":\"LB004\",\"reason\":null}','2026-05-04 03:10:37'),
(163,NULL,4,9,'called_next','{\"code\":\"LB003\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 03:11:31'),
(164,NULL,4,9,'email_notification_sent','{\"type\":\"call\",\"to\":\"23102075@usc.edu.ph\",\"queue_code\":\"LB003\"}','2026-05-04 03:11:35'),
(165,NULL,4,9,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 03:11:36'),
(166,NULL,4,9,'called_next','{\"code\":\"LB004\",\"counter_id\":null,\"counter_name\":null}','2026-05-04 03:11:36'),
(167,NULL,22,6,'queue_created','{\"code\":\"PD002\",\"patientName\":\"Kent Andrew Rojas\",\"age\":19,\"gender\":\"Male\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-04 03:23:00'),
(168,NULL,4,9,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-04 03:31:24'),
(169,NULL,3,5,'queue_created','{\"code\":\"GM001\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 05:20:19'),
(170,139,3,5,'queue_created','{\"code\":\"GM002\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 06:35:14'),
(171,140,7,5,'queue_created','{\"code\":\"GM003\",\"patientName\":\"stella\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 06:35:31'),
(172,141,6,5,'queue_created','{\"code\":\"GM004\",\"patientName\":\"ian\",\"age\":12,\"gender\":\"Prefer not to say\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 06:35:57'),
(173,142,5,7,'queue_created','{\"code\":\"OB005\",\"patientName\":\"kairi dynasty\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 06:36:36'),
(174,142,4,7,'called_next','{\"code\":\"OB005\",\"counter_id\":null,\"counter_name\":null}','2026-05-07 06:37:15'),
(175,142,4,7,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 06:37:21'),
(176,142,4,7,'transferred','{\"source_queue_id\":142,\"source_queue_code\":\"OB005\",\"target_queue_id\":143,\"target_queue_code\":\"GM005\",\"source_department_id\":7,\"source_department\":\"Obstetrics\",\"target_department_id\":5,\"target_department\":\"General Medicine\",\"reason\":null}','2026-05-07 06:37:26'),
(177,143,4,5,'queue_created_from_transfer','{\"source_queue_id\":142,\"source_queue_code\":\"OB005\",\"source_department_id\":7,\"source_department\":\"Obstetrics\",\"target_queue_code\":\"GM005\",\"reason\":null}','2026-05-07 06:37:26'),
(178,139,23,5,'called_next','{\"code\":\"GM002\",\"counter_id\":null,\"counter_name\":null}','2026-05-07 07:06:13'),
(179,139,23,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 07:06:16'),
(180,140,23,5,'called_next','{\"code\":\"GM003\",\"counter_id\":null,\"counter_name\":null}','2026-05-07 07:06:17'),
(181,139,23,5,'transferred','{\"source_queue_id\":139,\"source_queue_code\":\"GM002\",\"target_queue_id\":144,\"target_queue_code\":\"LB002\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_department_id\":9,\"target_department\":\"Laboratory\",\"reason\":null}','2026-05-07 07:06:24'),
(182,144,23,9,'queue_created_from_transfer','{\"source_queue_id\":139,\"source_queue_code\":\"GM002\",\"source_department_id\":5,\"source_department\":\"General Medicine\",\"target_queue_code\":\"LB002\",\"reason\":null}','2026-05-07 07:06:25'),
(183,144,4,9,'called_next','{\"code\":\"LB002\",\"counter_id\":19,\"counter_name\":\"XRAY\"}','2026-05-07 07:06:55'),
(184,144,4,9,'served','{\"counter_id\":19,\"source\":\"call_next\"}','2026-05-07 07:07:02'),
(185,140,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 07:15:41'),
(186,141,4,5,'called_next','{\"code\":\"GM004\",\"counter_id\":null,\"counter_name\":null}','2026-05-07 07:15:42'),
(187,141,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 07:40:59'),
(188,143,4,5,'called_next','{\"code\":\"GM005\",\"counter_id\":null,\"counter_name\":null}','2026-05-07 07:41:00'),
(189,143,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 07:41:15'),
(190,143,4,5,'transferred','{\"target_queue_id\":145,\"target_department_id\":7,\"subdepartment_ids\":[]}','2026-05-07 07:41:23'),
(191,145,4,7,'called_next','{\"code\":\"OB005\",\"counter_id\":null,\"counter_name\":null}','2026-05-07 07:41:29'),
(192,145,4,7,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 07:41:32'),
(193,146,4,9,'transfer_subdepartment_queued','{\"transfer_group_id\":1,\"transfer_group_item_id\":1,\"subdepartment_id\":1,\"active_count_before_queue\":0}','2026-05-07 07:43:43'),
(194,145,4,7,'transfer_group_created','{\"transfer_group_id\":1,\"target_department_id\":9,\"subdepartment_ids\":[1],\"first_queue_id\":146}','2026-05-07 07:43:43'),
(195,146,4,9,'subdepartment_called_next','{\"subdepartment_id\":1}','2026-05-07 07:44:05'),
(196,146,4,9,'subdepartment_marked_done','{\"subdepartment_id\":1,\"advanced_queue_id\":null}','2026-05-07 07:44:16'),
(197,147,3,5,'queue_created','{\"code\":\"GM001\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 11:42:40'),
(198,147,4,5,'called_next','{\"code\":\"GM001\",\"counter_id\":null,\"counter_name\":null}','2026-05-07 15:19:57'),
(199,147,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 15:20:01'),
(200,148,4,9,'transfer_subdepartment_queued','{\"transfer_group_id\":2,\"transfer_group_item_id\":2,\"subdepartment_id\":1,\"active_count_before_queue\":0}','2026-05-07 15:20:11'),
(201,147,4,5,'transfer_group_created','{\"transfer_group_id\":2,\"target_department_id\":9,\"subdepartment_ids\":[1],\"first_queue_id\":148}','2026-05-07 15:20:12'),
(202,148,4,9,'subdepartment_called_next','{\"subdepartment_id\":1}','2026-05-07 15:50:45'),
(203,148,4,9,'subdepartment_marked_done','{\"subdepartment_id\":1,\"advanced_queue_id\":null}','2026-05-07 15:55:50'),
(204,149,3,5,'queue_created','{\"code\":\"GM006\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 15:56:20'),
(205,150,7,5,'queue_created','{\"code\":\"GM010\",\"patientName\":\"stella\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 15:56:36'),
(206,149,4,5,'called_next','{\"code\":\"GM006\",\"counter_id\":null,\"counter_name\":null,\"subdepartment_id\":null,\"transfer_id\":null}','2026-05-07 15:56:50'),
(207,149,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 15:56:58'),
(208,150,4,5,'called_next','{\"code\":\"GM010\",\"counter_id\":null,\"counter_name\":null,\"subdepartment_id\":null,\"transfer_id\":null}','2026-05-07 15:56:59'),
(209,149,4,5,'transferred','{\"target_queue_id\":151,\"target_department_id\":9,\"transfer_id\":1,\"subdepartment_ids\":[1],\"target_queue_code\":\"GM006\"}','2026-05-07 15:57:06'),
(210,150,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 15:57:08'),
(211,150,4,5,'transferred','{\"target_queue_id\":152,\"target_department_id\":9,\"transfer_id\":2,\"subdepartment_ids\":[1],\"target_queue_code\":\"GM010\"}','2026-05-07 15:57:26'),
(212,151,4,9,'transfer_subdepartment_queued','{\"transfer_id\":1,\"requirement_id\":1,\"subdepartment_id\":1,\"active_count_before_queue\":0}','2026-05-07 15:57:37'),
(213,151,4,9,'called_next','{\"code\":\"GM006\",\"counter_id\":null,\"counter_name\":\"xray\",\"subdepartment_id\":1,\"transfer_id\":1}','2026-05-07 15:57:37'),
(214,152,4,9,'transfer_subdepartment_queued','{\"transfer_id\":2,\"requirement_id\":2,\"subdepartment_id\":1,\"active_count_before_queue\":1}','2026-05-07 15:57:58'),
(215,152,4,9,'called_next','{\"code\":\"GM010\",\"counter_id\":null,\"counter_name\":\"xray\",\"subdepartment_id\":1,\"transfer_id\":2}','2026-05-07 15:57:58'),
(216,151,4,9,'subdepartment_called_next','{\"subdepartment_id\":1}','2026-05-07 15:58:36'),
(217,151,4,9,'subdepartment_marked_done','{\"subdepartment_id\":1,\"advanced_queue_id\":null}','2026-05-07 17:07:54'),
(218,152,4,9,'subdepartment_called_next','{\"subdepartment_id\":1}','2026-05-07 17:08:05'),
(219,152,4,9,'subdepartment_marked_done','{\"subdepartment_id\":1,\"advanced_queue_id\":null}','2026-05-07 17:20:52'),
(220,153,3,5,'queue_created','{\"code\":\"GM001\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 17:36:49'),
(221,154,7,5,'queue_created','{\"code\":\"GM002\",\"patientName\":\"stella\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 17:37:03'),
(222,153,4,5,'called_next','{\"code\":\"GM001\",\"counter_id\":null,\"counter_name\":null,\"subdepartment_id\":null,\"transfer_id\":null}','2026-05-07 17:37:20'),
(223,153,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 17:37:23'),
(224,154,4,5,'called_next','{\"code\":\"GM002\",\"counter_id\":null,\"counter_name\":null,\"subdepartment_id\":null,\"transfer_id\":null}','2026-05-07 17:37:24'),
(225,155,4,9,'transfer_subdepartment_queued','{\"transfer_id\":3,\"requirement_id\":3,\"subdepartment_id\":2,\"active_count_before_queue\":0}','2026-05-07 17:37:35'),
(226,153,4,5,'transferred','{\"target_queue_id\":155,\"target_department_id\":9,\"transfer_id\":3,\"subdepartment_ids\":[2,1],\"assigned_subdepartment_id\":2,\"target_queue_code\":\"GM001\"}','2026-05-07 17:37:35'),
(227,154,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 17:37:39'),
(228,156,4,9,'transfer_subdepartment_queued','{\"transfer_id\":4,\"requirement_id\":5,\"subdepartment_id\":2,\"active_count_before_queue\":1}','2026-05-07 17:37:47'),
(229,154,4,5,'transferred','{\"target_queue_id\":156,\"target_department_id\":9,\"transfer_id\":4,\"subdepartment_ids\":[2],\"assigned_subdepartment_id\":2,\"target_queue_code\":\"GM002\"}','2026-05-07 17:37:47'),
(230,155,4,9,'subdepartment_called_next','{\"subdepartment_id\":2}','2026-05-07 17:38:08'),
(231,155,4,9,'transfer_subdepartment_queued','{\"transfer_id\":3,\"requirement_id\":4,\"subdepartment_id\":1,\"active_count_before_queue\":0}','2026-05-07 17:38:09'),
(232,155,4,9,'subdepartment_auto_done','{\"subdepartment_id\":2,\"advanced_queue_id\":155}','2026-05-07 17:38:09'),
(233,156,4,9,'subdepartment_called_next','{\"subdepartment_id\":2}','2026-05-07 17:38:17'),
(234,156,4,9,'subdepartment_auto_done','{\"subdepartment_id\":2,\"advanced_queue_id\":null}','2026-05-07 17:38:18'),
(235,157,3,5,'queue_created','{\"code\":\"GM001\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 17:52:11'),
(236,158,7,5,'queue_created','{\"code\":\"GM003\",\"patientName\":\"stella\",\"age\":19,\"gender\":\"Female\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-07 17:52:23'),
(237,157,4,5,'called_next','{\"code\":\"GM001\",\"counter_id\":null,\"counter_name\":null,\"subdepartment_id\":null,\"transfer_id\":null}','2026-05-07 17:52:37'),
(238,157,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-07 17:52:40'),
(239,158,4,5,'called_next','{\"code\":\"GM003\",\"counter_id\":null,\"counter_name\":null,\"subdepartment_id\":null,\"transfer_id\":null}','2026-05-07 17:52:41'),
(240,155,4,9,'subdepartment_called_next','{\"subdepartment_id\":1}','2026-05-07 18:06:44'),
(241,155,4,9,'subdepartment_marked_done_by_next','{\"subdepartment_id\":1,\"advanced_queue_id\":null}','2026-05-07 18:06:48'),
(242,159,3,5,'queue_created','{\"code\":\"GM001\",\"patientName\":\"jiwoo\",\"age\":12,\"gender\":\"Non-binary\",\"category\":\"general\",\"ai_priority_level\":null,\"source\":\"patient\"}','2026-05-10 23:39:02'),
(243,158,4,5,'served','{\"counter_id\":null,\"source\":\"call_next\"}','2026-05-10 23:39:18'),
(244,159,4,5,'called_next','{\"code\":\"GM001\",\"counter_id\":null,\"counter_name\":null,\"subdepartment_id\":null,\"transfer_id\":null}','2026-05-10 23:39:18');
/*!40000 ALTER TABLE `queue_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `queue_subdepartment_requirements`
--

DROP TABLE IF EXISTS `queue_subdepartment_requirements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `queue_subdepartment_requirements` (
  `requirement_id` int(11) NOT NULL AUTO_INCREMENT,
  `transfer_id` int(11) NOT NULL,
  `subdepartment_id` int(11) NOT NULL,
  `status` enum('pending','queued','serving','done','skipped') NOT NULL DEFAULT 'pending',
  `queued_at` datetime DEFAULT NULL,
  `called_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`requirement_id`),
  KEY `idx_queue_subdepartment_requirements_transfer_status` (`transfer_id`,`status`),
  KEY `idx_queue_subdepartment_requirements_subdepartment_status` (`subdepartment_id`,`status`),
  KEY `idx_qsr_subdepartment_status_queued` (`subdepartment_id`,`status`,`queued_at`),
  KEY `idx_qsr_transfer_status_subdepartment` (`transfer_id`,`status`,`subdepartment_id`),
  CONSTRAINT `fk_queue_subdepartment_requirements_subdepartment` FOREIGN KEY (`subdepartment_id`) REFERENCES `subdepartments` (`subdepartment_id`),
  CONSTRAINT `fk_queue_subdepartment_requirements_transfer` FOREIGN KEY (`transfer_id`) REFERENCES `queue_transfers` (`transfer_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `queue_subdepartment_requirements`
--

LOCK TABLES `queue_subdepartment_requirements` WRITE;
/*!40000 ALTER TABLE `queue_subdepartment_requirements` DISABLE KEYS */;
INSERT INTO `queue_subdepartment_requirements` VALUES
(1,1,1,'done','2026-05-07 23:57:37','2026-05-07 23:58:36','2026-05-08 01:07:53'),
(2,2,1,'done','2026-05-07 23:57:58','2026-05-08 01:08:05','2026-05-08 01:20:51'),
(3,3,2,'done','2026-05-08 01:37:35','2026-05-08 01:38:08','2026-05-08 01:38:09'),
(4,3,1,'done','2026-05-08 01:38:09','2026-05-08 02:06:44','2026-05-08 02:06:47'),
(5,4,2,'done','2026-05-08 01:37:47','2026-05-08 01:38:16','2026-05-08 01:38:17');
/*!40000 ALTER TABLE `queue_subdepartment_requirements` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `queue_transfers`
--

DROP TABLE IF EXISTS `queue_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `queue_transfers` (
  `transfer_id` int(11) NOT NULL AUTO_INCREMENT,
  `queue_id` int(11) NOT NULL,
  `from_department_id` int(11) NOT NULL,
  `to_department_id` int(11) NOT NULL,
  `status` enum('waiting_department_call','in_subdepartment','completed','cancelled') NOT NULL DEFAULT 'waiting_department_call',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `called_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`transfer_id`),
  KEY `idx_queue_transfers_queue` (`queue_id`),
  KEY `idx_queue_transfers_status` (`status`),
  KEY `idx_queue_transfers_target_status` (`to_department_id`,`status`),
  KEY `fk_queue_transfers_from_department` (`from_department_id`),
  CONSTRAINT `fk_queue_transfers_from_department` FOREIGN KEY (`from_department_id`) REFERENCES `departments` (`department_id`),
  CONSTRAINT `fk_queue_transfers_queue` FOREIGN KEY (`queue_id`) REFERENCES `queues` (`queue_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_queue_transfers_to_department` FOREIGN KEY (`to_department_id`) REFERENCES `departments` (`department_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `queue_transfers`
--

LOCK TABLES `queue_transfers` WRITE;
/*!40000 ALTER TABLE `queue_transfers` DISABLE KEYS */;
INSERT INTO `queue_transfers` VALUES
(1,151,5,9,'completed','2026-05-07 15:57:06','2026-05-07 23:57:36','2026-05-08 01:07:53'),
(2,152,5,9,'completed','2026-05-07 15:57:26','2026-05-07 23:57:58','2026-05-08 01:20:51'),
(3,155,5,9,'completed','2026-05-07 17:37:34','2026-05-08 01:37:34','2026-05-08 02:06:47'),
(4,156,5,9,'completed','2026-05-07 17:37:47','2026-05-08 01:37:47','2026-05-08 01:38:17');
/*!40000 ALTER TABLE `queue_transfers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `queues`
--

DROP TABLE IF EXISTS `queues`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `queues` (
  `queue_id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(150) DEFAULT NULL,
  `user_id` int(11) NOT NULL,
  `department_id` int(11) NOT NULL,
  `counter_id` int(11) DEFAULT NULL,
  `subdepartment_id` int(11) DEFAULT NULL,
  `transfer_group_id` int(11) DEFAULT NULL,
  `code` varchar(32) NOT NULL,
  `category` enum('general','support','priority','complaint') NOT NULL,
  `status` enum('waiting','serving','done','no_show','void','cancelled') DEFAULT 'waiting',
  `visit_description` text DEFAULT NULL,
  `ai_suggested_department` varchar(100) DEFAULT NULL,
  `ai_category` varchar(50) DEFAULT NULL,
  `ai_priority_level` varchar(30) DEFAULT NULL,
  `ai_reason` text DEFAULT NULL,
  `is_priority` tinyint(1) DEFAULT 0,
  `is_emergency` tinyint(1) DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  `called_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `referred_from_queue_id` int(11) DEFAULT NULL,
  `transfer_reason` text DEFAULT NULL,
  `transferred_by_user_id` int(11) DEFAULT NULL,
  `transferred_at` datetime DEFAULT NULL,
  `age` int(11) DEFAULT NULL,
  `gender` varchar(30) DEFAULT NULL,
  `visit_id` int(11) NOT NULL,
  PRIMARY KEY (`queue_id`),
  KEY `department_id` (`department_id`),
  KEY `idx_queue_status` (`status`),
  KEY `idx_queue_user` (`user_id`),
  KEY `idx_queue_created` (`created_at`),
  KEY `idx_queue_department_status` (`department_id`,`status`),
  KEY `fk_queues_transferred_by` (`transferred_by_user_id`),
  KEY `idx_queue_referred_from` (`referred_from_queue_id`),
  KEY `idx_queues_visit` (`visit_id`),
  KEY `idx_queues_counter_status` (`counter_id`,`status`),
  KEY `idx_queues_transfer_group` (`transfer_group_id`),
  KEY `idx_queues_subdepartment_status` (`subdepartment_id`,`status`),
  CONSTRAINT `fk_queues_counter` FOREIGN KEY (`counter_id`) REFERENCES `counters` (`counter_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queues_referred_from` FOREIGN KEY (`referred_from_queue_id`) REFERENCES `queues` (`queue_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queues_subdepartment` FOREIGN KEY (`subdepartment_id`) REFERENCES `subdepartments` (`subdepartment_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queues_transfer_group` FOREIGN KEY (`transfer_group_id`) REFERENCES `transfer_groups` (`transfer_group_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queues_transferred_by` FOREIGN KEY (`transferred_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_queues_visit` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`visit_id`),
  CONSTRAINT `queues_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `queues_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`)
) ENGINE=InnoDB AUTO_INCREMENT=160 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `queues`
--

LOCK TABLES `queues` WRITE;
/*!40000 ALTER TABLE `queues` DISABLE KEYS */;
INSERT INTO `queues` VALUES
(139,'jiwoo',3,5,NULL,NULL,NULL,'GM002','general','done','a',NULL,NULL,NULL,NULL,0,0,'2026-05-07 14:35:14','2026-05-07 15:06:13','2026-05-07 15:06:16',NULL,NULL,NULL,NULL,12,'Non-binary',64),
(140,'stella',7,5,NULL,NULL,NULL,'GM003','general','done','a',NULL,NULL,NULL,NULL,0,0,'2026-05-07 14:35:31','2026-05-07 15:06:16','2026-05-07 15:15:40',NULL,NULL,NULL,NULL,19,'Female',65),
(141,'ian',6,5,NULL,NULL,NULL,'GM004','general','done','hello',NULL,NULL,NULL,NULL,0,0,'2026-05-07 14:35:56','2026-05-07 15:15:42','2026-05-07 15:40:59',NULL,NULL,NULL,NULL,12,'Prefer not to say',66),
(142,'kairi dynasty',5,7,NULL,NULL,NULL,'OB005','general','done','hello',NULL,NULL,NULL,NULL,0,0,'2026-05-07 14:36:36','2026-05-07 14:37:15','2026-05-07 14:37:20',NULL,NULL,NULL,NULL,19,'Female',67),
(143,'kairi dynasty',5,5,NULL,NULL,NULL,'GM005','general','done','hello',NULL,NULL,NULL,NULL,0,0,'2026-05-07 14:37:26','2026-05-07 15:41:00','2026-05-07 15:41:15',142,NULL,4,'2026-05-07 14:37:26',NULL,NULL,67),
(144,'jiwoo',3,9,NULL,NULL,NULL,'LB002','general','done','a',NULL,NULL,NULL,NULL,0,0,'2026-05-07 15:06:24','2026-05-07 15:06:54','2026-05-07 15:07:02',139,NULL,23,'2026-05-07 15:06:24',NULL,NULL,64),
(145,'kairi dynasty',5,7,NULL,NULL,NULL,'OB005','general','done','hello',NULL,NULL,NULL,NULL,0,0,'2026-05-07 15:41:23','2026-05-07 15:41:28','2026-05-07 15:41:32',143,NULL,4,'2026-05-07 15:41:23',NULL,NULL,67),
(146,'kairi dynasty',5,9,NULL,1,1,'LB005','general','done','hello',NULL,NULL,NULL,NULL,0,0,'2026-05-07 15:43:42','2026-05-07 15:44:04','2026-05-07 15:44:14',145,NULL,4,'2026-05-07 15:43:42',NULL,NULL,67),
(147,'jiwoo',3,5,NULL,NULL,NULL,'GM001','general','done','adf',NULL,NULL,NULL,NULL,0,0,'2026-05-07 19:42:40','2026-05-07 23:19:57','2026-05-07 23:20:01',NULL,NULL,NULL,NULL,12,'Non-binary',46),
(148,'jiwoo',3,9,NULL,1,2,'LB001','general','done','adf',NULL,NULL,NULL,NULL,0,0,'2026-05-07 23:20:11','2026-05-07 23:50:45','2026-05-07 23:55:49',147,NULL,4,'2026-05-07 23:20:11',NULL,NULL,46),
(149,'jiwoo',3,5,NULL,NULL,NULL,'GM006','general','done','amazing',NULL,NULL,NULL,NULL,0,0,'2026-05-07 23:56:20','2026-05-07 23:56:50','2026-05-07 23:56:58',NULL,NULL,NULL,NULL,12,'Non-binary',68),
(150,'stella',7,5,NULL,NULL,NULL,'GM010','general','done','alksdjf',NULL,NULL,NULL,NULL,0,0,'2026-05-07 23:56:36','2026-05-07 23:56:59','2026-05-07 23:57:08',NULL,NULL,NULL,NULL,19,'Female',42),
(151,'jiwoo',3,9,NULL,NULL,NULL,'GM006','general','done','amazing',NULL,NULL,NULL,NULL,0,0,'2026-05-07 23:57:06','2026-05-07 23:58:36','2026-05-08 01:07:53',149,NULL,4,'2026-05-07 23:57:06',NULL,NULL,68),
(152,'stella',7,9,NULL,NULL,NULL,'GM010','general','done','alksdjf',NULL,NULL,NULL,NULL,0,0,'2026-05-07 23:57:26',NULL,'2026-05-08 01:20:52',150,NULL,4,'2026-05-07 23:57:26',NULL,NULL,42),
(153,'jiwoo',3,5,NULL,NULL,NULL,'GM001','general','done','a',NULL,NULL,NULL,NULL,0,0,'2026-05-08 01:36:49','2026-05-08 01:37:20','2026-05-08 01:37:23',NULL,NULL,NULL,NULL,12,'Non-binary',69),
(154,'stella',7,5,NULL,NULL,NULL,'GM002','general','done','aldj',NULL,NULL,NULL,NULL,0,0,'2026-05-08 01:37:03','2026-05-08 01:37:24','2026-05-08 01:37:39',NULL,NULL,NULL,NULL,19,'Female',70),
(155,'jiwoo',3,9,NULL,NULL,NULL,'GM001','general','done','a',NULL,NULL,NULL,NULL,0,0,'2026-05-08 01:37:34','2026-05-08 01:37:34','2026-05-08 01:37:34',153,NULL,4,'2026-05-08 01:37:34',NULL,NULL,69),
(156,'stella',7,9,NULL,NULL,NULL,'GM002','general','done','aldj',NULL,NULL,NULL,NULL,0,0,'2026-05-08 01:37:46','2026-05-08 01:37:47','2026-05-08 01:37:47',154,NULL,4,'2026-05-08 01:37:46',NULL,NULL,70),
(157,'jiwoo',3,5,NULL,NULL,NULL,'GM001','general','done','hi',NULL,NULL,NULL,NULL,0,0,'2026-05-08 01:52:11','2026-05-08 01:52:37','2026-05-08 01:52:40',NULL,NULL,NULL,NULL,12,'Non-binary',69),
(158,'stella',7,5,NULL,NULL,NULL,'GM003','general','done','alskdjf',NULL,NULL,NULL,NULL,0,0,'2026-05-08 01:52:23','2026-05-08 01:52:41','2026-05-11 07:39:18',NULL,NULL,NULL,NULL,19,'Female',71),
(159,'jiwoo',3,5,NULL,NULL,NULL,'GM001','general','serving','a',NULL,NULL,NULL,NULL,0,0,'2026-05-11 07:39:02','2026-05-11 07:39:18',NULL,NULL,NULL,NULL,NULL,12,'Non-binary',72);
/*!40000 ALTER TABLE `queues` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `subdepartments`
--

DROP TABLE IF EXISTS `subdepartments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `subdepartments` (
  `subdepartment_id` int(11) NOT NULL AUTO_INCREMENT,
  `department_id` int(11) NOT NULL,
  `name` varchar(80) NOT NULL,
  `room_number` varchar(30) DEFAULT NULL,
  `status` enum('open','break','closed') NOT NULL DEFAULT 'open',
  `current_queue_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`subdepartment_id`),
  KEY `idx_subdepartments_department` (`department_id`),
  KEY `idx_subdepartments_current_queue` (`current_queue_id`),
  CONSTRAINT `fk_subdepartments_current_queue` FOREIGN KEY (`current_queue_id`) REFERENCES `queues` (`queue_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_subdepartments_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `subdepartments`
--

LOCK TABLES `subdepartments` WRITE;
/*!40000 ALTER TABLE `subdepartments` DISABLE KEYS */;
INSERT INTO `subdepartments` VALUES
(1,9,'xray',NULL,'open',NULL,'2026-05-07 07:43:25',NULL),
(2,9,'blood test',NULL,'open',NULL,'2026-05-07 16:42:14',NULL);
/*!40000 ALTER TABLE `subdepartments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `system_settings`
--

DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int(11) NOT NULL DEFAULT 1,
  `queue_status` enum('open','pause','closed') DEFAULT 'open',
  `max_slots` int(11) DEFAULT 50,
  `current_slots` int(11) DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `system_settings`
--

LOCK TABLES `system_settings` WRITE;
/*!40000 ALTER TABLE `system_settings` DISABLE KEYS */;
INSERT INTO `system_settings` VALUES
(1,'open',50,0,'2026-04-28 06:32:39');
/*!40000 ALTER TABLE `system_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transfer_group_items`
--

DROP TABLE IF EXISTS `transfer_group_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `transfer_group_items` (
  `item_id` int(11) NOT NULL AUTO_INCREMENT,
  `transfer_group_id` int(11) NOT NULL,
  `counter_id` int(11) DEFAULT NULL,
  `subdepartment_id` int(11) DEFAULT NULL,
  `status` enum('pending','queued','serving','done','skipped','cancelled') NOT NULL DEFAULT 'pending',
  `queue_id` int(11) DEFAULT NULL,
  `sequence_order` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `queued_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`item_id`),
  UNIQUE KEY `uniq_transfer_group_counter` (`transfer_group_id`,`counter_id`),
  UNIQUE KEY `uniq_transfer_group_subdepartment` (`transfer_group_id`,`subdepartment_id`),
  KEY `idx_transfer_items_group_status` (`transfer_group_id`,`status`),
  KEY `idx_transfer_items_counter_status` (`counter_id`,`status`),
  KEY `idx_transfer_items_queue` (`queue_id`),
  KEY `idx_transfer_items_subdepartment_status` (`subdepartment_id`,`status`),
  CONSTRAINT `fk_transfer_items_counter` FOREIGN KEY (`counter_id`) REFERENCES `counters` (`counter_id`),
  CONSTRAINT `fk_transfer_items_group` FOREIGN KEY (`transfer_group_id`) REFERENCES `transfer_groups` (`transfer_group_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_transfer_items_queue` FOREIGN KEY (`queue_id`) REFERENCES `queues` (`queue_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_transfer_items_subdepartment` FOREIGN KEY (`subdepartment_id`) REFERENCES `subdepartments` (`subdepartment_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transfer_group_items`
--

LOCK TABLES `transfer_group_items` WRITE;
/*!40000 ALTER TABLE `transfer_group_items` DISABLE KEYS */;
INSERT INTO `transfer_group_items` VALUES
(1,1,NULL,1,'done',146,1,'2026-05-07 15:43:42','2026-05-07 15:43:43','2026-05-07 15:44:15'),
(2,2,NULL,1,'queued',148,1,'2026-05-07 23:20:11','2026-05-07 23:20:11',NULL);
/*!40000 ALTER TABLE `transfer_group_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transfer_groups`
--

DROP TABLE IF EXISTS `transfer_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `transfer_groups` (
  `transfer_group_id` int(11) NOT NULL AUTO_INCREMENT,
  `visit_id` int(11) NOT NULL,
  `source_queue_id` int(11) NOT NULL,
  `target_department_id` int(11) NOT NULL,
  `transfer_reason` text DEFAULT NULL,
  `status` enum('active','completed','cancelled') NOT NULL DEFAULT 'active',
  `created_by_user_id` int(11) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`transfer_group_id`),
  KEY `idx_transfer_groups_visit` (`visit_id`),
  KEY `idx_transfer_groups_source_queue` (`source_queue_id`),
  KEY `idx_transfer_groups_target_status` (`target_department_id`,`status`),
  KEY `fk_transfer_groups_created_by` (`created_by_user_id`),
  CONSTRAINT `fk_transfer_groups_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_transfer_groups_source_queue` FOREIGN KEY (`source_queue_id`) REFERENCES `queues` (`queue_id`),
  CONSTRAINT `fk_transfer_groups_target_department` FOREIGN KEY (`target_department_id`) REFERENCES `departments` (`department_id`),
  CONSTRAINT `fk_transfer_groups_visit` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`visit_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transfer_groups`
--

LOCK TABLES `transfer_groups` WRITE;
/*!40000 ALTER TABLE `transfer_groups` DISABLE KEYS */;
INSERT INTO `transfer_groups` VALUES
(1,67,145,9,NULL,'completed',4,'2026-05-07 15:43:42','2026-05-07 15:44:15'),
(2,46,147,9,NULL,'active',4,'2026-05-07 23:20:10',NULL);
/*!40000 ALTER TABLE `transfer_groups` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ui_settings`
--

DROP TABLE IF EXISTS `ui_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ui_settings` (
  `id` int(11) NOT NULL DEFAULT 1,
  `system_name` varchar(100) DEFAULT 'CareFlow',
  `logo_text` varchar(100) DEFAULT 'CareFlow',
  `primary_color` varchar(20) DEFAULT '#1d9c6c',
  `footer_text` varchar(255) DEFAULT 'CareFlow Queue Management',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ui_settings`
--

LOCK TABLES `ui_settings` WRITE;
/*!40000 ALTER TABLE `ui_settings` DISABLE KEYS */;
INSERT INTO `ui_settings` VALUES
(1,'CareFlow','CareFlow','#1d9c6c','CareFlow Queue Management','2026-04-28 12:35:32');
/*!40000 ALTER TABLE `ui_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` enum('owner','admin','staff','doctor','patient') NOT NULL DEFAULT 'patient',
  `department_id` int(11) DEFAULT NULL,
  `full_name` varchar(150) DEFAULT NULL,
  `age` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `email` varchar(255) DEFAULT NULL,
  `google_id` varchar(255) DEFAULT NULL,
  `auth_provider` varchar(50) DEFAULT 'local',
  `gender` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `contact_number` (`contact_number`),
  UNIQUE KEY `unique_users_email` (`email`),
  UNIQUE KEY `unique_users_google_id` (`google_id`),
  KEY `fk_users_department` (`department_id`),
  CONSTRAINT `fk_users_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`department_id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES
(3,'jiwoo','12321312321','$2b$10$sKxWAzHWXLUJOiQMlHAEWeQvYEAvr4WWzXTqcai4fxEbI.FNRUXlq','patient',NULL,'jiwoo',12,'2026-04-22 01:59:37',NULL,NULL,'local','Non-binary'),
(4,'admin',NULL,'$2a$12$B62rw7hBYX0x2gUHPW8puuANd.tLgWkr0Nb3ayO9yo/nQHORrFo02','admin',NULL,NULL,NULL,'2026-04-22 02:01:23','johnjamessmurf@gmail.com','106620830627766055947','google',NULL),
(5,'kairi dynasty','09111111111','$2b$10$SLO4b61MaxxKQol391mfUuXbAZ827AxM5rI1mAjWqYbZwNxmb8lAi','patient',NULL,'kairi dynasty',19,'2026-04-28 03:02:49',NULL,NULL,'local','Female'),
(6,'ian','10231209382','$2b$10$lARQL7/GlTysaOJSJg3sC.iQsdUU1HfakQydubX0LpmscT7FGVKC2','patient',NULL,'ian',12,'2026-04-28 10:53:58',NULL,NULL,'local','Prefer not to say'),
(7,'stella','10293812093','$2b$10$F7qPyydaS39h7gcKkoLiCOTY54ZPARgbeyZ9UNSSap4jXOmWgCid2','patient',NULL,'stella',19,'2026-04-28 10:54:24',NULL,NULL,'local','Female'),
(9,'tartarusa','10293801938','$2b$10$8Y8ssuCXRXHib0csQSkPreRRvJxn1Wia9M2jS/RLHj9qghsrZsyli','staff',5,'tartarusa',NULL,'2026-04-28 12:32:49',NULL,NULL,'local',NULL),
(10,'Vinz','secret','$2b$10$boVE2V.dvJQMNDoXKlP3seylVa/3if1vAyNoyrdsceRlX6fgQa5Yy','patient',NULL,'Vincent Pansoy',NULL,'2026-04-28 12:52:01',NULL,NULL,'local',NULL),
(13,'dylan','09064959465','$2b$10$STNI.1vjsmL2Embu/RyAWuukobeTj/gG/9RhIW43IT7cgCyAU93/q','patient',NULL,'Dy',NULL,'2026-04-28 13:16:04',NULL,NULL,'local',NULL),
(16,'panchoy','09012830918','$2b$10$w6jfqDWsk23gMtPO85kpE.9WE.pXIaRFNb/tAvVNr7Zu8bezrjA9y','patient',NULL,'pansoy',NULL,'2026-04-28 23:37:21',NULL,NULL,'local',NULL),
(19,'dyla','09123724643','$2b$10$A6gH.hBG7mkCEqeufmlZX.F.V06BAl1WFmsTv1p6TSnTTl9Hu2xgm','patient',NULL,'sdfds',NULL,'2026-05-03 10:06:34','d@usc.edu.ph',NULL,'local',NULL),
(20,'juanantonioabadilla',NULL,'$2b$10$sGi9AJz4fBsHIdxjkTrFruWakstqx7/aX9GM1YjlxgGwkcBmU7P5.','patient',NULL,'Juan Antonio Abadilla',NULL,'2026-05-03 10:32:56','juanantonioabadilla@gmail.com','107025653941189299467','google',NULL),
(21,'kimleahlee',NULL,'$2b$10$cSzhGUsxlXN5fqQCwD2ZBeYwFgLREh16zE/dsFqakEPFiiJsGu6Vq','patient',NULL,'Pansoy- 12-STEM_2C-Charity',NULL,'2026-05-03 10:52:27','kimleahlee@gmail.com','103689760828610400847','google',NULL),
(22,'23102075',NULL,'$2b$10$oQi9J7pbEZFhzIHc31hjK.3ykCu9u.5Ig7xT6I5EWWKNrBVrsADKG','patient',NULL,'Kent Andrew Rojas',19,'2026-05-04 01:42:03','23102075@usc.edu.ph','107920066494981511221','google','Male'),
(23,'doc','09301948203','$2b$10$Y4zzNpQyZKDGm9A0uVJ6hezrpnC7oYjnkWmc9bD47tjZ01cAADNWW','staff',5,'doc',NULL,'2026-05-07 07:06:04',NULL,NULL,'local',NULL),
(24,'itstheacruz','09777811320','$2b$10$DVJfyI6ls.jBJUJInD0ndu4CE3/9ZdvPrYOn/DZ2elwjMSqxyFxUm','patient',NULL,'Thea Claire Cruz',20,'2026-05-07 11:15:52','theagumandoy@gmail.com',NULL,'local','Female');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `visit_daily_counters`
--

DROP TABLE IF EXISTS `visit_daily_counters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `visit_daily_counters` (
  `date` date NOT NULL,
  `last_number` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `visit_daily_counters`
--

LOCK TABLES `visit_daily_counters` WRITE;
/*!40000 ALTER TABLE `visit_daily_counters` DISABLE KEYS */;
INSERT INTO `visit_daily_counters` VALUES
('2026-04-29',9),
('2026-05-02',8),
('2026-05-03',15),
('2026-05-04',13),
('2026-05-07',6),
('2026-05-08',3),
('2026-05-11',1);
/*!40000 ALTER TABLE `visit_daily_counters` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `visits`
--

DROP TABLE IF EXISTS `visits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `visits` (
  `visit_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `visit_date` date NOT NULL,
  `global_number` int(11) NOT NULL,
  `status` enum('active','completed','cancelled','void') NOT NULL DEFAULT 'active',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`visit_id`),
  UNIQUE KEY `uniq_visits_date_number` (`visit_date`,`global_number`),
  KEY `idx_visits_user_status` (`user_id`,`status`),
  KEY `idx_visits_date_number` (`visit_date`,`global_number`),
  CONSTRAINT `fk_visits_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=73 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `visits`
--

LOCK TABLES `visits` WRITE;
/*!40000 ALTER TABLE `visits` DISABLE KEYS */;
INSERT INTO `visits` VALUES
(1,5,'2026-04-29',1,'completed','2026-04-29 08:22:48','2026-05-07 14:33:28'),
(2,3,'2026-04-29',2,'completed','2026-04-29 08:38:46','2026-05-07 14:33:28'),
(3,3,'2026-04-29',3,'completed','2026-04-29 08:40:33','2026-05-07 14:33:28'),
(4,3,'2026-04-29',4,'completed','2026-04-29 08:41:30','2026-05-07 14:33:28'),
(5,3,'2026-04-29',5,'completed','2026-04-29 08:48:04','2026-05-07 14:33:28'),
(6,3,'2026-04-29',6,'completed','2026-04-29 08:48:40','2026-05-07 14:33:28'),
(7,7,'2026-04-29',7,'completed','2026-04-29 08:51:11','2026-05-07 14:33:28'),
(8,3,'2026-04-29',8,'completed','2026-04-29 19:30:28','2026-05-07 14:33:28'),
(9,3,'2026-04-29',9,'completed','2026-04-29 19:38:06','2026-05-07 14:33:28'),
(10,3,'2026-05-02',1,'completed','2026-05-02 15:45:21','2026-05-07 14:33:28'),
(11,7,'2026-05-02',2,'completed','2026-05-02 15:55:54','2026-05-07 14:33:28'),
(12,4,'2026-05-02',3,'completed','2026-05-02 16:12:44','2026-05-07 14:33:28'),
(13,3,'2026-05-02',4,'completed','2026-05-02 21:20:49','2026-05-07 14:33:28'),
(14,7,'2026-05-02',5,'completed','2026-05-02 21:21:56','2026-05-07 14:33:28'),
(15,6,'2026-05-02',6,'completed','2026-05-02 21:22:09','2026-05-07 14:33:28'),
(16,3,'2026-05-02',7,'cancelled','2026-05-02 21:39:07','2026-05-07 14:33:28'),
(17,3,'2026-05-02',8,'completed','2026-05-02 21:39:33','2026-05-07 14:33:28'),
(18,3,'2026-05-03',1,'completed','2026-05-03 00:25:58','2026-05-07 14:33:28'),
(19,4,'2026-05-03',2,'completed','2026-05-03 00:31:14','2026-05-07 14:33:28'),
(20,4,'2026-05-03',3,'completed','2026-05-03 00:31:35','2026-05-07 14:33:28'),
(21,6,'2026-05-03',4,'cancelled','2026-05-03 09:59:57','2026-05-07 14:33:28'),
(22,3,'2026-05-03',5,'cancelled','2026-05-03 11:43:00','2026-05-07 14:33:28'),
(23,3,'2026-05-03',6,'cancelled','2026-05-03 11:53:43','2026-05-07 14:33:28'),
(24,3,'2026-05-03',7,'cancelled','2026-05-03 11:57:17','2026-05-07 14:33:28'),
(25,6,'2026-05-03',8,'cancelled','2026-05-03 12:00:17','2026-05-07 14:33:28'),
(26,3,'2026-05-03',9,'completed','2026-05-03 13:43:04','2026-05-07 14:33:28'),
(27,6,'2026-05-03',10,'completed','2026-05-03 13:43:21','2026-05-07 14:33:28'),
(28,4,'2026-05-03',11,'completed','2026-05-03 14:59:53','2026-05-07 14:33:28'),
(29,4,'2026-05-03',12,'completed','2026-05-03 15:27:16','2026-05-07 14:33:28'),
(30,4,'2026-05-03',13,'completed','2026-05-03 16:12:42','2026-05-07 14:33:28'),
(31,19,'2026-05-03',14,'completed','2026-05-03 18:07:14','2026-05-07 14:33:28'),
(32,3,'2026-05-03',15,'completed','2026-05-03 18:34:29','2026-05-07 14:33:28'),
(33,22,'2026-05-04',1,'completed','2026-05-04 09:42:52','2026-05-07 14:33:28'),
(34,5,'2026-05-04',2,'cancelled','2026-05-04 10:16:29','2026-05-07 14:33:28'),
(35,5,'2026-05-04',3,'completed','2026-05-04 10:17:27','2026-05-07 14:33:28'),
(36,5,'2026-05-04',4,'completed','2026-05-04 10:57:29','2026-05-07 14:33:28'),
(37,5,'2026-05-04',5,'completed','2026-05-04 10:57:53','2026-05-07 14:33:28'),
(38,3,'2026-05-04',6,'completed','2026-05-04 11:01:56','2026-05-07 14:33:28'),
(39,3,'2026-05-04',7,'completed','2026-05-04 11:04:30','2026-05-07 14:33:28'),
(40,3,'2026-05-04',8,'completed','2026-05-04 11:07:47','2026-05-07 14:33:28'),
(41,6,'2026-05-04',9,'active','2026-05-04 11:08:02','2026-05-07 14:33:28'),
(42,7,'2026-05-04',10,'completed','2026-05-04 11:08:22','2026-05-08 01:20:52'),
(43,22,'2026-05-04',11,'completed','2026-05-04 11:08:25','2026-05-07 14:33:28'),
(44,5,'2026-05-04',12,'active','2026-05-04 11:08:34','2026-05-07 14:33:28'),
(45,22,'2026-05-04',13,'active','2026-05-04 11:23:00','2026-05-07 14:33:28'),
(46,3,'2026-05-07',1,'completed','2026-05-07 13:20:19','2026-05-07 23:55:50'),
(64,3,'2026-05-07',2,'completed','2026-05-07 14:35:14','2026-05-07 15:07:03'),
(65,7,'2026-05-07',3,'completed','2026-05-07 14:35:31','2026-05-07 15:15:41'),
(66,6,'2026-05-07',4,'completed','2026-05-07 14:35:56','2026-05-07 15:41:00'),
(67,5,'2026-05-07',5,'completed','2026-05-07 14:36:36','2026-05-07 15:44:16'),
(68,3,'2026-05-07',6,'completed','2026-05-07 23:56:20','2026-05-08 01:07:54'),
(69,3,'2026-05-08',1,'completed','2026-05-08 01:36:49','2026-05-08 02:06:48'),
(70,7,'2026-05-08',2,'completed','2026-05-08 01:37:02','2026-05-08 01:38:18'),
(71,7,'2026-05-08',3,'completed','2026-05-08 01:52:22','2026-05-11 07:39:18'),
(72,3,'2026-05-11',1,'active','2026-05-11 07:39:02','2026-05-11 07:39:02');
/*!40000 ALTER TABLE `visits` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-11  7:40:38
