/**
 * SYSTEMA ANTIGRAVITY v4.5: SERVIDOR LOCAL DE PRUEBAS COMPLETO
 * 
 * Este servidor Express sirve el Frontend de la App Domiciliaria en http://localhost:3000
 * y expone el Webhook del chatbot en http://localhost:3000/api/webhook/order
 */

const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());

// Servir archivos estáticos del Frontend (index.html, app.js, styles.css)
app.use(express.static(path.join(__dirname)));

// Configuración de Supabase opcional
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let supabase = null;

if (supabaseUrl && supabaseServiceKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseServiceKey);
        console.log("🔗 Supabase conectado en el servidor.");
    } catch (e) {
        console.error("❌ Error conectando a Supabase:", e.message);
    }
} else {
    console.log("ℹ️ Corriendo en modo simulación (Sin base de datos Supabase conectada).");
}

const sqlite3 = require('sqlite3').verbose();
const CHATBOT_DB_PATH = 'C:\\Users\\rmend\\Desktop\\Whatsapp Original\\data\\messages.db';
const APP_DB_PATH = path.join(__dirname, 'domiciliaria.db');

// In-memory array for WhatsApp logs
const whatsappLogs = [];

// Conexión a la Base de Datos del Chatbot (Lectura y Escritura para cambiar estados)
const chatbotDb = new sqlite3.Database(CHATBOT_DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error("❌ Error al abrir la base de datos del Chatbot (messages.db):", err.message);
    } else {
        console.log("🔗 Conectado a la base de datos del Chatbot (messages.db).");
    }
});

// Conexión a nuestra Base de Datos propia de la App Domiciliaria
const appDb = new sqlite3.Database(APP_DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error("❌ Error al abrir la base de datos de App Domiciliaria (domiciliaria.db):", err.message);
    } else {
        console.log("🔗 Conectado a la base de datos de App Domiciliaria (domiciliaria.db).");
        // Inicializar tablas de metadatos y turnos
        appDb.serialize(() => {
            appDb.run(`CREATE TABLE IF NOT EXISTS delivery_metadata (
                order_id TEXT PRIMARY KEY,
                time_window TEXT,
                expected_items INTEGER,
                collected_items INTEGER,
                evidence_photo TEXT,
                signature_drawn INTEGER DEFAULT 0,
                latitude REAL,
                longitude REAL,
                driver_notes TEXT,
                delivery_date TEXT,
                updated_at INTEGER
            )`);
            
            appDb.run(`CREATE TABLE IF NOT EXISTS shift_state (
                id TEXT PRIMARY KEY,
                driver_name TEXT,
                initial_cash REAL,
                collected_cash REAL,
                expenses REAL,
                status TEXT,
                shift_date TEXT,
                expenses_detail TEXT,
                updated_at INTEGER
            )`);
        });
    }
});

// Clasificación básica de Localidades
function detectarLocalidad(direccion) {
    const dirUpper = direccion.toUpperCase();
    if (dirUpper.includes("USAQUEN") || dirUpper.includes("CEDRITOS") || dirUpper.includes("SANTA BARBARA") || dirUpper.includes("CANTALEJO")) {
        return "Usaquén";
    }
    if (dirUpper.includes("SUBA") || dirUpper.includes("NIZA") || dirUpper.includes("ALHAMBRA") || dirUpper.includes("COLINA") || dirUpper.includes("PORTALES")) {
        return "Suba";
    }
    if (dirUpper.includes("CHAPINERO") || dirUpper.includes("CHICO") || dirUpper.includes("ROSALES") || dirUpper.includes("RETIRO")) {
        return "Chapinero";
    }
    if (dirUpper.includes("TEUSAQUILLO") || dirUpper.includes("SALITRE") || dirUpper.includes("GALERIAS") || dirUpper.includes("QUINTA PAREDES")) {
        return "Teusaquillo";
    }
    if (dirUpper.includes("BARRIOS UNIDOS") || dirUpper.includes("CASTELLANA") || dirUpper.includes("METROPOLIS") || dirUpper.includes("POLO")) {
        return "Barrios Unidos";
    }
    if (dirUpper.includes("ENGATIVA") || dirUpper.includes("BOCHICA") || dirUpper.includes("ALAMOS") || dirUpper.includes("MINUTO DE DIOS")) {
        return "Engativá";
    }
    if (dirUpper.includes("FONTIBON") || dirUpper.includes("MODELIA") || dirUpper.includes("HAYUELOS") || dirUpper.includes("ZONA FRANCA")) {
        return "Fontibón";
    }
    if (dirUpper.includes("KENNEDY") || dirUpper.includes("CASTILLA") || dirUpper.includes("AMERICAS") || dirUpper.includes("TINTAL")) {
        return "Kennedy";
    }
    if (dirUpper.includes("BOSA") || dirUpper.includes("RECREO")) {
        return "Bosa";
    }
    if (dirUpper.includes("PUENTE ARANDA") || dirUpper.includes("SALAZAR GOMEZ") || dirUpper.includes("MUZU")) {
        return "Puente Aranda";
    }
    return "Usaquén"; 
}


// Helper to get merged deliveries from SQLite databases
function getMergedDeliveries() {
    return new Promise((resolve, reject) => {
        chatbotDb.all(`
            SELECT 
                o.id, 
                o.ticketNumber, 
                o.status, 
                o.location, 
                o.totalValue, 
                o.paidAmount, 
                o.paymentStatus, 
                o.scheduledDate, 
                o.clientName, 
                o.clientPhone, 
                o.clientAddress,
                o.chatTranscription,
                o.paymentDetails,
                o.created_at,
                o.updated_at,
                (SELECT SUM(quantity) FROM local_order_items WHERE orderId = o.id) as items_count
            FROM local_orders o
        `, [], (err, chatbotOrders) => {
            if (err) {
                return reject(err);
            }
            
            appDb.all(`SELECT * FROM delivery_metadata`, [], (err, metadataRows) => {
                if (err) {
                    return reject(err);
                }
                
                const metadataMap = {};
                metadataRows.forEach(row => {
                    metadataMap[row.order_id] = row;
                });
                
                const merged = chatbotOrders.map(o => {
                    const meta = metadataMap[o.id] || {};
                    // Convert unix epoch to YYYY-MM-DD
                    const dateStr = new Date(o.created_at * 1000).toISOString().split('T')[0];
                    const expectedItems = meta.expected_items !== undefined ? meta.expected_items : (o.items_count || 1);
                    
                    return {
                        id: o.id,
                        chatbot_order_id: o.id,
                        ticket_number: o.ticketNumber,
                        client_name: o.clientName,
                        client_phone: o.clientPhone.replace(/\D/g, ''),
                        address: o.clientAddress,
                        localidad: detectarLocalidad(o.clientAddress),
                        time_window: meta.time_window || "10:00 - 12:00",
                        amount: o.totalValue,
                        pay_method: o.paymentStatus === 'PAGADO' ? 'Pagado (Online)' : 'Efectivo',
                        status: o.status || 'PENDIENTE',
                        qr_code: `QR-ORQUIDEAS-${o.ticketNumber || Math.floor(1000 + Math.random() * 9000)}`,
                        expected_items: expectedItems,
                        collected_items: meta.collected_items !== undefined ? meta.collected_items : expectedItems,
                        evidence_photo: meta.evidence_photo || null,
                        signature_drawn: meta.signature_drawn === 1,
                        order_date: dateStr,
                        sync_pending: false,
                        latitude: meta.latitude || null,
                        longitude: meta.longitude || null,
                        chat_transcription: o.chatTranscription || null,
                        payment_details: o.paymentDetails || null
                    };
                });
                
                resolve(merged);
            });
        });
    });
}

// Webhook receptor del Chatbot de WhatsApp
app.post('/api/webhook/order', async (req, res) => {
    console.log("\n📥 [Webhook] Petición recibida del Chatbot de WhatsApp:", req.body);
    
    const {
        order_id,
        client_name,
        client_phone,
        address,
        amount,
        pay_method,
        qr_code,
        time_window,
        expected_items,
        latitude,
        longitude
    } = req.body;

    if (!order_id || !client_name || !client_phone || !address) {
        console.error("❌ [Webhook] Error: Faltan campos requeridos.");
        return res.status(400).json({
            success: false,
            error: "Faltan campos obligatorios: order_id, client_name, client_phone, address"
        });
    }

    const localidad = detectarLocalidad(address);
    const prendasEsperadas = parseInt(expected_items) || 1;
    const nowEpoch = Math.floor(Date.now() / 1000);
    const payStatus = pay_method === 'Pagado (Online)' || pay_method === 'PAGADO' ? 'PAGADO' : 'PENDIENTE';
    const paidAmt = payStatus === 'PAGADO' ? parseFloat(amount) || 0 : 0;

    // Obtener el siguiente número de ticket
    chatbotDb.get("SELECT MAX(ticketNumber) as maxTicket FROM local_orders", [], (err, row) => {
        const nextTicket = (row && row.maxTicket ? row.maxTicket : 0) + 1;
        
        chatbotDb.serialize(() => {
            // Insertar/actualizar orden en local_orders
            chatbotDb.run(`
                INSERT INTO local_orders (id, ticketNumber, status, location, totalValue, paidAmount, paymentStatus, scheduledDate, clientName, clientPhone, clientAddress, created_at, updated_at)
                VALUES (?, ?, 'PENDIENTE', 'RECEPCION', ?, ?, ?, NULL, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET 
                    totalValue = excluded.totalValue,
                    paidAmount = excluded.paidAmount,
                    paymentStatus = excluded.paymentStatus,
                    clientName = excluded.clientName,
                    clientPhone = excluded.clientPhone,
                    clientAddress = excluded.clientAddress,
                    updated_at = excluded.updated_at
            `, [
                order_id,
                nextTicket,
                parseFloat(amount) || 0,
                paidAmt,
                payStatus,
                client_name,
                client_phone,
                address,
                nowEpoch,
                nowEpoch
            ], async function(err) {
                if (err) {
                    console.error("❌ [Webhook] Error al insertar en local_orders:", err.message);
                    return res.status(500).json({ success: false, error: err.message });
                }

                // Insertar/actualizar item en local_order_items
                const itemId = "item_" + order_id;
                chatbotDb.run(`
                    INSERT INTO local_order_items (id, orderId, quantity, type, price, created_at, updated_at)
                    VALUES (?, ?, ?, 'PRENDA', ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        quantity = excluded.quantity,
                        price = excluded.price,
                        updated_at = excluded.updated_at
                `, [
                    itemId,
                    order_id,
                    prendasEsperadas,
                    parseFloat(amount) || 0,
                    nowEpoch,
                    nowEpoch
                ], (err) => {
                    if (err) console.error("❌ [Webhook] Error al insertar en local_order_items:", err.message);
                });

                // Insertar/actualizar metadatos en nuestra DB local
                appDb.run(`
                    INSERT OR REPLACE INTO delivery_metadata (order_id, time_window, expected_items, collected_items, latitude, longitude, delivery_date, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    order_id,
                    time_window || "10:00 - 12:00",
                    prendasEsperadas,
                    prendasEsperadas,
                    latitude ? parseFloat(latitude) : null,
                    longitude ? parseFloat(longitude) : null,
                    new Date().toISOString().split('T')[0],
                    nowEpoch
                ], async (err) => {
                    if (err) {
                        console.error("❌ [Webhook] Error al guardar metadatos en domiciliaria.db:", err.message);
                    }

                    const payload = {
                        id: order_id,
                        chatbot_order_id: order_id,
                        client_name,
                        client_phone: client_phone.replace(/\D/g, ''),
                        delivery_address: address,
                        localidad,
                        time_window: time_window || "10:00 - 12:00",
                        amount: parseFloat(amount) || 0.00,
                        pay_method: pay_method || 'Efectivo',
                        status: 'PENDIENTE',
                        qr_code: `QR-ORQUIDEAS-${nextTicket}`,
                        expected_items: prendasEsperadas,
                        collected_items: prendasEsperadas,
                        latitude: latitude ? parseFloat(latitude) : null,
                        longitude: longitude ? parseFloat(longitude) : null,
                        delivery_date: new Date().toISOString().split('T')[0]
                    };

                    console.log("📦 [Webhook] Orden guardada en SQLite local (messages.db & domiciliaria.db).");

                    if (!supabase) {
                        console.log("✅ [Webhook] Simulación exitosa (Sin Supabase).");
                        return res.status(200).json({
                            success: true,
                            message: "Registro de orden recibido y guardado en SQLite local.",
                            data: payload
                        });
                    }

                    try {
                        const { data, error } = await supabase
                            .from('deliveries')
                            .upsert(payload, { onConflict: 'chatbot_order_id' })
                            .select();

                        if (error) {
                            console.error("❌ [Webhook] Error de Supabase:", error.message);
                            return res.status(500).json({ success: false, error: error.message });
                        }

                        console.log("✅ [Webhook] Orden guardada en Supabase:", data[0]);
                        return res.status(200).json({
                            success: true,
                            message: "Despacho guardado exitosamente en Supabase y SQLite local.",
                            data: data[0]
                        });
                    } catch (e) {
                        console.error("❌ [Webhook] Excepción Supabase:", e.message);
                        return res.status(500).json({ success: false, error: e.message });
                    }
                });
            });
        });
    });
});

// NUEVOS ENDPOINTS DE SINCRONIZACIÓN Y WHATSAPP

// Obtener órdenes guardadas en el backend
app.get('/api/deliveries', async (req, res) => {
    try {
        const deliveries = await getMergedDeliveries();
        res.json({ success: true, data: deliveries });
    } catch (err) {
        console.error("❌ Error al obtener entregas:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sincronizar (Merge) de entregas del frontend al backend
app.post('/api/deliveries/sync', async (req, res) => {
    const clientDeliveries = req.body.deliveries || [];
    const nowEpoch = Math.floor(Date.now() / 1000);
    
    // Procesar cada entrega de forma secuencial en SQLite
    const promises = clientDeliveries.map(clientD => {
        return new Promise((resolve) => {
            // 1. Actualizar el estado en el chatbot's messages.db
            chatbotDb.run(`
                UPDATE local_orders 
                SET status = ?, updated_at = ? 
                WHERE id = ? OR ticketNumber = ?
            `, [
                clientD.status,
                nowEpoch,
                clientD.id,
                clientD.id.replace('QR-ORQUIDEAS-', '')
            ], (err) => {
                if (err) {
                    console.error(`❌ Error actualizando estado en messages.db para ${clientD.id}:`, err.message);
                }
                
                // 2. Guardar metadatos extendidos en nuestra domiciliaria.db
                appDb.run(`
                    INSERT OR REPLACE INTO delivery_metadata (
                        order_id, time_window, expected_items, collected_items, 
                        evidence_photo, signature_drawn, latitude, longitude, 
                        delivery_date, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    clientD.id,
                    clientD.time_window || "10:00 - 12:00",
                    clientD.expected_items || 1,
                    clientD.collected_items || 1,
                    clientD.evidence_photo || null,
                    clientD.signature_drawn ? 1 : 0,
                    clientD.latitude || null,
                    clientD.longitude || null,
                    clientD.order_date || new Date().toISOString().split('T')[0],
                    nowEpoch
                ], (err) => {
                    if (err) {
                        console.error(`❌ Error guardando metadatos en domiciliaria.db para ${clientD.id}:`, err.message);
                    }
                    resolve();
                });
            });
        });
    });

    try {
        await Promise.all(promises);
        const deliveries = await getMergedDeliveries();
        res.json({ success: true, data: deliveries });
    } catch (err) {
        console.error("❌ Error en sync de entregas:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sincronizar Shift/Turno
app.post('/api/shift/sync', (req, res) => {
    const shift = req.body.shift;
    if (!shift) {
        return res.status(400).json({ success: false, error: "Falta el objeto shift" });
    }

    appDb.run(`
        INSERT OR REPLACE INTO shift_state (id, driver_name, initial_cash, collected_cash, expenses, status, shift_date, expenses_detail, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        shift.id,
        shift.driver_name,
        shift.initial_cash,
        shift.collected_cash,
        shift.expenses,
        shift.status,
        shift.shift_date,
        JSON.stringify(shift.expenses_detail || []),
        Math.floor(Date.now() / 1000)
    ], (err) => {
        if (err) {
            console.error("❌ Error al guardar el turno:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        console.log("⚙️ [Caja] Sincronizado estado del turno en SQLite:", shift);
        res.json({ success: true, data: shift });
    });
});

// Obtener Shift/Turno
app.get('/api/shift', (req, res) => {
    appDb.get(`SELECT * FROM shift_state ORDER BY updated_at DESC LIMIT 1`, [], (err, row) => {
        if (err) {
            console.error("❌ Error al obtener el turno:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        if (!row) {
            return res.json({ success: true, data: null });
        }
        const shift = {
            id: row.id,
            driver_name: row.driver_name,
            initial_cash: row.initial_cash,
            collected_cash: row.collected_cash,
            expenses: row.expenses,
            status: row.status,
            shift_date: row.shift_date,
            expenses_detail: JSON.parse(row.expenses_detail || '[]'),
            sync_pending: false
        };
        res.json({ success: true, data: shift });
    });
});

// Proxy para enviar notificaciones a través de una API de WhatsApp original
app.post('/api/whatsapp/send', async (req, res) => {
    const { phone, message, client_name, address, status, order_id } = req.body;
    const timestamp = new Date().toISOString();
    
    console.log(`\n💬 [WhatsApp API Send]`);
    console.log(`📱 Destinatario: ${phone} (${client_name || 'Sin Nombre'})`);
    console.log(`✉️ Mensaje: "${message}"`);
    console.log(`📦 Detalle: Orden ${order_id || 'N/A'}, Dirección: ${address || 'N/A'}, Estado: ${status || 'N/A'}`);
    
    const logEntry = {
        timestamp: new Date().toLocaleTimeString(),
        phone,
        message,
        client_name,
        status: "ENVIADO",
        order_id
    };
    whatsappLogs.push(logEntry);
    if (whatsappLogs.length > 50) whatsappLogs.shift();

    // Reenvío a API de WhatsApp externa si está configurada en variables de entorno o localmente
    const extUrl = process.env.WHATSAPP_API_URL || '';
    const extToken = process.env.WHATSAPP_API_TOKEN || '';
    
    if (extUrl) {
        try {
            console.log(`🔗 [Proxy] Reenviando a API externa: ${extUrl}`);
            const headers = { "Content-Type": "application/json" };
            if (extToken) headers["Authorization"] = `Bearer ${extToken}`;
            
            const response = await fetch(extUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({ phone, message, client_name, order_id })
            });
            console.log(`🔗 [Proxy] Respuesta API externa: ${response.status}`);
        } catch (e) {
            console.error(`❌ [Proxy] Error de reenvío:`, e.message);
        }
    }

    res.json({
        success: true,
        message: "Mensaje procesado e impreso en el servidor.",
        log: logEntry
    });
});

// Obtener logs de WhatsApp
app.get('/api/whatsapp/logs', (req, res) => {
    res.json({ success: true, logs: whatsappLogs });
});

// Ruta de información del servidor
app.get('/api/status', (req, res) => {
    chatbotDb.get("SELECT COUNT(*) as count FROM local_orders", [], (err, row) => {
        const orderCount = row ? row.count : 0;
        res.json({
            status: "online",
            supabase_connected: supabase !== null,
            sqlite_connected: true,
            local_deliveries_count: orderCount,
            time: new Date().toISOString()
        });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log("\n=======================================================");
    console.log(`🚀 SERVIDOR LOCAL DE APP DOMICILIARIA ACTIVO`);
    console.log(`💻 Frontend App: http://localhost:${PORT}`);
    console.log(`📥 API Webhook:  http://localhost:${PORT}/api/webhook/order`);
    console.log("=======================================================\n");
});
