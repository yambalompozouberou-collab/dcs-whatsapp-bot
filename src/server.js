import express from 'express';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const db = new Database(path.join(__dirname, '../data/bot.db'));
db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT,description TEXT,price INTEGER,promo_price INTEGER,status TEXT DEFAULT 'Disponible',image TEXT);
CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,phone TEXT UNIQUE,city TEXT,address TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER,product_id TEXT,quantity INTEGER DEFAULT 1,unit_price INTEGER,total INTEGER,status TEXT DEFAULT 'En attente',payment_status TEXT DEFAULT 'En attente',payment_method TEXT,delivery TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT,direction TEXT,text TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS conversations(phone TEXT PRIMARY KEY,state TEXT DEFAULT 'idle',data TEXT DEFAULT '{}',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS quote_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,phone TEXT,request TEXT,status TEXT DEFAULT 'Nouveau',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
