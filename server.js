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

// Clasificación básica de Localidades
function detectarLocalidad(direccion) {
    const dirUpper = direccion.toUpperCase();
    if (dirUpper.includes("USAQUEN") || dirUpper.includes("CEDRITOS") || dirUpper.includes("SANTA BARBARA")) {
        return "Usaquén";
    }
    if (dirUpper.includes("SUBA") || dirUpper.includes("NIZA") || dirUpper.includes("ALHAMBRA") || dirUpper.includes("COLINA")) {
        return "Suba";
    }
    if (dirUpper.includes("CHAPINERO") || dirUpper.includes("CHICO") || dirUpper.includes("ROSALES")) {
        return "Chapinero";
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

    if (!supabase) {
        console.log("✅ [Webhook] Simulación exitosa (Sin Supabase). Datos generados:", payload);
        return res.status(200).json({
            success: true,
            message: "Simulado: Registro de orden recibido con éxito.",
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
            message: "Despacho guardado exitosamente en Supabase.",
            data: data[0]
        });

    } catch (e) {
        console.error("❌ [Webhook] Excepción:", e.message);
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Ruta de información del servidor
app.get('/api/status', (req, res) => {
    res.json({
        status: "online",
        supabase_connected: supabase !== null,
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
