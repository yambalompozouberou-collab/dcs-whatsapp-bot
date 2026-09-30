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

const SERVICES=[['P001','Création de Vidéos Professionnelles avec IA','Création de contenu','Vidéos sur mesure pour promotion, storytelling et contenu de marque.',6000,2000],['P002','Création de Sites Web Professionnels','Développement web','Site vitrine professionnel pour présenter votre activité en ligne.',3500,1500],['P003','Monétisation TikTok','TikTok / Monétisation','Accompagnement complet pour monétiser et optimiser votre compte TikTok.',3000,1500],['P004','Formation Monétisation TikTok','Formation','Formation pratique pour apprendre à générer des revenus sur TikTok.',3000,1500],['P005',"Conception d'Affiches Publicitaires",'Design graphique','Création de visuels publicitaires professionnels et percutants.',2000,1000],['P006','Création de Cartes Virtuelles Internationales','Services numériques','Carte virtuelle pour vos achats et paiements en ligne.',2000,1000],['P007','Restauration de Photos','Retouche photo','Restauration et amélioration de vos photos anciennes ou abîmées.',2000,1000],['P008','Création de Logos Professionnels','Identité visuelle','Logo professionnel pour votre marque ou entreprise.',2000,1000],['P009','Création de CV Professionnels','Documents professionnels','CV moderne et professionnel qui vous démarque.',2000,1000],['P010','Outils IA Pro','Intelligence artificielle','Accès et accompagnement sur les meilleurs outils IA selon votre besoin.',2000,1000]];
const ins=db.prepare('INSERT OR IGNORE INTO products(id,name,category,description,price,promo_price) VALUES (?,?,?,?,?,?)');
SERVICES.forEach(x=>ins.run(...x));

const openai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;
const supabase=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null;
const money=n=>`${Number(n).toLocaleString('fr-FR')} FCFA`;
const products=()=>db.prepare('SELECT * FROM products ORDER BY id').all();
const productById=id=>db.prepare('SELECT * FROM products WHERE id=?').get(id);
function getConv(phone){const r=db.prepare('SELECT * FROM conversations WHERE phone=?').get(phone);return r?{...r,data:JSON.parse(r.data||'{}')}:{state:'idle',data:{}};}
function setConv(phone,state,data={}){db.prepare(`INSERT INTO conversations(phone,state,data,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(phone) DO UPDATE SET state=excluded.state,data=excluded.data,updated_at=CURRENT_TIMESTAMP`).run(phone,state,JSON.stringify(data));}
function resetConv(phone){setConv(phone,'idle',{});}
function logMsg(phone,direction,text){db.prepare('INSERT INTO messages(phone,direction,text) VALUES(?,?,?)').run(phone,direction,text);}
function upsertClient(phone,name=''){let c=db.prepare('SELECT * FROM clients WHERE phone=?').get(phone);if(!c){db.prepare('INSERT INTO clients(name,phone) VALUES(?,?)').run(name,phone);c=db.prepare('SELECT * FROM clients WHERE phone=?').get(phone);}else if(name&&(!c.name||c.name===''))db.prepare('UPDATE clients SET name=? WHERE phone=?').run(name,phone);return c;}
function catalogText(){return products().map(p=>{const prix=p.promo_price&&p.promo_price<p.price?`🔥 *${money(p.promo_price)}* (au lieu de ${money(p.price)})`:`💰 *${money(p.price)}*`;return `• *${p.id}* — ${p.name}\n  ${prix}`;}).join('\n\n');}
function findProduct(text){const s=text.toLowerCase();return products().find(p=>s.includes(p.id.toLowerCase())||s.includes(p.name.toLowerCase())||p.name.toLowerCase().split(/\s+/).some(w=>w.length>4&&s.includes(w)));}
function isGlobalCommand(text){return /^(aide|help|menu|accueil|retour|annuler|annule|stop|0)$/i.test(text.trim());}
function isCancelCommand(text){return /^(annuler|annule|stop|non|no|0)$/i.test(text.trim());}
function menuMessage(){return `Que puis-je faire pour vous ?\n\n1️⃣ Voir nos services → *CATALOGUE*\n2️⃣ Commander → *COMMANDER*\n3️⃣ Demander un devis → *DEVIS*\n4️⃣ Suivre une commande → *SUIVI*\n5️⃣ Parler à un conseiller → *CONSEILLER*\n\n_Tapez le mot-clé ou le numéro de votre choix._`;}

async function aiReply(phone,text){if(!openai)return null;const list=products().map(p=>({id:p.id,name:p.name,category:p.category,description:p.description,price:p.price,promo_price:p.promo_price,status:p.status}));const system=`Tu es l'assistant commercial de Digital César Service (DCS), basé à Fada N'Gourma, Burkina Faso. Disponible 24h/24. Paiements acceptés : Orange Money, Moov Money, Moov, Chariow. Pour contacter un humain : WhatsApp 77337914 ou 70336459. Tu aides les clients à choisir un service, préparer une commande ou demander un devis. Catalogue JSON: ${JSON.stringify(list)}. Règles strictes : ne jamais inventer un service ou un prix ; si le client veut commander, collecte : son nom, son téléphone et son moyen de paiement, puis confirme avant création ; ne jamais demander de mot de passe, code OTP ou secret bancaire ; pour une demande hors catalogue, propose un devis ; si le client demande un humain, dis-lui de contacter le 77337914. Réponds en français, de façon courte et claire. Format WhatsApp : utilise *gras* et des émojis appropriés.`;try{const r=await openai.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-4o-mini',max_tokens:500,messages:[{role:'system',content:system},{role:'user',content:text}]});return r.choices?.[0]?.message?.content?.trim()||null;}catch(e){console.error('OpenAI error:',e.message);return null;}}

async function ruleReply(phone,text){const t=text.trim();const lower=t.toLowerCase();const conv=getConv(phone);
if(isGlobalCommand(t)){resetConv(phone);return menuMessage();}
if(/^(bonjour|salut|hello|bonsoir|slt|bjr|bsr|hi)\b/i.test(t)){resetConv(phone);return `👋 Bonjour et bienvenue chez *Digital César Service* !\n\nJe suis votre assistant commercial, disponible *24h/24*.\n\n${menuMessage()}`;}
if(/catalogue|services|prix|menu|liste/i.test(lower)){resetConv(phone);return `📚 *Nos services DCS*\n\n${catalogText()}\n\n💬 Envoyez l'ID d'un service (ex : *P001*) pour les détails, ou *COMMANDER P001* pour commander.`;}
if(/devis|sur mesure|personnalis|budget/i.test(lower)){db.prepare('INSERT INTO quote_requests(phone,request) VALUES(?,?)').run(phone,t);setConv(phone,'quote_details',{request:t});return `📝 *Demande de devis*\n\nDécrivez votre besoin :\n• Type de travail\n• Quantité\n• Délai\n• Éléments disponibles\n\n_(Répondez *ANNULER* pour revenir au menu)_`;}
if(conv.state==='quote_details'){db.prepare('UPDATE quote_requests SET request=? WHERE phone=? AND id=(SELECT MAX(id) FROM quote_requests WHERE phone=?)').run(t,phone,phone);resetConv(phone);return `✅ *Demande enregistrée !*\n\nUn conseiller vous contactera rapidement.\n\n📞 *WhatsApp : 77337914 / 70336459*\n\n_(Tapez *MENU* pour revenir)_`;}
if(/conseiller|humain|agent|personne|contact/i.test(lower)){resetConv(phone);return `👨‍💼 *Contacter un conseiller DCS*\n\n📞 *WhatsApp : 77337914*\n📞 *WhatsApp : 70336459*\n\nDisponibles *24h/24*.`;}
if(/suivre|suivi|statut|ma commande|CMD-/i.test(lower)){const c=db.prepare('SELECT * FROM clients WHERE phone=?').get(phone);if(!c)return `📦 Aucune commande trouvée.\n\nContactez-nous : *WhatsApp 77337914*`;const rows=db.prepare(`SELECT o.*,p.name pname FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.client_id=? ORDER BY o.id DESC LIMIT 5`).all(c.id);if(!rows.length)return `📦 Aucune commande trouvée.\n\nContactez-nous : *WhatsApp 77337914*`;return `📦 *Vos dernières commandes :*\n\n${rows.map(o=>`🔹 *CMD-${String(o.id).padStart(5,'0')}* — ${o.pname}\n   Statut : *${o.status}* | Paiement : ${o.payment_status}`).join('\n\n')}`;}
const orderMatch=t.match(/(?:commander|commande|acheter)\s*(P\d{3})?/i);const directProduct=findProduct(t);
if(orderMatch||(directProduct&&/commander|commande|acheter|je veux|je prends/i.test(lower))){const pid=orderMatch?.[1]?productById(orderMatch[1].toUpperCase()):directProduct;if(pid){setConv(phone,'order_name',{productId:pid.id});return `🛒 *Commande en cours*\n\n*${pid.name}*\n💰 Prix : *${money(pid.promo_price||pid.price)}*\n\n👤 *Votre nom et prénom ?*\n\n_(Répondez *ANNULER* pour revenir)_`;}}
if(conv.state==='order_name'){if(isCancelCommand(t)){resetConv(phone);return menuMessage();}if(t.length<2)return `Merci d'entrer un nom valide.`;setConv(phone,'order_phone',{...conv.data,clientName:t});return `✅ Nom : *${t}*\n\n📱 *Votre numéro WhatsApp/téléphone ?*`;}
if(conv.state==='order_phone'){if(isCancelCommand(t)){resetConv(phone);return menuMessage();}if(!/\d{8,}/.test(t.replace(/\s/g,'')))return `Entrez un numéro valide (ex : 77000000).`;setConv(phone,'order_payment',{...conv.data,clientPhone:t});return `✅ Numéro : *${t}*\n\n💳 *Moyen de paiement ?*\n\n1️⃣ Orange Money\n2️⃣ Moov Money\n3️⃣ Moov\n4️⃣ Chariow\n5️⃣ Autre`;}
if(conv.state==='order_payment'){if(isCancelCommand(t)){resetConv(phone);return menuMessage();}const methods=['Orange Money','Moov Money','Moov','Chariow','Autre'];const idx=parseInt(t,10);const method=(idx>=1&&idx<=5)?methods[idx-1]:t;const d={...conv.data,paymentMethod:method};const prod=productById(d.productId);setConv(phone,'order_confirm',d);return `📋 *Récapitulatif*\n\n🛍️ ${prod.name}\n💰 *${money(prod.promo_price||prod.price)}*\n👤 ${d.clientName}\n📱 ${d.clientPhone}\n💳 ${method}\n\nRépondez *OUI* pour confirmer ✅\nRépondez *NON* pour annuler ❌`;}
if(conv.state==='order_confirm'){if(/^oui$/i.test(t)){const d=conv.data;const prod=productById(d.productId);const price=prod.promo_price||prod.price;const c=upsertClient(d.clientPhone,d.clientName);const r=db.prepare('INSERT INTO orders(client_id,product_id,quantity,unit_price,total,payment_method) VALUES(?,?,?,?,?,?)').run(c.id,prod.id,1,price,price,d.paymentMethod);resetConv(phone);return `🎉 *Commande confirmée !*\n\n📌 Référence : *CMD-${String(r.lastInsertRowid).padStart(5,'0')}*\n🛍️ ${prod.name}\n💰 *${money(price)}*\n💳 ${d.paymentMethod}\n\nUn conseiller vous contactera pour le paiement.\n\n📞 *WhatsApp : 77337914 / 70336459*\n\n_Merci de nous faire confiance !_ 🙏`;}if(isCancelCommand(t)){resetConv(phone);return `❌ Commande annulée.\n\n${menuMessage()}`;}return `Répondez *OUI* pour confirmer ou *NON* pour annuler.`;}
const found=findProduct(t);if(found)return `📦 *${found.name}*\n\n📝 ${found.description}\n\n💰 Prix normal : ${money(found.price)}\n🔥 Prix promo : *${money(found.promo_price||found.price)}*\n\nPour commander : *COMMANDER ${found.id}*`;
return `Je n'ai pas bien compris. 🙏\n\n${menuMessage()}`;}

async function handleMessage(phone,text){logMsg(phone,'in',text);upsertClient(phone);let out=null;if(openai){try{out=await aiReply(phone,text);}catch(e){console.error('AI:',e.message);}}if(!out)out=await ruleReply(phone,text);logMsg(phone,'out',out);return out;}
async function whatsappSend(to,text){if(!process.env.WHATSAPP_ACCESS_TOKEN||!process.env.WHATSAPP_PHONE_NUMBER_ID)return{mock:true};const url=`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION||'v23.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{preview_url:false,body:text}})});if(!r.ok)throw new Error(await r.text());return r.json();}

function admin(req,res,next){if(!process.env.ADMIN_TOKEN||req.headers.authorization!==`Bearer ${process.env.ADMIN_TOKEN}`)return res.status(401).json({error:'Non autorisé'});next();}
app.get('/api/health',(req,res)=>res.json({ok:true,products:products().length,whatsapp:!!process.env.WHATSAPP_ACCESS_TOKEN,ai:!!process.env.OPENAI_API_KEY,version:'2.1.0'}));
app.get('/api/products',admin,(req,res)=>res.json(products()));
app.post('/api/products',admin,(req,res)=>{const{id,name,category='',description='',price,promo_price=null,status='Disponible',image=''}=req.body;if(!id||!name||price===undefined)return res.status(400).json({error:'id, name et price requis'});db.prepare('INSERT OR REPLACE INTO products VALUES (?,?,?,?,?,?,?,?)').run(id,name,category,description,price,promo_price,status,image);res.json({ok:true});});
app.get('/api/clients',admin,(req,res)=>res.json(db.prepare('SELECT * FROM clients ORDER BY id DESC').all()));
app.get('/api/orders',admin,(req,res)=>res.json(db.prepare(`SELECT o.*,c.name client_name,c.phone client_phone,p.name product_name FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN products p ON p.id=o.product_id ORDER BY o.id DESC`).all()));
app.patch('/api/orders/:id',admin,(req,res)=>{const allowed=['status','payment_status','payment_method','delivery','notes'];const entries=allowed.filter(k=>req.body[k]!==undefined);if(!entries.length)return res.status(400).json({error:'Aucun champ'});db.prepare(`UPDATE orders SET ${entries.map(k=>`${k}=?`).join(',')} WHERE id=?`).run(...entries.map(k=>req.body[k]),req.params.id);res.json({ok:true});});
app.get('/api/quotes',admin,(req,res)=>res.json(db.prepare('SELECT * FROM quote_requests ORDER BY id DESC').all()));
app.patch('/api/quotes/:id',admin,(req,res)=>{const{status}=req.body;if(!status)return res.status(400).json({error:'status requis'});db.prepare('UPDATE quote_requests SET status=? WHERE id=?').run(status,req.params.id);res.json({ok:true});});
app.get('/api/stats',admin,(req,res)=>{const revenue=db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE payment_status IN ('Payé','Confirmé')").get().n;res.json({clients:db.prepare('SELECT COUNT(*) n FROM clients').get().n,orders:db.prepare('SELECT COUNT(*) n FROM orders').get().n,pending:db.prepare("SELECT COUNT(*) n FROM orders WHERE status NOT IN ('Livrée','Terminée')").get().n,quotes:db.prepare("SELECT COUNT(*) n FROM quote_requests WHERE status='Nouveau'").get().n,revenue});});
app.get('/webhook',(req,res)=>{if(req.query['hub.verify_token']===process.env.WHATSAPP_VERIFY_TOKEN)return res.status(200).send(req.query['hub.challenge']);return res.sendStatus(403);});
app.post('/webhook',async(req,res)=>{res.sendStatus(200);try{const changes=req.body?.entry?.flatMap(e=>e.changes||[])||[];for(const ch of changes){const msgs=ch.value?.messages||[];for(const msg of msgs){if(msg.type==='text'){const out=await handleMessage(msg.from,msg.text.body);await whatsappSend(msg.from,out);}else{await whatsappSend(msg.from,'📎 Je reçois uniquement les messages texte.\n\nTapez *CATALOGUE* pour voir nos services.');}}}}catch(e){console.error('Webhook:',e);}});
app.get('/api/test-message',admin,async(req,res)=>{const phone=String(req.query.phone||'22677337914');const text=String(req.query.text||'bonjour');const out=await handleMessage(phone,text);res.json({phone,text,reply:out});});
const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`🚀 DCS Bot v2.1 en ligne sur le port ${port}`));
