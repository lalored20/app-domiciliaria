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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Servir archivos estáticos del Frontend (index.html, app.js, styles.css) con Cache-Control deshabilitado para desarrollo
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
});
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
const https = require('https');
const CHATBOT_DB_PATH = 'C:\\Users\\rmend\\Desktop\\Whatsapp Original\\data\\messages.db';
const APP_DB_PATH = path.join(__dirname, 'domiciliaria.db');

// Obtener fecha actual en formato local YYYY-MM-DD para Colombia (UTC-5)
function getColombiaDateString() {
    const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('fr-CA', options);
    return formatter.format(new Date());
}

// Convertir un timestamp unix epoch a fecha local YYYY-MM-DD en Colombia
function epochToColombiaDateString(epoch) {
    const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('fr-CA', options);
    return formatter.format(new Date(epoch * 1000));
}

// Coordenadas aproximadas de centros de localidades de Bogotá
function getLocalidadCenterCoords(localidad) {
    const coords = {
        "Usaquén": { lat: 4.7011, lon: -74.0330 },
        "Suba": { lat: 4.7250, lon: -74.0850 },
        "Chapinero": { lat: 4.6675, lon: -74.0560 },
        "Teusaquillo": { lat: 4.6432, lon: -74.0903 },
        "Barrios Unidos": { lat: 4.6669, lon: -74.0759 },
        "Engativá": { lat: 4.7012, lon: -74.1206 },
        "Fontibón": { lat: 4.6738, lon: -74.1442 },
        "Kennedy": { lat: 4.6307, lon: -74.1534 },
        "Bosa": { lat: 4.6186, lon: -74.1917 },
        "Puente Aranda": { lat: 4.6205, lon: -74.1105 },
        "Usme": { lat: 4.4600, lon: -74.1200 },
        "Ciudad Bolívar": { lat: 4.5300, lon: -74.1500 },
        "San Cristóbal": { lat: 4.5600, lon: -74.0800 }
    };
    return coords[localidad] || coords["Usaquén"];
}

// Extraer la localidad de Bogotá a partir del objeto de dirección de OpenStreetMap
function extractLocalidad(osmAddress) {
    const localities = ["Usaquén", "Suba", "Chapinero", "Teusaquillo", "Barrios Unidos", "Engativá", "Fontibón", "Kennedy", "Bosa", "Puente Aranda", "Usme", "Ciudad Bolívar", "San Cristóbal", "Rafael Uribe Uribe", "Tunjuelito", "Antonio Nariño", "Santa Fe", "Los Mártires", "La Candelaria", "Sumapaz"];
    const fields = [osmAddress.city_district, osmAddress.suburb, osmAddress.borough, osmAddress.town, osmAddress.neighbourhood, osmAddress.city];
    for (const val of fields) {
        if (!val) continue;
        const matched = localities.find(loc => val.toLowerCase().includes(loc.toLowerCase()) || loc.toLowerCase().includes(val.toLowerCase()));
        if (matched) return matched;
    }
    return null;
}

// Geocodificar dirección usando OpenStreetMap Nominatim
function geocodeAddress(address) {
    return new Promise((resolve) => {
        let query = address;
        // Eliminar apartamentos, casas, etc.
        query = query.replace(/(apto|apartamento|casa|piso|bloque|conjunto|interior|torre|barrio).*$/i, '').trim();
        
        // Reemplazar palabras de número en español
        query = query.replace(/n[uú]mero\s*/ig, ' ');
        query = query.replace(/nro\.?\s*/ig, ' ');
        query = query.replace(/\bno\.?\s*(?=\d)/ig, ' ');
        query = query.replace(/\bno\s+(?=\d)/ig, ' ');
        
        // Normalizar espaciado de letras y bis comunes en Bogotá
        query = query.replace(/\s+A\s+/ig, 'a ');
        query = query.replace(/\s+B\s+/ig, 'b ');
        query = query.replace(/\s+C\s+/ig, 'c ');
        query = query.replace(/\s+D\s+/ig, 'd ');
        query = query.replace(/\s+F\s+/ig, 'f ');
        query = query.replace(/\s+Bis\s+/ig, 'bis ');
        
        query = query.trim();
        
        if (!query.toLowerCase().includes("bogota")) {
            query += ", Bogota, Colombia";
        }
        
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=1`;
        
        const options = {
            headers: {
                'User-Agent': 'AppDomiciliaria/1.0 (lalored20@app-domiciliaria.com)'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const results = JSON.parse(data);
                    if (results && results.length > 0) {
                        const first = results[0];
                        const loc = extractLocalidad(first.address || {});
                        resolve({
                            lat: parseFloat(first.lat),
                            lon: parseFloat(first.lon),
                            display_name: first.display_name,
                            localidad: loc
                        });
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => {
            resolve(null);
        });
    });
}

// Reversar geocodificación usando OpenStreetMap Nominatim
function reverseGeocode(lat, lon) {
    return new Promise((resolve) => {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`;
        
        const options = {
            headers: {
                'User-Agent': 'AppDomiciliaria/1.0 (lalored20@app-domiciliaria.com)'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result && result.address) {
                        const loc = extractLocalidad(result.address);
                        resolve({
                            display_name: result.display_name,
                            localidad: loc
                        });
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => {
            resolve(null);
        });
    });
}

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

            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN resolved_address TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN resolved_localidad TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            
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
function detectarLocalidad(direccion, lat, lon) {
    if (direccion) {
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
        if (dirUpper.includes("KENNEDY") || dirUpper.includes("CASTILLA") || dirUpper.includes("AMERICAS") || dirUpper.includes("TINTAL") || dirUpper.includes("TIERRA BUENA") || dirUpper.includes("TIERRABUENA") || dirUpper.includes("PATIO BONITO") || dirUpper.includes("CANDALAIMA")) {
            return "Kennedy";
        }
        if (dirUpper.includes("BOSA") || dirUpper.includes("RECREO")) {
            return "Bosa";
        }
        if (dirUpper.includes("PUENTE ARANDA") || dirUpper.includes("SALAZAR GOMEZ") || dirUpper.includes("MUZU")) {
            return "Puente Aranda";
        }
        if (dirUpper.includes("USME") || dirUpper.includes("SAN ANTONIO ELIAS") || dirUpper.includes("SAN ANTONIO") || dirUpper.includes("AVISUR") || dirUpper.includes("VIRREY")) {
            return "Usme";
        }
        if (dirUpper.includes("CIUDAD BOLIVAR") || dirUpper.includes("MADRIGAL")) {
            return "Ciudad Bolívar";
        }
        if (dirUpper.includes("SAN CRISTOBAL") || dirUpper.includes("20 DE JULIO")) {
            return "San Cristóbal";
        }
    }

    if (lat && lon) {
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);
        if (latitude < 4.59) {
            return "Usme";
        }
        if (latitude > 4.69) {
            if (longitude > -74.05) return "Usaquén";
            return "Suba";
        }
        if (latitude >= 4.59 && latitude <= 4.69) {
            if (longitude > -74.06) return "Chapinero";
            if (longitude <= -74.06 && longitude > -74.09) return "Teusaquillo";
            if (longitude <= -74.09 && longitude > -74.14) return "Kennedy";
            return "Bosa";
        }
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
                    // Convert unix epoch to YYYY-MM-DD in Colombia timezone
                    const dateStr = epochToColombiaDateString(o.created_at);
                    const expectedItems = meta.expected_items !== undefined ? meta.expected_items : (o.items_count || 1);
                    
                    return {
                        id: o.id,
                        chatbot_order_id: o.id,
                        ticket_number: o.ticketNumber,
                        client_name: o.clientName,
                        client_phone: o.clientPhone.replace(/\D/g, ''),
                        address: meta.resolved_address || o.clientAddress,
                        localidad: meta.resolved_localidad || detectarLocalidad(meta.resolved_address || o.clientAddress, meta.latitude, meta.longitude),
                        time_window: meta.time_window || "10:00 - 12:00",
                        amount: o.totalValue,
                        pay_method: o.paymentStatus === 'PAGADO' ? 'Pagado (Online)' : 'Efectivo',
                        status: o.status || 'PENDIENTE',
                        qr_code: `QR-ORQUIDEAS-${o.ticketNumber || Math.floor(1000 + Math.random() * 9000)}`,
                        expected_items: expectedItems,
                        collected_items: meta.collected_items !== undefined ? meta.collected_items : expectedItems,
                        evidence_photo: meta.evidence_photo || null,
                        signature_drawn: meta.signature_drawn === 1,
                        order_date: meta.delivery_date || o.scheduledDate || dateStr,
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
                    getColombiaDateString(),
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
                        delivery_date: getColombiaDateString()
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
                    clientD.order_date || getColombiaDateString(),
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

// Iniciar el proceso de geocodificación en segundo plano
function startBackgroundGeocoding() {
    console.log("📡 [Geocoder] Iniciando servicio de geocodificación automática...");
    setInterval(() => {
        // 1. Obtener todas las órdenes que ya tienen coordenadas en nuestra DB local
        appDb.all(`SELECT order_id FROM delivery_metadata WHERE latitude IS NOT NULL`, [], (err, metaRows) => {
            if (err) {
                console.error("❌ [Geocoder] Error consultando delivery_metadata:", err.message);
                return;
            }
            
            const geocodedIds = metaRows ? metaRows.map(r => r.order_id) : [];
            
            // 2. Buscar una orden en local_orders (chatbot db) que no esté en la lista de geocodificados
                        let query = `SELECT id, clientAddress FROM local_orders`;
            let params = [];
            
            if (geocodedIds.length > 0) {
                const placeholders = geocodedIds.map(() => '?').join(',');
                query += ` WHERE id NOT IN (${placeholders})`;
                params = geocodedIds;
            }
            query += ` ORDER BY created_at DESC LIMIT 1`;
            
            chatbotDb.all(query, params, (err, rows) => {
                if (err) {
                    console.error("❌ [Geocoder] Error consultando local_orders:", err.message);
                    return;
                }
                if (!rows || rows.length === 0) {
                    // No hay órdenes pendientes de geocodificación
                    return;
                }
                
                const order = rows[0];
                const address = order.clientAddress;
                
                if (!address || address === 'Recogida WhatsApp') {
                    const nowEpoch = Math.floor(Date.now() / 1000);
                    const baseLat = 4.7011;
                    const baseLng = -74.0330;
                    
                    appDb.get(`SELECT * FROM delivery_metadata WHERE order_id = ?`, [order.id], (err, meta) => {
                        if (err) return;
                        if (meta) {
                            appDb.run(`UPDATE delivery_metadata SET latitude = ?, longitude = ?, resolved_address = ?, resolved_localidad = ?, updated_at = ? WHERE order_id = ?`, [baseLat, baseLng, 'Recogida WhatsApp', 'Usaquén', nowEpoch, order.id]);
                        } else {
                            appDb.run(`INSERT INTO delivery_metadata (order_id, latitude, longitude, resolved_address, resolved_localidad, delivery_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [order.id, baseLat, baseLng, 'Recogida WhatsApp', 'Usaquén', getColombiaDateString(), nowEpoch]);
                        }
                    });
                    return;
                }

                // 3. Si la dirección es de tipo "Ubicación GPS: lat, lon" o un enlace a Google Maps con coordenadas
                let lat = null;
                let lon = null;
                let isGps = false;

                const gpsMatch = address.match(/Ubicación GPS:\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)/i);
                if (gpsMatch) {
                    lat = parseFloat(gpsMatch[1]);
                    lon = parseFloat(gpsMatch[2]);
                    isGps = true;
                } else {
                    const mapsMatch = address.match(/(?:google\..*maps.*[?&]q=|maps\..*[?&]q=)(-?\d+\.\d+),\s*(-?\d+\.\d+)/i);
                    if (mapsMatch) {
                        lat = parseFloat(mapsMatch[1]);
                        lon = parseFloat(mapsMatch[2]);
                        isGps = true;
                    }
                }

                if (isGps) {
                    console.log(`📡 [Geocoder] Detectada ubicación GPS: (${lat}, ${lon}) para orden ${order.id}. Realizando geocodificación inversa...`);
                    
                    reverseGeocode(lat, lon).then(result => {
                        const nowEpoch = Math.floor(Date.now() / 1000);
                        const resolvedAddress = result ? result.display_name : `Ubicación GPS: ${lat}, ${lon}`;
                        const resolvedLocalidad = result && result.localidad ? result.localidad : detectarLocalidad(address, lat, lon);
                        
                        console.log(`✅ [Geocoder] Ubicación GPS resuelta: "${resolvedAddress}" [${resolvedLocalidad}]`);
                        
                        appDb.get(`SELECT * FROM delivery_metadata WHERE order_id = ?`, [order.id], (err, meta) => {
                            if (err) return;
                            if (meta) {
                                appDb.run(`UPDATE delivery_metadata SET latitude = ?, longitude = ?, resolved_address = ?, resolved_localidad = ?, updated_at = ? WHERE order_id = ?`, [lat, lon, resolvedAddress, resolvedLocalidad, nowEpoch, order.id]);
                            } else {
                                appDb.run(`INSERT INTO delivery_metadata (order_id, latitude, longitude, resolved_address, resolved_localidad, delivery_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [order.id, lat, lon, resolvedAddress, resolvedLocalidad, getColombiaDateString(), nowEpoch]);
                            }
                        });
                    });
                    return;
                }

                // 4. Dirección normal de texto
                console.log(`📡 [Geocoder] Intentando geolocalizar dirección de texto: "${address}" para orden ${order.id}...`);
                geocodeAddress(address).then(coords => {
                    const nowEpoch = Math.floor(Date.now() / 1000);
                    let finalLat = coords ? coords.lat : null;
                    let finalLon = coords ? coords.lon : null;
                    let resolvedAddress = coords ? coords.display_name : address;
                    let resolvedLocalidad = coords ? coords.localidad : null;
                    
                    if (!finalLat || !finalLon) {
                        resolvedLocalidad = detectarLocalidad(address);
                        const fallback = getLocalidadCenterCoords(resolvedLocalidad);
                        finalLat = fallback.lat;
                        finalLon = fallback.lon;
                        console.log(`⚠️ [Geocoder] No se pudo encontrar coordenadas para "${address}". Asignando centro de ${resolvedLocalidad}: (${finalLat}, ${finalLon})`);
                    } else {
                        if (!resolvedLocalidad) {
                            resolvedLocalidad = detectarLocalidad(resolvedAddress, finalLat, finalLon);
                        }
                        console.log(`✅ [Geocoder] Geolocalizado con éxito: "${resolvedAddress}" (${finalLat}, ${finalLon}) [${resolvedLocalidad}]`);
                    }

                    // Guardar/Actualizar en domiciliaria.db de forma segura
                    appDb.get(`SELECT * FROM delivery_metadata WHERE order_id = ?`, [order.id], (err, meta) => {
                        if (err) return;
                        if (meta) {
                            appDb.run(`UPDATE delivery_metadata SET latitude = ?, longitude = ?, resolved_address = ?, resolved_localidad = ?, updated_at = ? WHERE order_id = ?`, [finalLat, finalLon, resolvedAddress, resolvedLocalidad, nowEpoch, order.id], (err) => {
                                if (err) console.error("❌ [Geocoder] Error al actualizar coordenadas:", err.message);
                            });
                        } else {
                            appDb.run(`INSERT INTO delivery_metadata (order_id, latitude, longitude, resolved_address, resolved_localidad, delivery_date, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [order.id, finalLat, finalLon, resolvedAddress, resolvedLocalidad, getColombiaDateString(), nowEpoch], (err) => {
                                if (err) console.error("❌ [Geocoder] Error al insertar coordenadas:", err.message);
                            });
                        }
                    });
                });
            });
        });
    }, 5000);
}

const PORT = 3000;
app.listen(PORT, () => {
    console.log("\n=======================================================");
    console.log(`🚀 SERVIDOR LOCAL DE APP DOMICILIARIA ACTIVO`);
    console.log(`💻 Frontend App: http://localhost:${PORT}`);
    console.log(`📥 API Webhook:  http://localhost:${PORT}/api/webhook/order`);
    console.log("=======================================================\n");
    
    // Iniciar geocodificador en segundo plano
    startBackgroundGeocoding();
});
