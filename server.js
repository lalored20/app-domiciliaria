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

// Servir archivos estáticos del Frontend (index.html, app.js, styles.css) desactivando la caché en el servidor
app.use(express.static(path.join(__dirname), {
    etag: false,
    lastModified: false,
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
}));

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
const CHATBOT_DB_PATH = 'C:\\Users\\rmend\\Desktop\\Whatsapp Original\\data\\messages_new.db';
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

// Sanear strings de fecha que contengan una estampa de tiempo ISO (ej: 2026-07-15T16:00:00.000Z)
function sanitizeDateString(d) {
    if (!d || typeof d !== 'string') return d;
    if (d.includes('T')) {
        return d.split('T')[0];
    }
    return d;
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

// Validar si un par de coordenadas corresponden a los fallbacks genéricos de localidad
function isFallbackCoordinate(lat, lon) {
    if (!lat || !lon) return false;
    const lVal = parseFloat(lat);
    const oVal = parseFloat(lon);
    const fallbacks = [
        { lat: 4.7011, lon: -74.0330 },
        { lat: 4.7250, lon: -74.0850 },
        { lat: 4.6675, lon: -74.0560 },
        { lat: 4.6432, lon: -74.0903 },
        { lat: 4.6669, lon: -74.0759 },
        { lat: 4.7012, lon: -74.1206 },
        { lat: 4.6738, lon: -74.1442 },
        { lat: 4.6307, lon: -74.1534 },
        { lat: 4.6186, lon: -74.1917 },
        { lat: 4.6205, lon: -74.1105 },
        { lat: 4.4600, lon: -74.1200 },
        { lat: 4.5300, lon: -74.1500 },
        { lat: 4.5600, lon: -74.0800 }
    ];
    return fallbacks.some(f => Math.abs(f.lat - lVal) < 0.0002 && Math.abs(f.lon - oVal) < 0.0002);
}

// Formatear direcciones colombianas para que sean interpretadas correctamente por Nominatim
function formatColombianAddress(addr) {
    if (!addr) return "";
    let clean = addr.trim().replace(/[:.,]$/g, '').trim();
    
    // Si la dirección ya tiene símbolos estructuradores comunes, se deja igual
    if (clean.includes("#") || clean.toLowerCase().includes("no.") || clean.toLowerCase().includes("no ")) {
        return clean;
    }
    
    // Reemplazar espacios innecesarios entre números y letras (ej: "34 A" -> "34A")
    let structured = clean
        .replace(/(\d+)\s+([a-zA-Z])(?!\w)/g, '$1$2')
        .trim();
        
    // Coincidir patrón: Calle/Carrera/etc. + Número + Prefijo opcional + Cruce + Casa/Puerta
    const regex = /^(calle|carrera|cl|cra|av|avenida|transversal|diagonal|dg|tv|cll)\s+(\d+[a-zA-Z]?)\s*(sur|norte|este|oeste)?\s+(\d+[a-zA-Z]?)\s+(\d+)$/i;
    const match = structured.match(regex);
    if (match) {
        const type = match[1];
        const num1 = match[2];
        const suffix = match[3] ? " " + match[3] : "";
        const num2 = match[4];
        const num3 = match[5];
        return `${type} ${num1}${suffix} # ${num2} - ${num3}`;
    }
    
    return clean;
}

// Ejecutar una consulta directa a OpenStreetMap Nominatim
function queryNominatim(query) {
    return new Promise((resolve) => {
        const explicitLoc = detectarLocalidadExplicita(query);
        let cleanQuery = query;
        
        // Remover paréntesis (como indicaciones de barrio o cruce secundario)
        cleanQuery = cleanQuery.replace(/\([^)]*\)/g, '').trim();
        
        // Eliminar apartamentos, casas, bodegas, etc. para la consulta de búsqueda
        cleanQuery = cleanQuery.replace(/(apto|apartamento|casa|piso|bloque|conjunto|interior|torre|barrio|bodega|local|oficina|sector|manzana|mz|etapa).*$/i, '').trim();
        
        // Remover comas, guiones o espacios sobrantes al final
        cleanQuery = cleanQuery.replace(/[,-\s]+$/, '').trim();
        
        // Si se detectó una localidad explícita, y no está ya contenida en la consulta limpia, anexarla
        if (explicitLoc && !cleanQuery.toLowerCase().includes(explicitLoc.toLowerCase())) {
            cleanQuery += `, ${explicitLoc}`;
        }

        // Reemplazar palabras de número en español
        cleanQuery = cleanQuery.replace(/n[uú]mero\s*/ig, ' ');
        cleanQuery = cleanQuery.replace(/nro\.?\s*/ig, ' ');
        cleanQuery = cleanQuery.replace(/\bno\.?\s*(?=\d)/ig, ' ');
        cleanQuery = cleanQuery.replace(/\bno\s+(?=\d)/ig, ' ');
        
        // Normalizar espaciado de letras y bis comunes en Bogotá
        cleanQuery = cleanQuery.replace(/\s+A\s+/ig, 'a ');
        cleanQuery = cleanQuery.replace(/\s+B\s+/ig, 'b ');
        cleanQuery = cleanQuery.replace(/\s+C\s+/ig, 'c ');
        cleanQuery = cleanQuery.replace(/\s+D\s+/ig, 'd ');
        cleanQuery = cleanQuery.replace(/\s+F\s+/ig, 'f ');
        cleanQuery = cleanQuery.replace(/\s+Bis\s+/ig, 'bis ');
        
        cleanQuery = cleanQuery.trim();
        
        if (!cleanQuery.toLowerCase().includes("bogota")) {
            cleanQuery += ", Bogota, Colombia";
        }
        
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&addressdetails=1&limit=1`;
        
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

// Geocodificar dirección usando OpenStreetMap Nominatim con estrategia de reintentos en cascada (Fallbacks)
async function geocodeAddress(address) {
    const formatted = formatColombianAddress(address);
    console.log(`📡 [Geocoder] Iniciando geocodificación Nivel 1: "${formatted}"`);
    
    // Nivel 1: Intento con la dirección completa formateada
    let result = await queryNominatim(formatted);
    if (result) return result;
    
    // Nivel 2: Si tiene número de puerta, intentar sin él (buscar la esquina/cruce)
    // Ejemplo: "Calle 34A sur # 97F - 12" -> "Calle 34A sur # 97F"
    if (formatted.includes("-")) {
        const parts = formatted.split("-");
        const queryWithoutDoor = parts[0].replace(/#\s*$/, '').trim();
        console.log(`📡 [Geocoder] Re-intentando Nivel 2 (Sin número de puerta): "${queryWithoutDoor}"`);
        result = await queryNominatim(queryWithoutDoor);
        if (result) return result;
    }
    
    // Nivel 3: Si tiene nomenclatura con "#", intentar solo con la calle principal
    // Ejemplo: "Calle 34A sur # 97F" -> "Calle 34A sur"
    if (formatted.includes("#")) {
        const parts = formatted.split("#");
        const queryStreetOnly = parts[0].trim();
        console.log(`📡 [Geocoder] Re-intentando Nivel 3 (Solo calle principal): "${queryStreetOnly}"`);
        result = await queryNominatim(queryStreetOnly);
        if (result) return result;
    }
    
    return null;
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
                items_comments TEXT,
                delivery_date TEXT,
                updated_at INTEGER
            )`);

            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN resolved_address TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN resolved_localidad TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN items_comments TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN veracity_name TEXT`, (err) => {});
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN veracity_address TEXT`, (err) => {});
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN veracity_pickup_date TEXT`, (err) => {});
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN veracity_time_window TEXT`, (err) => {});
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN veracity_total_value REAL`, (err) => {});
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN delivery_type TEXT DEFAULT 'RECOGIDA'`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN return_delivery_date TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN return_time_window TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN return_status TEXT DEFAULT 'PENDIENTE'`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN return_evidence_photo TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN return_signature_drawn INTEGER DEFAULT 0`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`ALTER TABLE delivery_metadata ADD COLUMN return_items_comments TEXT`, (err) => {
                // Silenciar error si la columna ya existe
            });
            appDb.run(`CREATE TABLE IF NOT EXISTS client_facade (
                client_phone TEXT PRIMARY KEY,
                client_name TEXT,
                address TEXT,
                facade_photo TEXT,
                latitude REAL,
                longitude REAL,
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

            // Limpiar registros fallidos o fallbacks antiguos en la base de datos local para forzar su re-geocodificación
            appDb.run(`
                DELETE FROM delivery_metadata 
                WHERE latitude IN (4.7011, 4.7250, 4.6675, 4.6432, 4.6669, 4.7012, 4.6738, 4.6307, 4.6186, 4.6205, 4.4600, 4.5300, 4.5600)
                  AND (resolved_address IS NULL OR resolved_address != 'Recogida WhatsApp')
            `, [], (err) => {
                if (err) {
                    console.error("❌ Error limpiando fallbacks de geocodificación:", err.message);
                } else {
                    console.log("🧹 Limpiados fallbacks de geocodificación previos en la base de datos para forzar re-geocodificación.");
                }
            });
        });
    }
});

function detectarLocalidadExplicita(direccion) {
    if (!direccion) return null;
    const dirUpper = direccion.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (dirUpper.includes("USAQU") || dirUpper.includes("CEDRITOS") || dirUpper.includes("SANTA BARBARA") || dirUpper.includes("CANTALEJO")) {
        return "Usaquén";
    }
    if (dirUpper.includes("SUBA") || dirUpper.includes("NIZA") || dirUpper.includes("ALHAMBRA") || dirUpper.includes("COLINA") || dirUpper.includes("PORTALES")) {
        return "Suba";
    }
    if (dirUpper.includes("CHAPIN") || dirUpper.includes("CHICO") || dirUpper.includes("ROSALES") || dirUpper.includes("RETIRO")) {
        return "Chapinero";
    }
    if (dirUpper.includes("TEUSAQ") || dirUpper.includes("SALITRE") || dirUpper.includes("GALERIAS") || dirUpper.includes("QUINTA PAREDES")) {
        return "Teusaquillo";
    }
    if (dirUpper.includes("BARRIOS U") || dirUpper.includes("CASTELLANA") || dirUpper.includes("METROPOLIS") || dirUpper.includes("POLO")) {
        return "Barrios Unidos";
    }
    if (dirUpper.includes("ENGATIV") || dirUpper.includes("BOCHICA") || dirUpper.includes("ALAMOS") || dirUpper.includes("MINUTO DE DIOS")) {
        return "Engativá";
    }
    if (dirUpper.includes("FONTIB") || dirUpper.includes("MODELIA") || dirUpper.includes("HAYUELOS") || dirUpper.includes("ZONA FRANCA")) {
        return "Fontibón";
    }
    if (dirUpper.includes("KENNEDY") || dirUpper.includes("CASTILLA") || dirUpper.includes("AMERICAS") || dirUpper.includes("TINTAL") || dirUpper.includes("TIERRA BUENA") || dirUpper.includes("TIERRABUENA") || dirUpper.includes("PATIO BONITO") || dirUpper.includes("CANDALAIMA")) {
        return "Kennedy";
    }
    if (dirUpper.includes("BOSA") || dirUpper.includes("RECREO")) {
        return "Bosa";
    }
    if (dirUpper.includes("PUENTE A") || dirUpper.includes("SALAZAR GOMEZ") || dirUpper.includes("MUZU")) {
        return "Puente Aranda";
    }
    if (dirUpper.includes("USME") || dirUpper.includes("SAN ANTONIO ELIAS") || dirUpper.includes("SAN ANTONIO") || dirUpper.includes("AVISUR") || dirUpper.includes("VIRREY")) {
        return "Usme";
    }
    if (dirUpper.includes("CIUDAD B") || dirUpper.includes("MADRIGAL")) {
        return "Ciudad Bolívar";
    }
    if (dirUpper.includes("SAN CRIST") || dirUpper.includes("20 DE JULIO")) {
        return "San Cristóbal";
    }
    if (dirUpper.includes("MARTIRES")) {
        return "Los Mártires";
    }
    if (dirUpper.includes("SANTA FE") || dirUpper.includes("SANTAFE")) {
        return "Santa Fe";
    }
    if (dirUpper.includes("TUNJUELITO")) {
        return "Tunjuelito";
    }
    if (dirUpper.includes("ANTONIO NARINO")) {
        return "Antonio Nariño";
    }
    if (dirUpper.includes("CANDELARIA")) {
        return "La Candelaria";
    }
    if (dirUpper.includes("RAFAEL URIBE")) {
        return "Rafael Uribe Uribe";
    }
    return null;
}

// Clasificación básica de Localidades
function detectarLocalidad(direccion, lat, lon) {
    if (direccion) {
        const dirUpper = direccion.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
        if (dirUpper.includes("MARTIRES")) {
            return "Los Mártires";
        }
        if (dirUpper.includes("SANTA FE") || dirUpper.includes("SANTAFE")) {
            return "Santa Fe";
        }
        if (dirUpper.includes("TUNJUELITO")) {
            return "Tunjuelito";
        }
        if (dirUpper.includes("ANTONIO NARINO")) {
            return "Antonio Nariño";
        }
        if (dirUpper.includes("CANDELARIA")) {
            return "La Candelaria";
        }
        if (dirUpper.includes("RAFAEL URIBE")) {
            return "Rafael Uribe Uribe";
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

// Comparar si dos direcciones de texto corresponden al mismo lugar físico
function esDireccionSimilar(addr1, addr2) {
    if (!addr1 || !addr2) return false;
    
    const normalize = (str) => {
        return str.toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remover acentos
            .replace(/[^a-z0-9]/g, " ")
            .replace(/\s+/g, " ").trim();
    };
    
    const n1 = normalize(addr1);
    const n2 = normalize(addr2);
    
    // Si son exactamente iguales tras normalizar
    if (n1 === n2) return true;
    
    // Función auxiliar para detectar si una dirección es una plantilla genérica
    const esGenerica = (str) => {
        const s = str.toLowerCase();
        return s.includes("confirmar") || s.includes("recogida") || s.includes("exacta recibida") || 
               s.includes("ubicacion recibida") || s.includes("whatsapp") || s.length < 12;
    };
    
    const gen1 = esGenerica(addr1);
    const gen2 = esGenerica(addr2);
    
    // Si una es genérica y la otra es específica, no son similares
    if (gen1 !== gen2) return false;
    
    // Si ambas son genéricas, las permitimos asociar
    if (gen1 && gen2) return true;
    
    // Si ambas son específicas, comparamos números clave
    const getNumbers = (str) => {
        const matches = str.match(/\b\d+\b/g);
        return matches ? matches : [];
    };
    
    const num1 = getNumbers(n1);
    const num2 = getNumbers(n2);
    
    // Si una tiene números de nomenclatura y la otra no, no son similares
    if ((num1.length > 0) !== (num2.length > 0)) return false;
    
    // Comparar primer y segundo número principal de la dirección (ej: Calle 98 # 76)
    if (num1.length > 0 && num2.length > 0) {
        if (num1[0] !== num2[0]) return false;
        if (num1.length > 1 && num2.length > 1 && num1[1] !== num2[1]) return false;
    }
    
    // Comparar la localidad de forma textual
    const loc1 = detectarLocalidad(addr1);
    const loc2 = detectarLocalidad(addr2);
    if (loc1 && loc2 && loc1 !== loc2) {
        return false;
    }
    
    return true;
}

// Analizar la transcripción del chat para extraer detalles del resumen del pedido de forma estructurada
function parseResumenFromChat(transcription) {
    const result = {};
    if (!transcription) return result;
    
    const lines = transcription.split('\n');
    let inSummary = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lower = line.toLowerCase();
        
        // Detectar inicio de bloque de resumen
        if (lower.includes("resumen del pedido") || lower.includes("resumen de tu pedido") || lower.includes("detalles del pedido")) {
            inSummary = true;
            continue;
        }
        
        if (inSummary) {
            // Un punto de viñeta como: • *Cliente*: Carlos Arboleda o • Cliente: Carlos Arboleda
            const match = line.match(/^\s*[-•*+]\s*\*?([A-Za-zñáéíóúüñ\s]+)\*?\s*:\s*(.+)$/i);
            if (match) {
                const key = match[1].trim().toLowerCase();
                let val = match[2].replace(/\*+/g, '').trim(); // Remover asteriscos de negrita
                
                if (key.includes("cliente")) {
                    result.clientName = val;
                } else if (key.includes("direcci")) {
                    result.clientAddress = val;
                } else if (key.includes("recogida")) {
                    result.pickupText = val;
                } else if (key.includes("total")) {
                    result.totalText = val;
                } else if (key.includes("servicio")) {
                    result.serviceText = val;
                } else if (key.includes("entrega")) {
                    result.deliveryText = val;
                }
            }
        }
    }
    
    return result;
}

// Extraer dinámicamente fecha y hora de la transcripción del chat si están ausentes de forma estructurada
function extraerFechaYHoraDelChat(transcription, createdEpoch) {
    const result = { date: null, timeWindow: null };
    if (!transcription) return result;
    
    // Buscar si hay un resumen del pedido estructurado primero
    const parsed = parseResumenFromChat(transcription);
    const sourceText = parsed.pickupText || transcription;
    
    // Regex de fecha mejorado para soportar con/sin prefijo "Recogida"
    const dateMatch = sourceText.match(/(?:Recogida[^*:\n\r]*[*:]?\s*)?([^0-9\n\r]*?)\s+(\d+)\s+de\s+([A-Za-záéíóúñ]+)/i);
    if (dateMatch) {
        const day = parseInt(dateMatch[2]);
        const monthStr = dateMatch[3].toLowerCase();
        
        const months = {
            "enero": "01", "feb": "02", "febrero": "02", "mar": "03", "marzo": "03", 
            "abr": "04", "abril": "04", "may": "05", "mayo": "05", "jun": "06", "junio": "06", 
            "jul": "07", "julio": "07", "ago": "08", "agosto": "08", "sep": "09", "septiembre": "09", 
            "oct": "10", "octubre": "10", "nov": "11", "noviembre": "11", "dic": "12", "diciembre": "12"
        };
        
        const month = months[monthStr] || "07";
        const year = new Date(createdEpoch * 1000).getFullYear() || 2026;
        
        const formattedDay = day < 10 ? `0${day}` : day;
        result.date = `${year}-${month}-${formattedDay}`;
    }
    
    // Regex de rango de hora robusto
    const rangeMatch = sourceText.match(/(?:entre\s+(?:las\s+)?)?(\d+(?::\d+)?\s*(?:am|pm|am\.|pm\.)?)\s*(?:y\s*(?:las\s+)?|a\s+)(\d+(?::\d+)?\s*(?:am|pm|am\.|pm\.)?)/i);
    if (rangeMatch) {
        let startText = rangeMatch[1].replace(/[\s.]+/g, '').toLowerCase();
        
        if (!startText.includes(":")) {
            startText = startText.replace(/^(\d+)/, '$1:00');
        }
        
        // Strip leading zero for matching consistency (e.g. 08:00am -> 8:00am)
        startText = startText.replace(/^0/, '');
        
        if (startText.startsWith("8:00") && startText.includes("am")) {
            result.timeWindow = "08:00 - 11:00";
        } else if (startText.startsWith("11:00") && startText.includes("am")) {
            result.timeWindow = "11:00 - 14:00";
        } else if (startText.startsWith("9:00") && startText.includes("am")) {
            result.timeWindow = "09:00 - 12:00";
        } else if (startText.startsWith("12:00") && (startText.includes("pm") || startText.includes("12:00"))) {
            result.timeWindow = "12:00 - 15:00";
        } else if (startText.startsWith("8:00") && !startText.includes("pm") && !startText.includes("am")) {
            result.timeWindow = "08:00 - 11:00";
        } else if (startText.startsWith("11:00") && !startText.includes("pm") && !startText.includes("am")) {
            result.timeWindow = "11:00 - 14:00";
        }
    }
    
    return result;
}

// Calcula de forma inteligente la fecha de entrega de prendas limpias (retorno)
// basándose en el calendario semanal de rutas de la Macro-Zona y la transcripción del chat.
function calcularFechaRetornoProgramada(recogidaDateStr, localidad, transcription) {
    const defaultTurnaroundDays = 5;
    
    // Grupo A: Norte y Centro (Lunes=1, Miércoles=3, Viernes=5)
    // Grupo B: Occidente y Sur (Martes=2, Jueves=4, Sábado=6)
    const grupoA = ["Usaquén", "Suba", "Chapinero", "Teusaquillo", "Barrios Unidos", "Los Mártires", "Mártires", "Santa Fe", "La Candelaria"];
    const grupoB = ["Kennedy", "Engativá", "Fontibón", "Puente Aranda", "Bosa", "Usme", "Ciudad Bolívar", "San Cristóbal", "Rafael Uribe", "Antonio Nariño", "Tunjuelito"];
    
    const isGrupoB = grupoB.some(loc => localidad && localidad.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(loc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
    const validDays = isGrupoB ? [2, 4, 6] : [1, 3, 5];
    const defaultTimeWindow = isGrupoB ? "12:00 - 15:00" : "11:00 - 14:00";
    
    // 1. Intentar buscar un día de la semana específico en la transcripción
    let targetDayOfWeek = null;
    if (transcription) {
        const text = transcription.toLowerCase();
        if (/entregar.*?lunes|entrega.*?lunes|devolver.*?lunes|retorno.*?lunes/.test(text)) targetDayOfWeek = 1;
        else if (/entregar.*?martes|entrega.*?martes|devolver.*?martes|retorno.*?martes/.test(text)) targetDayOfWeek = 2;
        else if (/entregar.*?miércoles|entrega.*?miercoles|devolver.*?miércoles|retorno.*?miércoles/.test(text)) targetDayOfWeek = 3;
        else if (/entregar.*?jueves|entrega.*?jueves|devolver.*?jueves|retorno.*?jueves/.test(text)) targetDayOfWeek = 4;
        else if (/entregar.*?viernes|entrega.*?viernes|devolver.*?viernes|retorno.*?viernes/.test(text)) targetDayOfWeek = 5;
        else if (/entregar.*?sábado|entrega.*?sabado|devolver.*?sábado|retorno.*?sábado/.test(text)) targetDayOfWeek = 6;
    }
    
    // Parsear fecha base de recogida
    let baseDate = new Date();
    if (recogidaDateStr) {
        const parts = recogidaDateStr.split('-');
        if (parts.length === 3) {
            const y = parseInt(parts[0]);
            const m = parseInt(parts[1]) - 1;
            const d = parseInt(parts[2]);
            if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                baseDate = new Date(y, m, d, 12, 0, 0);
            }
        }
    }
    
    let returnDate = new Date(baseDate.getTime());
    if (targetDayOfWeek !== null) {
        // Buscar el siguiente día de la semana después de la recogida (mínimo 3 días de procesamiento)
        returnDate.setDate(returnDate.getDate() + 3);
        for (let i = 0; i < 7; i++) {
            if (returnDate.getDay() === targetDayOfWeek) {
                break;
            }
            returnDate.setDate(returnDate.getDate() + 1);
        }
    } else {
        // Por defecto: Sumar 5 días
        returnDate.setDate(returnDate.getDate() + defaultTurnaroundDays);
        // Ajustar al día de ruta válido más cercano para su macro-zona
        for (let i = 0; i < 7; i++) {
            if (validDays.includes(returnDate.getDay())) {
                break;
            }
            returnDate.setDate(returnDate.getDate() + 1);
        }
    }
    
    const yyyy = returnDate.getFullYear();
    const mm = String(returnDate.getMonth() + 1).padStart(2, '0');
    const dd = String(returnDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    
    let timeWindow = defaultTimeWindow;
    if (transcription) {
        const text = transcription.toLowerCase();
        if (/tarde|14:00|16:00|2:\s*00|4:\s*00/.test(text)) {
            timeWindow = isGrupoB ? "12:00 - 15:00" : "11:00 - 14:00";
        } else if (/mañana|temprano|8:\s*00|9:\s*00|10:\s*00|11:\s*00/.test(text)) {
            timeWindow = isGrupoB ? "09:00 - 12:00" : "08:00 - 11:00";
        }
    }
    
    return { date: dateStr, timeWindow };
}


// Analizar el texto de servicios del resumen de chat para extraer prendas e items
function parseItemsFromServiceText(serviceText) {
    const items = [];
    if (!serviceText) return items;
    
    // Separar por "+" o "y" o comas
    const parts = serviceText.split(/\s*[\+\,]\s*|\s+y\s+/i);
    
    parts.forEach((part, index) => {
        const text = part.replace(/^\s*[-•*+]\s*/, '').trim();
        if (!text) return;
        
        let quantity = 1;
        let type = text;
        let price = 0;
        
        // Detectar si empieza con cantidad, ej: "2 Chaquetas Gruesas" o "2x Chaquetas" o "2 x Chaquetas"
        const qtyMatch = text.match(/^(\d+)\s*(?:x|\s)\s*(.+)$/i);
        if (qtyMatch) {
            quantity = parseInt(qtyMatch[1]);
            type = qtyMatch[2].trim();
        }
        
        // Normalizar tipos comunes de planes y prendas
        const lowerType = type.toLowerCase();
        if (lowerType.includes("plan básico lavaseco") || lowerType.includes("plan basico lavaseco")) {
            type = "Plan Básico Lavaseco (1 Maleta)";
            price = 119900;
        } else if (lowerType.includes("plan pro lavaseco")) {
            type = "Plan Pro Lavaseco (1 Maleta Grande)";
            price = 219900;
        } else if (lowerType.includes("plan básico zapatos") || lowerType.includes("plan basico zapatos")) {
            type = "Plan Básico Zapatos (2 Pares)";
            price = 54900;
        } else if (lowerType.includes("plan pro zapatos")) {
            type = "Plan Pro Zapatos (3 Pares)";
            price = 77900;
        } else if (lowerType.includes("plan premium zapatos")) {
            type = "Plan Premium Zapatos (4 Pares)";
            price = 99900;
        } else if (lowerType.includes("chaqueta gruesa")) {
            type = "Chaqueta Gruesa";
            price = 17000;
        } else if (lowerType.includes("chaqueta sencilla")) {
            type = "Chaqueta Sencilla";
            price = 15000;
        } else if (lowerType.includes("camisa")) {
            type = "Camisa";
            price = 10000;
        } else if (lowerType.includes("pantal")) {
            type = "Pantalón";
            price = 10000;
        } else if (lowerType.includes("blusa")) {
            type = "Blusa";
            price = 10000;
        } else if (lowerType.includes("vestido")) {
            type = "Vestido";
            price = 20000;
        } else if (lowerType.includes("cobija sencilla")) {
            type = "Cobija Sencilla";
            price = 29900;
        } else if (lowerType.includes("cobija doble")) {
            type = "Cobija Doble";
            price = 49900;
        } else if (lowerType.includes("cobija king")) {
            type = "Cobija King";
            price = 54900;
        }
        
        items.push({
            id: `parsed-${index}`,
            quantity: quantity,
            type: type,
            price: price
        });
    });
    
    return items;
}

// Calcular la cantidad real de prendas físicas/bultos representadas por los ítems
function calcularPrendasFisicasEsperadas(items) {
    let total = 0;
    if (!items || items.length === 0) return 0;
    
    items.forEach(item => {
        const lowerType = item.type.toLowerCase();
        let multiplier = 1;
        
        if (lowerType.includes("básico zapatos") || lowerType.includes("basico zapatos")) {
            multiplier = 2; // 2 pares
        } else if (lowerType.includes("pro zapatos")) {
            multiplier = 3; // 3 pares
        } else if (lowerType.includes("premium zapatos")) {
            multiplier = 4; // 4 pares
        }
        
        total += item.quantity * multiplier;
    });
    
    return total;
}


// Expandir y normalizar ítems de la base de datos o resumen del chat
function expandAndNormalizeItems(rawItems, chatServiceText) {
    let itemsToProcess = [];
    
    // Si no hay items en la base de datos, usamos el texto de servicios del chat
    if ((!rawItems || rawItems.length === 0) && chatServiceText) {
        return parseItemsFromServiceText(chatServiceText);
    }
    
    // Si hay items, los procesamos y expandimos si contienen "+" o "y"
    (rawItems || []).forEach(item => {
        const typeStr = item.type;
        const lowerType = typeStr.toLowerCase();
        
        // Si el tipo es compuesto (ej. contiene "+" o "y" con planes), lo parseamos
        if (typeStr.includes("+") || /\s+y\s+/i.test(typeStr) || (lowerType.includes("plan") && lowerType.includes("zapatos") && lowerType.includes("lavaseco"))) {
            const parsed = parseItemsFromServiceText(typeStr);
            if (parsed.length > 0) {
                // Preservar precio o prorratear si es posible, o usar precios de lista
                parsed.forEach(p => {
                    itemsToProcess.push({
                        id: item.id + "-" + p.id,
                        quantity: p.quantity * item.quantity,
                        type: p.type,
                        price: p.price || 0
                    });
                });
                return;
            }
        }
        
        // Si no es compuesto, lo normalizamos
        let normalizedType = item.type;
        let price = item.price || 0;
        
        if (lowerType.includes("plan básico lavaseco") || lowerType.includes("plan basico lavaseco")) {
            normalizedType = "Plan Básico Lavaseco (1 Maleta)";
            price = price || 119900;
        } else if (lowerType.includes("plan pro lavaseco")) {
            normalizedType = "Plan Pro Lavaseco (1 Maleta Grande)";
            price = price || 219900;
        } else if (lowerType.includes("plan básico zapatos") || lowerType.includes("plan basico zapatos")) {
            normalizedType = "Plan Básico Zapatos (2 Pares)";
            price = price || 54900;
        } else if (lowerType.includes("plan pro zapatos")) {
            normalizedType = "Plan Pro Zapatos (3 Pares)";
            price = price || 77900;
        } else if (lowerType.includes("plan premium zapatos")) {
            normalizedType = "Plan Premium Zapatos (4 Pares)";
            price = price || 99900;
        }
        
        itemsToProcess.push({
            id: item.id,
            quantity: item.quantity,
            type: normalizedType,
            price: price
        });
    });
    
    return itemsToProcess;
}


// Helper to get merged deliveries from SQLite databases
function getMergedDeliveries() {
    return new Promise((resolve, reject) => {
        // Consultar los ítems detallados de los pedidos en messages.db
        chatbotDb.all(`SELECT id, orderId, quantity, type, price FROM local_order_items`, [], (err, itemRows) => {
            if (err) {
                return reject(err);
            }
            
            const itemsMap = {};
            if (itemRows) {
                itemRows.forEach(item => {
                    if (!itemsMap[item.orderId]) {
                        itemsMap[item.orderId] = [];
                    }
                    itemsMap[item.orderId].push({
                        id: item.id,
                        quantity: item.quantity,
                        type: item.type,
                        price: item.price
                    });
                });
            }

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
                WHERE o.id NOT LIKE 'test_%' AND o.id NOT LIKE 'web_%'
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
                    
                    // Construir mapa de historial por número de teléfono
                    // Guardará los metadatos más completos y la dirección asociada de cada cliente
                    const phoneHistoryMap = {};
                    chatbotOrders.forEach(o => {
                        const meta = metadataMap[o.id];
                        if (meta && (meta.evidence_photo || (meta.latitude && meta.longitude))) {
                            const phoneKey = o.clientPhone.replace(/\D/g, '');
                            const existing = phoneHistoryMap[phoneKey];
                            if (!existing || (meta.evidence_photo && !existing.meta.evidence_photo)) {
                                phoneHistoryMap[phoneKey] = {
                                    meta: meta,
                                    address: o.clientAddress
                                };
                            }
                        }
                    });
                    
                    const merged = [];
                    chatbotOrders.forEach(o => {
                        const meta = metadataMap[o.id] || {};
                        const phoneKey = o.clientPhone.replace(/\D/g, '');
                        const histData = phoneHistoryMap[phoneKey] || {};
                        
                        // Validar si la dirección de la orden actual es similar a la dirección histórica
                        const isSimilar = histData.meta && esDireccionSimilar(o.clientAddress, histData.address);
                        const historicalMeta = isSimilar ? histData.meta : {};
                        
                        // Overrides veraces basados en el resumen del chat
                        const veracityName = meta.veracity_name || historicalMeta.veracity_name || null;
                        const veracityAddress = meta.veracity_address || historicalMeta.veracity_address || null;
                        const veracityPickupDate = meta.veracity_pickup_date || historicalMeta.veracity_pickup_date || null;
                        const veracityTimeWindow = meta.veracity_time_window || historicalMeta.veracity_time_window || null;
                        const veracityTotal = meta.veracity_total_value !== undefined && meta.veracity_total_value !== null ? meta.veracity_total_value : (historicalMeta.veracity_total_value || null);
                        
                        const finalClientName = veracityName || o.clientName;
                        const finalOriginalAddress = veracityAddress || o.clientAddress;

                        // Convert unix epoch to YYYY-MM-DD in Colombia timezone
                        const dateStr = epochToColombiaDateString(o.created_at);
                        
                        // Heredar coordenadas, dirección resuelta e imágenes de fachada si están vacías en la orden actual
                        const finalLatitude = meta.latitude || historicalMeta.latitude || null;
                        const finalLongitude = meta.longitude || historicalMeta.longitude || null;
                        const finalResolvedAddress = meta.resolved_address || historicalMeta.resolved_address || finalOriginalAddress;
                        const finalResolvedLocalidad = meta.resolved_localidad || historicalMeta.resolved_localidad || detectarLocalidad(finalResolvedAddress, finalLatitude, finalLongitude);
                        const finalEvidencePhoto = meta.evidence_photo || historicalMeta.evidence_photo || null;
                        
                        // Normalizar y expandir ítems (tanto los de la BD como los extraídos del chat)
                        const parsedChatRes = parseResumenFromChat(o.chatTranscription);
                        const orderItems = expandAndNormalizeItems(itemsMap[o.id], parsedChatRes.serviceText);
                        
                        const calculatedExpectedUnits = calcularPrendasFisicasEsperadas(orderItems);
                        const expectedItems = (meta.expected_items !== undefined && meta.expected_items !== null) ? meta.expected_items : (calculatedExpectedUnits || o.items_count || 1);
                        
                        // Extraer fecha y hora por IA parsing del chat si no están estructuradas
                        let parsedDate = null;
                        let parsedTimeWindow = null;
                        if (!meta.delivery_date && !o.scheduledDate && o.chatTranscription) {
                            const parsed = extraerFechaYHoraDelChat(o.chatTranscription, o.created_at);
                            parsedDate = parsed.date;
                            parsedTimeWindow = parsed.timeWindow;
                        }

                        const isGrupoB = ["Kennedy", "Engativá", "Fontibón", "Puente Aranda", "Bosa", "Usme", "Ciudad Bolívar", "San Cristóbal", "Rafael Uribe", "Antonio Nariño", "Tunjuelito"].some(loc => finalResolvedLocalidad && finalResolvedLocalidad.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(loc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
                        const defaultFallbackWindow = isGrupoB ? "12:00 - 15:00" : "11:00 - 14:00";

                        const finalOrderDate = sanitizeDateString(veracityPickupDate || meta.delivery_date || o.scheduledDate || parsedDate || dateStr);
                        const finalTimeWindow = veracityTimeWindow || meta.time_window || parsedTimeWindow || defaultFallbackWindow;
                        const finalAmount = veracityTotal !== null ? veracityTotal : o.totalValue;

                        // 1. Agregar la recogida principal
                        merged.push({
                            id: o.id,
                            order_id: o.id,
                            chatbot_order_id: o.id,
                            ticket_number: o.ticketNumber,
                            client_name: finalClientName,
                            client_phone: phoneKey,
                            address: finalResolvedAddress,
                            raw_address: finalOriginalAddress,
                            localidad: finalResolvedLocalidad,
                            time_window: finalTimeWindow,
                            amount: finalAmount,
                            pay_method: o.paymentStatus === 'PAGADO' ? 'Pagado (Online)' : 'Efectivo',
                            status: o.status || 'PENDIENTE',
                            qr_code: `QR-ORQUIDEAS-${o.ticketNumber || Math.floor(1000 + Math.random() * 9000)}`,
                            expected_items: expectedItems,
                            collected_items: (meta.collected_items !== undefined && meta.collected_items !== null) ? meta.collected_items : expectedItems,
                            evidence_photo: finalEvidencePhoto,
                            signature_drawn: meta.signature_drawn === 1,
                            order_date: finalOrderDate,
                            sync_pending: false,
                            latitude: finalLatitude,
                            longitude: finalLongitude,
                            chat_transcription: o.chatTranscription || null,
                            items: orderItems,
                            items_comments: meta.items_comments || null,
                            delivery_type: meta.delivery_type || "RECOGIDA",
                            return_delivery_date: meta.return_delivery_date || null,
                            return_time_window: meta.return_time_window || null
                        });

                        // 2. Agregar la entrega de retorno si está programada, la principal es una RECOGIDA y ya fue confirmada (ENTREGADO)
                        if (meta.return_delivery_date && (meta.delivery_type || "RECOGIDA") === "RECOGIDA" && o.status === "ENTREGADO") {
                            merged.push({
                                id: o.id + "_return",
                                order_id: o.id,
                                chatbot_order_id: o.id,
                                ticket_number: o.ticketNumber,
                                client_name: finalClientName,
                                client_phone: phoneKey,
                                address: finalResolvedAddress,
                                raw_address: finalOriginalAddress,
                                localidad: finalResolvedLocalidad,
                                time_window: meta.return_time_window || "12:00 - 15:00",
                                amount: 0,
                                pay_method: o.paymentStatus === 'PAGADO' ? 'Pagado (Online)' : 'Efectivo',
                                status: meta.return_status || "PENDIENTE",
                                qr_code: `QR-ORQUIDEAS-${o.ticketNumber || Math.floor(1000 + Math.random() * 9000)}`,
                                expected_items: (meta.collected_items !== undefined && meta.collected_items !== null) ? meta.collected_items : expectedItems,
                                collected_items: (meta.collected_items !== undefined && meta.collected_items !== null) ? meta.collected_items : expectedItems,
                                evidence_photo: meta.return_evidence_photo || null,
                                signature_drawn: meta.return_signature_drawn === 1,
                                order_date: meta.return_delivery_date,
                                sync_pending: false,
                                latitude: finalLatitude,
                                longitude: finalLongitude,
                                chat_transcription: o.chatTranscription || null,
                                items: orderItems,
                                items_comments: meta.return_items_comments || null,
                                delivery_type: "ENTREGA",
                                return_delivery_date: meta.return_delivery_date,
                                return_time_window: meta.return_time_window
                            });
                        }
                    });
                    
                    // Simular pedidos precisos para mañana (2026-07-01) para pruebas de ruta
                    const tomorrowDate = "2026-07-01";
                    const mockTomorrowDeliveries = [
                        {
                            id: "mock-tomorrow-1",
                            chatbot_order_id: "mock-tomorrow-1",
                            ticket_number: "701",
                            client_name: "Camila Restrepo",
                            client_phone: "573001234567",
                            address: "Calle 93 # 12 - 54, Bogotá",
                            raw_address: "Calle 93 # 12 - 54",
                            localidad: "Usaquén",
                            time_window: "08:00 - 10:00",
                            amount: 45000,
                            pay_method: "Efectivo",
                            status: "PENDIENTE",
                            qr_code: "QR-ORQUIDEAS-701",
                            expected_items: 3,
                            collected_items: 3,
                            evidence_photo: null,
                            signature_drawn: false,
                            order_date: tomorrowDate,
                            sync_pending: false,
                            latitude: 4.6788,
                            longitude: -74.0475,
                            chat_transcription: "[Chat con Camila Restrepo]\nCliente: Hola, me gustaría programar un lavado de prendas para mañana.\nChatbot: Claro, ¿qué prendas tienes?\nCliente: Son 2 sacos y 1 pantalón.\nChatbot: Listo, agendado de 8:00 a 10:00.",
                            items: [
                                { type: "Sacos", quantity: 2, price: 15000 },
                                { type: "Pantalón", quantity: 1, price: 15000 }
                            ]
                        },
                        {
                            id: "mock-tomorrow-2",
                            chatbot_order_id: "mock-tomorrow-2",
                            ticket_number: "901",
                            client_name: "Diego García",
                            client_phone: "573178272969",
                            address: "Carrera 15 # 88 - 21, Bogotá",
                            raw_address: "Carrera 15 # 88 - 21",
                            localidad: "Chapinero",
                            time_window: "11:00 - 14:00",
                            amount: 65000,
                            pay_method: "Pagado (Online)",
                            status: "PENDIENTE",
                            qr_code: "QR-ORQUIDEAS-901",
                            expected_items: 2,
                            collected_items: 2,
                            evidence_photo: null,
                            signature_drawn: false,
                            order_date: tomorrowDate,
                            sync_pending: false,
                            latitude: 4.6732,
                            longitude: -74.0531,
                            chat_transcription: "[Chat con Diego García]\nCliente: Hola, quiero mandar a lavar unas cosas.\nChatbot: Claro, ¿qué prendas?\nCliente: 1 gabardina y 1 vestido.\nChatbot: Perfecto, programado para mañana en Carrera 15 # 88 - 21 de 11:00 AM a 2:00 PM.",
                            items: [
                                { type: "Gabardina", quantity: 1, price: 35000 },
                                { type: "Vestido", quantity: 1, price: 30000 }
                            ]
                        },
                        {
                            id: "mock-tomorrow-3",
                            chatbot_order_id: "mock-tomorrow-3",
                            ticket_number: "902",
                            client_name: "Diego García",
                            client_phone: "573178272969",
                            address: "Carrera 15 # 88 - 21, Bogotá",
                            raw_address: "Carrera 15 # 88 - 21",
                            localidad: "Chapinero",
                            time_window: "11:00 - 14:00",
                            amount: 45000,
                            pay_method: "Pagado (Online)",
                            status: "PENDIENTE",
                            qr_code: "QR-ORQUIDEAS-902",
                            expected_items: 1,
                            collected_items: 1,
                            evidence_photo: null,
                            signature_drawn: false,
                            order_date: tomorrowDate,
                            sync_pending: false,
                            latitude: 4.6732,
                            longitude: -74.0531,
                            chat_transcription: "[Chat con Diego García]\nCliente: Oye, olvide agregar un edredón doble al pedido.\nChatbot: Claro, lo agrego como un servicio separado para mañana mismo en la misma entrega.\nCliente: Gracias.",
                            items: [
                                { type: "Edredón doble", quantity: 1, price: 45000 }
                            ]
                        },
                        {
                            id: "mock-tomorrow-4",
                            chatbot_order_id: "mock-tomorrow-4",
                            ticket_number: "903",
                            client_name: "Diego García",
                            client_phone: "573178272969",
                            address: "Calle 116 # 19 - 45, Bogotá",
                            raw_address: "Calle 116 # 19 - 45",
                            localidad: "Usaquén",
                            time_window: "14:00 - 16:00",
                            amount: 35000,
                            pay_method: "Efectivo",
                            status: "PENDIENTE",
                            qr_code: "QR-ORQUIDEAS-903",
                            expected_items: 1,
                            collected_items: 1,
                            evidence_photo: null,
                            signature_drawn: false,
                            order_date: tomorrowDate,
                            sync_pending: false,
                            latitude: 4.7001,
                            longitude: -74.0425,
                            chat_transcription: "[Chat con Diego García]\nCliente: Buenas, tengo otra prenda pero esta es para entregar en mi oficina en Usaquén por la tarde, Calle 116 # 19 - 45.\nChatbot: De acuerdo, la agendamos de 14:00 a 16:00.",
                            items: [
                                { type: "Chaqueta de cuero", quantity: 1, price: 35000 }
                            ]
                        }
                    ];
                    
                    appDb.all(`SELECT * FROM client_facade`, [], (err, facadeRows) => {
                        if (err) {
                            console.error("❌ Error fetching client_facade:", err.message);
                        }
                        const facadeMap = {};
                        if (facadeRows) {
                            facadeRows.forEach(row => {
                                facadeMap[row.client_phone] = row;
                            });
                        }
                        
                        const allDeliveries = merged.concat(mockTomorrowDeliveries);
                        allDeliveries.forEach(d => {
                            const phone = d.client_phone ? d.client_phone.replace(/\D/g, '') : '';
                            const facade = facadeMap[phone] || {};
                            d.facade_photo = facade.facade_photo || null;
                            d.facade_latitude = facade.latitude || null;
                            d.facade_longitude = facade.longitude || null;
                            
                            // Si los datos actuales de la orden están "Por confirmar", y tenemos historial en client_facade, los restauramos
                            if (facade.client_name && (!d.client_name || d.client_name.toLowerCase().includes("confirmar") || d.client_name.trim() === "")) {
                                d.client_name = facade.client_name;
                            }
                            if (facade.address && (!d.address || d.address.toLowerCase().includes("confirmar") || d.address.trim() === "")) {
                                d.address = facade.address;
                            }
                        });
                        
                        resolve(allDeliveries);
                    });
                });
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
        longitude,
        delivery_date,
        delivery_type,
        return_delivery_date,
        return_time_window
    } = req.body;

    const chatTranscriptionInput = req.body.chat_transcription || req.body.chatTranscription || null;

    if (!order_id || !client_name || !client_phone || !address) {
        console.error("❌ [Webhook] Error: Faltan campos requeridos.");
        return res.status(400).json({
            success: false,
            error: "Faltan campos obligatorios: order_id, client_name, client_phone, address"
        });
    }

    const localidad = detectarLocalidad(address, latitude, longitude);
    const nowEpoch = Math.floor(Date.now() / 1000);
    
    // Extraer fecha y hora por IA parsing del chat si no están estructuradas
    let parsedDate = null;
    let parsedTimeWindow = null;
    if (chatTranscriptionInput) {
        const parsed = extraerFechaYHoraDelChat(chatTranscriptionInput, nowEpoch);
        parsedDate = parsed.date;
        parsedTimeWindow = parsed.timeWindow;
    }

    const isGrupoB = ["Kennedy", "Engativá", "Fontibón", "Puente Aranda", "Bosa", "Usme", "Ciudad Bolívar", "San Cristóbal", "Rafael Uribe", "Antonio Nariño", "Tunjuelito"].some(loc => localidad && localidad.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(loc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
    const defaultFallbackWindow = isGrupoB ? "12:00 - 15:00" : "11:00 - 14:00";

    const finalDeliveryDate = delivery_date || parsedDate || getColombiaDateString();
    const finalTimeWindow = time_window || parsedTimeWindow || defaultFallbackWindow;

    // Calcular prendas esperadas físicas basadas en los planes y servicios descritos en el chat
    let prendasEsperadas = parseInt(expected_items) || 1;
    if (chatTranscriptionInput) {
        const parsedChatRes = parseResumenFromChat(chatTranscriptionInput);
        if (parsedChatRes.serviceText) {
            const parsedItems = parseItemsFromServiceText(parsedChatRes.serviceText);
            const calculatedUnits = calcularPrendasFisicasEsperadas(parsedItems);
            if (calculatedUnits > 0) {
                prendasEsperadas = calculatedUnits;
            }
        }
    }

    const payStatus = pay_method === 'Pagado (Online)' || pay_method === 'PAGADO' ? 'PAGADO' : 'PENDIENTE';
    const paidAmt = payStatus === 'PAGADO' ? parseFloat(amount) || 0 : 0;

    // Calcular fecha y franja de retorno automáticamente si no están definidas
    let finalReturnDate = return_delivery_date || null;
    let finalReturnTimeWindow = return_time_window || null;
    if (!finalReturnDate) {
        const calculated = calcularFechaRetornoProgramada(finalDeliveryDate, localidad, chatTranscriptionInput);
        finalReturnDate = calculated.date;
        finalReturnTimeWindow = calculated.timeWindow;
        console.log(`🤖 [Webhook] Retorno autoprogramado para ${client_name}: ${finalReturnDate} (${finalReturnTimeWindow})`);
    }

    // Obtener el siguiente número de ticket
    chatbotDb.get("SELECT MAX(ticketNumber) as maxTicket FROM local_orders", [], (err, row) => {
        const nextTicket = (row && row.maxTicket ? row.maxTicket : 0) + 1;
        
        chatbotDb.serialize(() => {
            // Insertar/actualizar orden en local_orders
            chatbotDb.run(`
                INSERT INTO local_orders (id, ticketNumber, status, location, totalValue, paidAmount, paymentStatus, scheduledDate, clientName, clientPhone, clientAddress, created_at, updated_at, chatTranscription)
                VALUES (?, ?, 'PENDIENTE', 'RECEPCION', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET 
                    totalValue = excluded.totalValue,
                    paidAmount = excluded.paidAmount,
                    paymentStatus = excluded.paymentStatus,
                    clientName = excluded.clientName,
                    clientPhone = excluded.clientPhone,
                    clientAddress = excluded.clientAddress,
                    chatTranscription = COALESCE(excluded.chatTranscription, chatTranscription),
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
                nowEpoch,
                chatTranscriptionInput
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
                    INSERT INTO delivery_metadata (order_id, time_window, expected_items, collected_items, latitude, longitude, delivery_date, updated_at, delivery_type, return_delivery_date, return_time_window)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(order_id) DO UPDATE SET
                        time_window = excluded.time_window,
                        expected_items = excluded.expected_items,
                        collected_items = excluded.collected_items,
                        latitude = COALESCE(excluded.latitude, latitude),
                        longitude = COALESCE(excluded.longitude, longitude),
                        delivery_date = excluded.delivery_date,
                        updated_at = excluded.updated_at,
                        delivery_type = excluded.delivery_type,
                        return_delivery_date = excluded.return_delivery_date,
                        return_time_window = excluded.return_time_window
                `, [
                    order_id,
                    finalTimeWindow,
                    prendasEsperadas,
                    prendasEsperadas,
                    (latitude && !isFallbackCoordinate(latitude, longitude)) ? parseFloat(latitude) : null,
                    (longitude && !isFallbackCoordinate(latitude, longitude)) ? parseFloat(longitude) : null,
                    finalDeliveryDate,
                    nowEpoch,
                    delivery_type || "RECOGIDA",
                    finalReturnDate,
                    finalReturnTimeWindow
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
                        time_window: finalTimeWindow,
                        amount: parseFloat(amount) || 0.00,
                        pay_method: pay_method || 'Efectivo',
                        status: 'PENDIENTE',
                        qr_code: `QR-ORQUIDEAS-${nextTicket}`,
                        expected_items: prendasEsperadas,
                        collected_items: prendasEsperadas,
                        latitude: latitude ? parseFloat(latitude) : null,
                        longitude: longitude ? parseFloat(longitude) : null,
                        delivery_date: finalDeliveryDate,
                        return_delivery_date: finalReturnDate,
                        return_time_window: finalReturnTimeWindow
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

// Obtener la capacidad y cupos disponibles de cada franja horaria para una fecha específica
app.get('/api/deliveries/capacity', (req, res) => {
    const queryDate = req.query.date || getColombiaDateString();
    const limitPerSlot = parseInt(req.query.limit) || 5; // Limite por franja (por defecto 5 cupos)
    
    const slots = [
        "08:00 - 11:00",
        "09:00 - 12:00",
        "11:00 - 14:00",
        "12:00 - 15:00"
    ];
    
    appDb.all(`
        SELECT time_window, COUNT(*) as count 
        FROM delivery_metadata 
        WHERE delivery_date = ? 
        GROUP BY time_window
    `, [queryDate], (err, rows) => {
        if (err) {
            console.error("❌ Error al obtener capacidad de entregas:", err.message);
            return res.status(500).json({ success: false, error: err.message });
        }
        
        const counts = {};
        if (rows) {
            rows.forEach(r => {
                if (r.time_window) {
                    counts[r.time_window] = r.count;
                }
            });
        }
        
        const slotsCapacity = {};
        slots.forEach(slot => {
            const scheduled = counts[slot] || 0;
            const available = Math.max(0, limitPerSlot - scheduled);
            slotsCapacity[slot] = {
                scheduled: scheduled,
                available: available,
                status: available > 0 ? "AVAILABLE" : "FULL"
            };
        });
        
        res.json({
            success: true,
            date: queryDate,
            capacity_limit_per_slot: limitPerSlot,
            slots: slotsCapacity
        });
    });
});


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
            const clientUpdatedAt = clientD.status_updated_at || nowEpoch;
            const isReturn = clientD.id && clientD.id.endsWith('_return');
            const targetId = isReturn ? clientD.id.replace('_return', '') : clientD.id;
            
            // Función para proceder a actualizar delivery_metadata
            const proceedToMetadata = () => {
                if (isReturn) {
                    // 2. Guardar metadatos de entrega de retorno en domiciliaria.db
                    appDb.run(`
                        UPDATE delivery_metadata SET 
                            return_status = ?,
                            return_evidence_photo = CASE WHEN ? = 'PENDIENTE' THEN NULL ELSE COALESCE(?, return_evidence_photo) END,
                            return_signature_drawn = CASE WHEN ? = 'PENDIENTE' THEN 0 ELSE ? END,
                            return_items_comments = CASE WHEN ? = 'PENDIENTE' THEN NULL ELSE ? END,
                            return_delivery_date = COALESCE(?, return_delivery_date),
                            return_time_window = COALESCE(?, return_time_window),
                            updated_at = ?
                        WHERE order_id = ?
                    `, [
                        clientD.status,
                        clientD.status,
                        clientD.evidence_photo || null,
                        clientD.status,
                        clientD.signature_drawn ? 1 : 0,
                        clientD.status,
                        clientD.items_comments || null,
                        clientD.return_delivery_date || null,
                        clientD.return_time_window || null,
                        clientUpdatedAt,
                        targetId
                    ], (err) => {
                        if (err) {
                            console.error(`❌ Error guardando metadatos de retorno en domiciliaria.db para ${clientD.id}:`, err.message);
                        }
                        resolve();
                    });
                } else {
                    // 2. Guardar metadatos extendidos en nuestra domiciliaria.db
                    appDb.run(`
                        INSERT INTO delivery_metadata (
                            order_id, time_window, expected_items, collected_items, 
                            evidence_photo, signature_drawn, latitude, longitude, 
                            delivery_date, items_comments, updated_at, delivery_type, 
                            return_delivery_date, return_time_window, resolved_localidad, resolved_address
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(order_id) DO UPDATE SET
                            time_window = excluded.time_window,
                            expected_items = excluded.expected_items,
                            collected_items = excluded.collected_items,
                            evidence_photo = COALESCE(excluded.evidence_photo, delivery_metadata.evidence_photo),
                            signature_drawn = excluded.signature_drawn,
                            latitude = COALESCE(excluded.latitude, delivery_metadata.latitude),
                            longitude = COALESCE(excluded.longitude, delivery_metadata.longitude),
                            delivery_date = excluded.delivery_date,
                            items_comments = excluded.items_comments,
                            updated_at = excluded.updated_at,
                            delivery_type = excluded.delivery_type,
                            return_delivery_date = excluded.return_delivery_date,
                            return_time_window = excluded.return_time_window,
                            resolved_localidad = COALESCE(excluded.resolved_localidad, delivery_metadata.resolved_localidad),
                            resolved_address = COALESCE(excluded.resolved_address, delivery_metadata.resolved_address)
                        WHERE excluded.updated_at >= delivery_metadata.updated_at OR delivery_metadata.updated_at IS NULL
                    `, [
                        clientD.id,
                        clientD.time_window || (function() {
                            let calculatedFallbackWindow = "11:00 - 14:00";
                            if (clientD.localidad) {
                                const isB = ["Kennedy", "Engativá", "Fontibón", "Puente Aranda", "Bosa", "Usme", "Ciudad Bolívar", "San Cristóbal", "Rafael Uribe", "Antonio Nariño", "Tunjuelito"].some(loc => clientD.localidad.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(loc.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
                                calculatedFallbackWindow = isB ? "12:00 - 15:00" : "11:00 - 14:00";
                            }
                            return calculatedFallbackWindow;
                        })(),
                        clientD.expected_items || 1,
                        clientD.collected_items || 1,
                        clientD.evidence_photo || null,
                        clientD.signature_drawn ? 1 : 0,
                        (clientD.latitude && !isFallbackCoordinate(clientD.latitude, clientD.longitude)) ? parseFloat(clientD.latitude) : null,
                        (clientD.longitude && !isFallbackCoordinate(clientD.latitude, clientD.longitude)) ? parseFloat(clientD.longitude) : null,
                        clientD.order_date || getColombiaDateString(),
                        clientD.items_comments || null,
                        clientUpdatedAt,
                        clientD.delivery_type || "RECOGIDA",
                        clientD.return_delivery_date || null,
                        clientD.return_time_window || null,
                        clientD.localidad || null,
                        clientD.address || null
                    ], (err) => {
                        if (err) {
                            console.error(`❌ Error guardando metadatos en domiciliaria.db para ${clientD.id}:`, err.message);
                        }
                        
                        // Guardar información de fachada si está presente
                        if (clientD.facade_photo || (clientD.facade_latitude && clientD.facade_longitude)) {
                            const clientPhoneClean = clientD.client_phone ? clientD.client_phone.replace(/\D/g, '') : '';
                            let finalAddress = clientD.address;
                            let resolvedLoc = null;
                            
                            const saveFacadeToDb = (addrVal, locVal) => {
                                appDb.run(`
                                    INSERT INTO client_facade (
                                        client_phone, client_name, address, facade_photo, latitude, longitude, updated_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                                    ON CONFLICT(client_phone) DO UPDATE SET
                                        client_name = excluded.client_name,
                                        address = excluded.address,
                                        facade_photo = COALESCE(excluded.facade_photo, facade_photo),
                                        latitude = COALESCE(excluded.latitude, latitude),
                                        longitude = COALESCE(excluded.longitude, longitude),
                                        updated_at = excluded.updated_at
                                `, [
                                    clientPhoneClean,
                                    clientD.client_name,
                                    addrVal || clientD.address,
                                    clientD.facade_photo || null,
                                    clientD.facade_latitude ? parseFloat(clientD.facade_latitude) : null,
                                    clientD.facade_longitude ? parseFloat(clientD.facade_longitude) : null,
                                    nowEpoch
                                ], (err) => {
                                    if (err) {
                                        console.error(`❌ Error guardando fachada en client_facade para ${clientD.client_phone}:`, err.message);
                                    }
                                    resolve();
                                });
                            };

                            const isAddrUnconfirmed = !finalAddress || finalAddress.toLowerCase().includes("confirmar") || finalAddress.trim() === "";
                            if (isAddrUnconfirmed && clientD.facade_latitude && clientD.facade_longitude) {
                                reverseGeocode(parseFloat(clientD.facade_latitude), parseFloat(clientD.facade_longitude)).then(geoRes => {
                                    if (geoRes && geoRes.display_name) {
                                        finalAddress = geoRes.display_name;
                                        resolvedLoc = geoRes.localidad;
                                        console.log(`✅ [Geocoder Satelital] Dirección de fachada resuelta para ${clientPhoneClean}: "${finalAddress}" [${resolvedLoc}]`);
                                        
                                        appDb.run(`
                                            INSERT INTO delivery_metadata (
                                                order_id, resolved_address, resolved_localidad, updated_at
                                            ) VALUES (?, ?, ?, ?)
                                            ON CONFLICT(order_id) DO UPDATE SET
                                                resolved_address = excluded.resolved_address,
                                                resolved_localidad = excluded.resolved_localidad,
                                                updated_at = excluded.updated_at
                                        `, [clientD.id, finalAddress, resolvedLoc, nowEpoch], (err) => {
                                            if (err) {
                                                console.error("❌ Error haciendo UPSERT de resolved_address en delivery_metadata:", err.message);
                                            }
                                            saveFacadeToDb(finalAddress, resolvedLoc);
                                        });
                                    } else {
                                        saveFacadeToDb(null, null);
                                    }
                                }).catch(() => {
                                    saveFacadeToDb(null, null);
                                });
                            } else {
                                saveFacadeToDb(null, null);
                            }
                        } else {
                            resolve();
                        }
                    });
                }
            };
            
            // 1. Actualizar el chatbot's messages.db según corresponda
            if (isReturn) {
                if (clientD.status === 'ENTREGADO') {
                    // Si el retorno se completó, la orden completa pasa a ENTREGADO en messages.db (sin alterar totalValue)
                    chatbotDb.run(`
                        UPDATE local_orders 
                        SET status = ?, updated_at = ? 
                        WHERE (id = ? OR ticketNumber = ?) AND (? >= updated_at OR updated_at IS NULL)
                    `, [
                        'ENTREGADO',
                        clientUpdatedAt,
                        targetId,
                        targetId.replace('QR-ORQUIDEAS-', ''),
                        clientUpdatedAt
                    ], (err) => {
                        if (err) {
                            console.error(`❌ Error actualizando estado de retorno en messages.db para ${clientD.id}:`, err.message);
                        }
                        proceedToMetadata();
                    });
                } else {
                    // Si es retorno pero no está entregado, NO alterar el estado de la orden principal en messages.db
                    proceedToMetadata();
                }
            } else {
                // Si es la recogida principal, actualizar estado y totalValue normalmente
                chatbotDb.run(`
                    UPDATE local_orders 
                    SET status = ?, totalValue = ?, updated_at = ? 
                    WHERE (id = ? OR ticketNumber = ?) AND (? >= updated_at OR updated_at IS NULL)
                `, [
                    clientD.status,
                    clientD.amount || 0,
                    clientUpdatedAt,
                    targetId,
                    targetId.replace('QR-ORQUIDEAS-', ''),
                    clientUpdatedAt
                ], (err) => {
                    if (err) {
                        console.error(`❌ Error actualizando estado en messages.db para ${clientD.id}:`, err.message);
                    }
                    proceedToMetadata();
                });
            }
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

// Eliminar permanentemente una entrega o un retorno
app.delete('/api/deliveries/:id', (req, res) => {
    const id = req.params.id;
    const isReturn = id.endsWith('_return');
    const targetId = isReturn ? id.replace('_return', '') : id;
    
    if (isReturn) {
        // Si es un retorno, borrar sólo los datos de retorno de delivery_metadata
        appDb.run(`
            UPDATE delivery_metadata SET 
                return_delivery_date = NULL,
                return_time_window = NULL,
                return_status = NULL,
                return_evidence_photo = NULL,
                return_signature_drawn = NULL,
                return_items_comments = NULL,
                updated_at = ?
            WHERE order_id = ?
        `, [Math.floor(Date.now() / 1000), targetId], (err) => {
            if (err) {
                console.error(`❌ Error al eliminar retorno ${id} de SQLite:`, err.message);
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, message: `Retorno de orden ${targetId} eliminado.` });
        });
    } else {
        // Si es la orden principal, eliminar de local_orders y de delivery_metadata
        chatbotDb.run(`DELETE FROM local_orders WHERE id = ?`, [targetId], (err1) => {
            if (err1) {
                console.error(`❌ Error al eliminar orden ${targetId} de messages.db:`, err1.message);
            }
            appDb.run(`DELETE FROM delivery_metadata WHERE order_id = ?`, [targetId], (err2) => {
                if (err2) {
                    console.error(`❌ Error al eliminar metadatos ${targetId} de domiciliaria.db:`, err2.message);
                }
                res.json({ success: true, message: `Orden ${targetId} y sus metadatos eliminados permanentemente.` });
            });
        });
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

// Resolver dirección a coordenadas GPS
app.get('/api/geocode', async (req, res) => {
    const address = req.query.address;
    if (!address) {
        return res.status(400).json({ success: false, error: "Falta la dirección" });
    }
    try {
        const coords = await geocodeAddress(address);
        if (coords) {
            res.json({ success: true, latitude: coords.lat, longitude: coords.lon, localidad: coords.localidad });
        } else {
            res.status(404).json({ success: false, error: "No se pudieron obtener las coordenadas para esta dirección" });
        }
    } catch (err) {
        console.error("❌ Error en geocodeAddress API:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Loguear errores del frontend en la consola del servidor
app.post('/api/log-error', express.json(), (req, res) => {
    console.error("🚨 [Client Error]:", req.body.error, "\n  URL:", req.body.url, "line:", req.body.line, "col:", req.body.col, "\n  Stack:", req.body.stack);
    res.json({ success: true });
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
                        let query = `SELECT id, clientPhone, clientAddress, scheduledDate, chatTranscription, created_at FROM local_orders`;
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
                const phoneKey = order.clientPhone ? order.clientPhone.replace(/\D/g, '') : '';
                
                const proceedWithNormalGeocoding = (orderToGeocode) => {
                    const address = orderToGeocode.clientAddress;
                    
                    const parsedChatRes = parseResumenFromChat(orderToGeocode.chatTranscription);
                    const veracityName = parsedChatRes.clientName || null;
                    const veracityAddress = parsedChatRes.clientAddress || null;
                    const veracityTotal = parsedChatRes.totalText ? parseFloat(parsedChatRes.totalText.replace(/[^\d]/g, '')) : null;
                    
                    const parsedChat = extraerFechaYHoraDelChat(orderToGeocode.chatTranscription, orderToGeocode.created_at);
                    const veracityPickupDate = parsedChat.date || null;
                    const veracityTimeWindow = parsedChat.timeWindow || null;
                    
                    if (!address || address === 'Recogida WhatsApp') {
                        const nowEpoch = Math.floor(Date.now() / 1000);
                        const baseLat = 4.7011;
                        const baseLng = -74.0330;
                        const defaultAddress = veracityAddress || 'Recogida WhatsApp';
                        const defaultLocalidad = detectarLocalidadExplicita(defaultAddress) || 'Usaquén';
                        
                        appDb.get(`SELECT * FROM delivery_metadata WHERE order_id = ?`, [orderToGeocode.id], (err, meta) => {
                            if (err) return;
                            if (meta) {
                                appDb.run(`
                                    UPDATE delivery_metadata 
                                    SET latitude = ?, longitude = ?, resolved_address = ?, resolved_localidad = ?, updated_at = ?,
                                        veracity_name = ?, veracity_address = ?, veracity_pickup_date = ?, veracity_time_window = ?, veracity_total_value = ?
                                    WHERE order_id = ?
                                `, [baseLat, baseLng, defaultAddress, defaultLocalidad, nowEpoch, 
                                    veracityName, veracityAddress, veracityPickupDate, veracityTimeWindow, veracityTotal, 
                                    orderToGeocode.id]);
                            } else {
                                const finalDate = sanitizeDateString(orderToGeocode.scheduledDate || parsedChat.date || getColombiaDateString());
                                const returnSched = calcularFechaRetornoProgramada(finalDate, defaultLocalidad, orderToGeocode.chatTranscription);
                                appDb.run(`
                                    INSERT INTO delivery_metadata (
                                        order_id, latitude, longitude, resolved_address, resolved_localidad, delivery_date, updated_at, return_delivery_date, return_time_window,
                                        veracity_name, veracity_address, veracity_pickup_date, veracity_time_window, veracity_total_value
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                `, [orderToGeocode.id, baseLat, baseLng, defaultAddress, defaultLocalidad, finalDate, nowEpoch, returnSched.date, returnSched.timeWindow,
                                    veracityName, veracityAddress, veracityPickupDate, veracityTimeWindow, veracityTotal]);
                            }
                        });
                        return;
                    }

                    // 3. Si la dirección es de tipo "Ubicación GPS: lat, lon" o un enlace a Google Maps con coordenadas
                    let lat = null;
                    let lon = null;
                    let isGps = false;

                    let genericMatch = address.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
                    if (!genericMatch) {
                        const latLngMatch = address.match(/lat\s*(-?\d+\.\d+).*?lng\s*(-?\d+\.\d+)/i);
                        if (latLngMatch) {
                            genericMatch = latLngMatch;
                        }
                    }
                    const isUrlOrGps = address.toLowerCase().includes("maps") || address.toLowerCase().includes("gps") || address.startsWith("http") || address.includes("Ubicación");
                    
                    if (genericMatch && (isUrlOrGps || address.length < 100)) {
                        lat = parseFloat(genericMatch[1]);
                        lon = parseFloat(genericMatch[2]);
                        isGps = true;
                    }

                    if (isGps) {
                        console.log(`📡 [Geocoder] Detectada ubicación GPS: (${lat}, ${lon}) para orden ${orderToGeocode.id}. Realizando geocodificación inversa...`);
                        
                        reverseGeocode(lat, lon).then(result => {
                            const nowEpoch = Math.floor(Date.now() / 1000);
                            const resolvedAddress = veracityAddress || (result ? result.display_name : `Ubicación GPS: ${lat}, ${lon}`);
                            const resolvedLocalidad = detectarLocalidadExplicita(resolvedAddress) || (result && result.localidad ? result.localidad : detectarLocalidad(address, lat, lon));
                            
                            console.log(`✅ [Geocoder] Ubicación GPS resuelta: "${resolvedAddress}" [${resolvedLocalidad}]`);
                            
                            appDb.get(`SELECT * FROM delivery_metadata WHERE order_id = ?`, [orderToGeocode.id], (err, meta) => {
                                if (err) return;
                                if (meta) {
                                    appDb.run(`
                                        UPDATE delivery_metadata 
                                        SET latitude = ?, longitude = ?, resolved_address = ?, resolved_localidad = ?, updated_at = ?,
                                            veracity_name = ?, veracity_address = ?, veracity_pickup_date = ?, veracity_time_window = ?, veracity_total_value = ?
                                        WHERE order_id = ?
                                    `, [lat, lon, resolvedAddress, resolvedLocalidad, nowEpoch, 
                                        veracityName, veracityAddress, veracityPickupDate, veracityTimeWindow, veracityTotal, 
                                        orderToGeocode.id]);
                                } else {
                                    const finalDate = sanitizeDateString(orderToGeocode.scheduledDate || parsedChat.date || getColombiaDateString());
                                    const returnSched = calcularFechaRetornoProgramada(finalDate, resolvedLocalidad, orderToGeocode.chatTranscription);
                                    appDb.run(`
                                        INSERT INTO delivery_metadata (
                                            order_id, latitude, longitude, resolved_address, resolved_localidad, delivery_date, updated_at, return_delivery_date, return_time_window,
                                            veracity_name, veracity_address, veracity_pickup_date, veracity_time_window, veracity_total_value
                                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                    `, [orderToGeocode.id, lat, lon, resolvedAddress, resolvedLocalidad, finalDate, nowEpoch, returnSched.date, returnSched.timeWindow,
                                        veracityName, veracityAddress, veracityPickupDate, veracityTimeWindow, veracityTotal]);
                                }
                            });
                        });
                        return;
                    }

                    // 4. Dirección normal de texto
                    const addressToGeocode = veracityAddress || address;
                    console.log(`📡 [Geocoder] Intentando geolocalizar dirección de texto: "${addressToGeocode}" para orden ${orderToGeocode.id}...`);
                    geocodeAddress(addressToGeocode).then(coords => {
                        const nowEpoch = Math.floor(Date.now() / 1000);
                        let finalLat = coords ? coords.lat : null;
                        let finalLon = coords ? coords.lon : null;
                        let resolvedAddress = addressToGeocode;
                        let resolvedLocalidad = detectarLocalidadExplicita(addressToGeocode) || (coords ? coords.localidad : null);
                        
                        if (!finalLat || !finalLon) {
                            if (!resolvedLocalidad) {
                                resolvedLocalidad = detectarLocalidad(addressToGeocode);
                            }
                            const fallback = getLocalidadCenterCoords(resolvedLocalidad);
                            finalLat = fallback.lat;
                            finalLon = fallback.lon;
                            console.log(`⚠️ [Geocoder] No se pudo encontrar coordenadas para "${addressToGeocode}". Asignando centro de ${resolvedLocalidad}: (${finalLat}, ${finalLon})`);
                        } else {
                            if (!resolvedLocalidad) {
                                resolvedLocalidad = detectarLocalidad(resolvedAddress, finalLat, finalLon);
                            }
                            console.log(`✅ [Geocoder] Geolocalizado con éxito: "${resolvedAddress}" (${finalLat}, ${finalLon}) [${resolvedLocalidad}]`);
                        }

                        // Guardar/Actualizar en domiciliaria.db de forma segura
                        appDb.get(`SELECT * FROM delivery_metadata WHERE order_id = ?`, [orderToGeocode.id], (err, meta) => {
                            if (err) return;
                            if (meta) {
                                appDb.run(`
                                    UPDATE delivery_metadata 
                                    SET latitude = ?, longitude = ?, resolved_address = ?, resolved_localidad = ?, updated_at = ?,
                                        veracity_name = ?, veracity_address = ?, veracity_pickup_date = ?, veracity_time_window = ?, veracity_total_value = ?
                                    WHERE order_id = ?
                                `, [finalLat, finalLon, resolvedAddress, resolvedLocalidad, nowEpoch, 
                                    veracityName, veracityAddress, veracityPickupDate, veracityTimeWindow, veracityTotal, 
                                    orderToGeocode.id], (err) => {
                                    if (err) console.error("❌ [Geocoder] Error al actualizar coordenadas/veracidad:", err.message);
                                });
                            } else {
                                const finalDate = sanitizeDateString(orderToGeocode.scheduledDate || parsedChat.date || getColombiaDateString());
                                const returnSched = calcularFechaRetornoProgramada(finalDate, resolvedLocalidad, orderToGeocode.chatTranscription);
                                appDb.run(`
                                    INSERT INTO delivery_metadata (
                                        order_id, latitude, longitude, resolved_address, resolved_localidad, delivery_date, updated_at, return_delivery_date, return_time_window,
                                        veracity_name, veracity_address, veracity_pickup_date, veracity_time_window, veracity_total_value
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                `, [orderToGeocode.id, finalLat, finalLon, resolvedAddress, resolvedLocalidad, finalDate, nowEpoch, returnSched.date, returnSched.timeWindow,
                                    veracityName, veracityAddress, veracityPickupDate, veracityTimeWindow, veracityTotal], (err) => {
                                    if (err) console.error("❌ [Geocoder] Error al insertar coordenadas/veracidad:", err.message);
                                });
                            }
                        });
                    });
                };

                // Intentar recuperar coordenadas e imagen de fachada históricas si existen y corresponden a la misma dirección
                if (phoneKey) {
                    chatbotDb.all(`SELECT id, clientAddress FROM local_orders WHERE clientPhone LIKE ?`, [`%${phoneKey}`], (err, prevOrders) => {
                        if (err || !prevOrders || prevOrders.length <= 1) {
                            proceedWithNormalGeocoding(order);
                            return;
                        }
                        
                        // Filtrar órdenes previas del mismo cliente que tengan direcciones físicamente coherentes o similares
                        const similarOrders = prevOrders.filter(po => po.id !== order.id && esDireccionSimilar(order.clientAddress, po.clientAddress));
                        
                        if (similarOrders.length === 0) {
                            proceedWithNormalGeocoding(order);
                            return;
                        }
                        
                        const similarIds = similarOrders.map(so => so.id);
                        const placeholders = similarIds.map(() => '?').join(',');
                        appDb.get(`
                            SELECT latitude, longitude, resolved_address, resolved_localidad, evidence_photo, return_delivery_date, return_time_window 
                            FROM delivery_metadata 
                            WHERE order_id IN (${placeholders}) AND latitude IS NOT NULL 
                            ORDER BY updated_at DESC LIMIT 1
                        `, similarIds, (err, historicalMeta) => {
                            if (!err && historicalMeta) {
                                const nowEpoch = Math.floor(Date.now() / 1000);
                                const parsedChatRes = parseResumenFromChat(order.chatTranscription);
                                const veracityName = parsedChatRes.clientName || null;
                                const veracityAddress = parsedChatRes.clientAddress || null;
                                const veracityTotal = parsedChatRes.totalText ? parseFloat(parsedChatRes.totalText.replace(/[^\d]/g, '')) : null;
                                
                                const parsedChat = extraerFechaYHoraDelChat(order.chatTranscription, order.created_at);
                                const veracityPickupDate = parsedChat.date || null;
                                const veracityTimeWindow = parsedChat.timeWindow || null;
                                
                                const finalDate = sanitizeDateString(order.scheduledDate || parsedChat.date || getColombiaDateString());
                                const explicitLocalidad = detectarLocalidadExplicita(order.clientAddress);
                                const finalLocalidad = explicitLocalidad || historicalMeta.resolved_localidad || "Usaquén";
                                const returnSched = calcularFechaRetornoProgramada(finalDate, finalLocalidad, order.chatTranscription);
                                
                                appDb.run(`
                                    INSERT INTO delivery_metadata (
                                        order_id, latitude, longitude, resolved_address, resolved_localidad, 
                                        evidence_photo, delivery_date, updated_at, return_delivery_date, return_time_window,
                                        veracity_name, veracity_address, veracity_pickup_date, veracity_time_window, veracity_total_value
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                `, [
                                    order.id, 
                                    historicalMeta.latitude, 
                                    historicalMeta.longitude, 
                                    veracityAddress || historicalMeta.resolved_address, 
                                    finalLocalidad, 
                                    historicalMeta.evidence_photo, 
                                    finalDate, 
                                    nowEpoch,
                                    historicalMeta.return_delivery_date || returnSched.date,
                                    historicalMeta.return_time_window || returnSched.timeWindow,
                                    veracityName, veracityAddress, veracityPickupDate, veracityTimeWindow, veracityTotal
                                ], (err) => {
                                    if (err) {
                                        console.error("❌ [Geocoder] Error al insertar coordenadas históricas:", err.message);
                                        proceedWithNormalGeocoding(order);
                                    } else {
                                        console.log(`♻️ [Geocoder] Reutilizada ubicación y fachada histórica para el cliente ${order.id} (${phoneKey}) con localidad ${finalLocalidad} y fecha ${finalDate}.`);
                                    }
                                });
                            } else {
                                proceedWithNormalGeocoding(order);
                            }
                        });
                    });
                } else {
                    proceedWithNormalGeocoding(order);
                }
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
