/**
 * SYSTEMA ANTIGRAVITY v4.5: WEBHOOK API DE INTEGRACIÓN (CHATBOT -> SUPABASE)
 * 
 * Este script es un servidor Node.js/Express de producción listo para recibir
 * las notificaciones del chatbot de IA de WhatsApp, procesar los datos de entrega
 * y guardarlos en Supabase de forma segura e idempotente.
 * 
 * Puedes desplegarlo en un VPS, en Vercel, Render, o adaptarlo como una Supabase Edge Function.
 */

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // Cargar variables de entorno (.env)

const app = express();
app.use(express.json());

// Inicializar cliente de Supabase con Service Role (Bypassa RLS para escritura del chatbot)
const supabaseUrl = process.env.SUPABASE_URL || 'https://tu-proyecto.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Clave privada de backend

let supabase;
if (supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
    console.log("Conexión de Webhook con Supabase establecida.");
} else {
    console.warn("⚠️ Falta SUPABASE_SERVICE_ROLE_KEY. El webhook operará en modo simulación.");
}

// Clasificación básica de Localidades por palabras clave en la dirección (Heurística)
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

/**
 * POST /api/webhook/order
 * Recibe los datos de venta cerrada por el chatbot de WhatsApp
 */
app.post('/api/webhook/order', async (req, res) => {
    const {
        order_id,          // ID de orden generado por el Chatbot (clave de idempotencia)
        client_name,       // Nombre del cliente
        client_phone,      // WhatsApp del cliente (ej: "573001234567")
        address,           // Dirección física ingresada
        amount,            // Total de la factura
        pay_method,        // Efectivo | Transferencia | Pagado
        qr_code,           // Código QR/Barras asignado a la prenda/bolsa
        time_window,       // Ventana horaria preferida (ej: "08:00 - 10:00")
        expected_items,    // Opcional: Número de prendas iniciales
        latitude,          // Opcional: Latitud GPS enviada por el cliente
        longitude          // Opcional: Longitud GPS enviada por el cliente
    } = req.body;

    // 1. Validaciones básicas
    if (!order_id || !client_name || !client_phone || !address) {
        return res.status(400).json({
            success: false,
            error: "Faltan campos obligatorios: order_id, client_name, client_phone, address"
        });
    }

    // 2. Determinar localidad de reparto
    const localidad = detectarLocalidad(address);

    const prendasEsperadas = parseInt(expected_items) || 1;

    let calculatedFallbackWindow = "11:00 - 14:00";
    if (localidad) {
        const isB = ["Kennedy", "Engativá", "Fontibón", "Puente Aranda", "Bosa", "Usme", "Ciudad Bolívar", "San Cristóbal", "Rafael Uribe", "Antonio Nariño", "Tunjuelito"].some(loc => localidad.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(loc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
        calculatedFallbackWindow = isB ? "12:00 - 15:00" : "11:00 - 14:00";
    }

    // 3. Payload para Supabase
    const payload = {
        chatbot_order_id: order_id, // Idempotencia reforzada por restricción UNIQUE en la base de datos
        client_name,
        client_phone: client_phone.replace(/\D/g, ''), // Limpiar caracteres no numéricos
        delivery_address: address,
        localidad,
        time_window: time_window || calculatedFallbackWindow, // Ventana por defecto coherente con macro-zona
        amount: parseFloat(amount) || 0.00,
        pay_method: pay_method || 'Efectivo',
        status: 'PENDIENTE',
        qr_code: qr_code || `QR-ORQUIDEAS-${Math.floor(1000 + Math.random() * 9000)}`,
        expected_items: prendasEsperadas,
        collected_items: prendasEsperadas, // Se inicializa igual, el domiciliario lo cambiará si hay diferencia
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        delivery_date: new Date().toISOString().split('T')[0] // Fecha del día actual
    };

    console.log("Recibido despacho del Chatbot:", payload);

    // Si no está inicializado Supabase, simulamos éxito para testing local
    if (!supabase) {
        return res.status(200).json({
            success: true,
            message: "Simulación: Orden procesada correctamente en backend local.",
            data: payload
        });
    }

    try {
        // 4. Inserción segura con idempotencia (upsert usando chatbot_order_id)
        const { data, error } = await supabase
            .from('deliveries')
            .upsert(payload, { onConflict: 'chatbot_order_id' })
            .select();

        if (error) {
            console.error("Error al insertar en Supabase:", error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }

        return res.status(200).json({
            success: true,
            message: "Orden de reparto registrada exitosamente.",
            data: data[0]
        });

    } catch (e) {
        console.error("Excepción en Webhook:", e);
        return res.status(500).json({
            success: false,
            error: "Error interno del servidor."
        });
    }
});

// Arrancar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Webhook de APP DOMICILIARIA escuchando en puerto ${PORT}`);
    console.log(`Endpoint activo: POST http://localhost:${PORT}/api/webhook/order`);
});
