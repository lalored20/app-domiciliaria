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

// Almacenamiento local en memoria para simulación sin Supabase
const localDeliveries = [];
let localShift = null;
const whatsappLogs = [];

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
    const payload = {
        id: "web_" + order_id,
        chatbot_order_id: order_id,
        client_name,
        client_phone: client_phone.replace(/\D/g, ''),
        delivery_address: address,
        localidad,
        time_window: time_window || "10:00 - 12:00",
        amount: parseFloat(amount) || 0.00,
        pay_method: pay_method || 'Efectivo',
        status: 'PENDIENTE',
        qr_code: qr_code || `QR-ORQUIDEAS-${Math.floor(1000 + Math.random() * 9000)}`,
        expected_items: prendasEsperadas,
        collected_items: prendasEsperadas,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        delivery_date: new Date().toISOString().split('T')[0]
    };

    // Guardar en la base de datos en memoria local para que la app se actualice sin Supabase
    const existingIdx = localDeliveries.findIndex(d => d.chatbot_order_id === order_id || d.id === payload.id);
    if (existingIdx !== -1) {
        localDeliveries[existingIdx] = { ...localDeliveries[existingIdx], ...payload };
    } else {
        localDeliveries.push(payload);
    }
    console.log(`📦 [Webhook] Orden guardada en memoria local. Total de órdenes locales: ${localDeliveries.length}`);

    if (!supabase) {
        console.log("✅ [Webhook] Simulación exitosa (Sin Supabase). Datos generados:", payload);
        return res.status(200).json({
            success: true,
            message: "Simulado: Registro de orden recibido y guardado localmente.",
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
            message: "Despacho guardado exitosamente en Supabase y local.",
            data: data[0]
        });

    } catch (e) {
        console.error("❌ [Webhook] Excepción:", e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// NUEVOS ENDPOINTS DE SINCRONIZACIÓN Y WHATSAPP

// Obtener órdenes guardadas en el backend
app.get('/api/deliveries', (req, res) => {
    res.json({ success: true, data: localDeliveries });
});

// Sincronizar (Merge) de entregas del frontend al backend
app.post('/api/deliveries/sync', (req, res) => {
    const clientDeliveries = req.body.deliveries || [];
    clientDeliveries.forEach(clientD => {
        const idx = localDeliveries.findIndex(d => d.id === clientD.id || (d.chatbot_order_id && d.chatbot_order_id === clientD.chatbot_order_id));
        if (idx !== -1) {
            // Mezclar preservando campos más recientes
            localDeliveries[idx] = { ...localDeliveries[idx], ...clientD };
        } else {
            localDeliveries.push(clientD);
        }
    });
    res.json({ success: true, data: localDeliveries });
});

// Sincronizar Shift/Turno
app.post('/api/shift/sync', (req, res) => {
    localShift = req.body.shift;
    console.log("⚙️ [Caja] Sincronizado estado del turno en el servidor:", localShift);
    res.json({ success: true, data: localShift });
});

// Obtener Shift/Turno
app.get('/api/shift', (req, res) => {
    res.json({ success: true, data: localShift });
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
    res.json({
        status: "online",
        supabase_connected: supabase !== null,
        local_deliveries_count: localDeliveries.length,
        time: new Date().toISOString()
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
