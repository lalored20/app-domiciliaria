/* SYSTEMA ANTIGRAVITY v4.5: MOTOR DE LÓGICA DE NEGOCIO (FULL MIGRADO, AUTOCORREGIDO E INTERACTIVO) */

// 1. Configuración de Base de Datos Local con Dexie.js (Offline Cache)
let db = null;
try {
    if (typeof Dexie !== 'undefined') {
        db = new Dexie("AppDomiciliariaDB");
        db.version(3).stores({
            deliveries: 'id, client_name, client_phone, address, localidad, time_window, amount, pay_method, status, qr_code, expected_items, collected_items, evidence_photo, signature_drawn, order_date, sync_pending',
            shift: 'id, driver_name, initial_cash, collected_cash, expenses, status, shift_date, sync_pending'
        });
        console.log("🔋 Dexie.js (IndexedDB local) activo.");
    }
} catch (e) {
    console.warn("⚠️ Falló Dexie. Usando LocalStorage fallback.", e);
}

// Datos de prueba iniciales
const DEFAULT_DELIVERIES = [
    {
        id: "d1",
        client_name: "Carlos Mendoza",
        client_phone: "573001234567",
        address: "Calle 127 # 15-45, Apto 402, Usaquén",
        localidad: "Usaquén",
        time_window: "08:00 - 10:00",
        amount: 120000,
        pay_method: "Efectivo",
        status: "EN_RUTA",
        qr_code: "QR-ORQUIDEAS-8891",
        expected_items: 6,
        collected_items: 6,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-18",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.7058,
        longitude: -74.0423
    },
    {
        id: "d2",
        client_name: "Sofía Rodríguez",
        client_phone: "573119876543",
        address: "Carrera 9 # 118-20, Torre A, Usaquén",
        localidad: "Usaquén",
        time_window: "10:00 - 12:00",
        amount: 60000,
        pay_method: "Transferencia",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-1123",
        expected_items: 3,
        collected_items: 3,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-18",
        sync_pending: false,
        sort_order: 20,
        latitude: 4.6978,
        longitude: -74.0318
    },
    {
        id: "d3",
        client_name: "Juan Sebastián Ortiz",
        client_phone: "573155554433",
        address: "Calle 140 # 9-80, Casa 4, Usaquén",
        localidad: "Usaquén",
        time_window: "14:00 - 16:00",
        amount: 85000,
        pay_method: "Pagado (Online)",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-4566",
        expected_items: 5,
        collected_items: 5,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-18",
        sync_pending: false,
        sort_order: 30,
        latitude: 4.7189,
        longitude: -74.0302
    },
    {
        id: "d4",
        client_name: "Liliana Patricia Vega",
        client_phone: "573204443322",
        address: "Calle 145 # 104-50, Apto 502, Suba",
        localidad: "Suba",
        time_window: "10:00 - 12:00",
        amount: 150000,
        pay_method: "Efectivo",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-0922",
        expected_items: 12,
        collected_items: 12,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-18",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.7352,
        longitude: -74.0901
    },
    {
        id: "d5",
        client_name: "Andrés Felipe Gómez",
        client_phone: "573041112233",
        address: "Carrera 102 # 130-15, Suba",
        localidad: "Suba",
        time_window: "14:00 - 16:00",
        amount: 45000,
        pay_method: "Transferencia",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-9921",
        expected_items: 2,
        collected_items: 2,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-18",
        sync_pending: false,
        sort_order: 20,
        latitude: 4.7178,
        longitude: -74.0954
    },
    // ==========================================
    // HISTORIAL: 15 DE MAYO DE 2026 (Completados)
    // ==========================================
    {
        id: "d6",
        client_name: "Clara Inés Restrepo",
        client_phone: "573163334455",
        address: "Calle 100 # 8A-30, Usaquén",
        localidad: "Usaquén",
        time_window: "10:00 - 12:00",
        amount: 80000,
        pay_method: "Efectivo",
        status: "ENTREGADO",
        qr_code: "QR-ORQUIDEAS-0012",
        expected_items: 5,
        collected_items: 5,
        evidence_photo: "foto_evidencia.png",
        signature_drawn: true,
        order_date: "2026-05-15",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.6860,
        longitude: -74.0380
    },
    {
        id: "d7",
        client_name: "Álvaro José Restrepo",
        client_phone: "573163334466",
        address: "Carrera 7 # 120-10, Usaquén",
        localidad: "Usaquén",
        time_window: "14:00 - 16:00",
        amount: 45000,
        pay_method: "Transferencia",
        status: "ENTREGADO",
        qr_code: "QR-ORQUIDEAS-0013",
        expected_items: 2,
        collected_items: 2,
        evidence_photo: "foto_evidencia.png",
        signature_drawn: true,
        order_date: "2026-05-15",
        sync_pending: false,
        sort_order: 20,
        latitude: 4.6990,
        longitude: -74.0305
    },
    // ==========================================
    // MAÑANA: 19 DE JUNIO DE 2026 (Pendientes)
    // ==========================================
    {
        id: "d8",
        client_name: "Mariana Delgado",
        client_phone: "573121112233",
        address: "Calle 116 # 7-15, Usaquén",
        localidad: "Usaquén",
        time_window: "09:00 - 11:00",
        amount: 95000,
        pay_method: "Efectivo",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-1901",
        expected_items: 4,
        collected_items: 4,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-19",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.6955,
        longitude: -74.0295
    },
    {
        id: "d9",
        client_name: "Roberto Gomez",
        client_phone: "573105556677",
        address: "Calle 134 # 19-30, Usaquén",
        localidad: "Usaquén",
        time_window: "11:00 - 13:00",
        amount: 110000,
        pay_method: "Transferencia",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-1902",
        expected_items: 8,
        collected_items: 8,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-19",
        sync_pending: false,
        sort_order: 20,
        latitude: 4.7125,
        longitude: -74.0450
    },
    {
        id: "d10",
        client_name: "Diana Marcela Rojas",
        client_phone: "573157778899",
        address: "Calle 152 # 111-20, Suba",
        localidad: "Suba",
        time_window: "14:00 - 16:00",
        amount: 55000,
        pay_method: "Pagado (Online)",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-1903",
        expected_items: 3,
        collected_items: 3,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-19",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.7410,
        longitude: -74.0980
    },
    // ==========================================
    // PASADO MAÑANA: 20 DE JUNIO DE 2026 (Pendientes)
    // ==========================================
    {
        id: "d11",
        client_name: "Esteban Bernal",
        client_phone: "573016667788",
        address: "Carrera 15 # 106-80, Usaquén",
        localidad: "Usaquén",
        time_window: "08:00 - 10:00",
        amount: 130000,
        pay_method: "Efectivo",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-2001",
        expected_items: 7,
        collected_items: 7,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-20",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.6930,
        longitude: -74.0420
    },
    {
        id: "d12",
        client_name: "Paola Andrea Cruz",
        client_phone: "573188889900",
        address: "Calle 138 # 91-45, Suba",
        localidad: "Suba",
        time_window: "10:00 - 12:00",
        amount: 72000,
        pay_method: "Transferencia",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-2002",
        expected_items: 4,
        collected_items: 4,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-20",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.7265,
        longitude: -74.0910
    },
    {
        id: "d13",
        client_name: "Gabriel Soler",
        client_phone: "573219990011",
        address: "Carrera 104 # 148-10, Suba",
        localidad: "Suba",
        time_window: "14:00 - 16:00",
        amount: 48000,
        pay_method: "Efectivo",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-2003",
        expected_items: 2,
        collected_items: 2,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-06-20",
        sync_pending: false,
        sort_order: 20,
        latitude: 4.7390,
        longitude: -74.1015
    },
    // ==========================================
    // PRÓXIMO MES: 10 DE JULIO DE 2026 (Pendientes)
    // ==========================================
    {
        id: "d14",
        client_name: "Natalia Santos",
        client_phone: "573004445566",
        address: "Calle 116 # 15-60, Usaquén",
        localidad: "Usaquén",
        time_window: "08:00 - 10:00",
        amount: 120000,
        pay_method: "Efectivo",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-0701",
        expected_items: 6,
        collected_items: 6,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-07-10",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.6965,
        longitude: -74.0430
    },
    // ==========================================
    // FUTURO LEJANO: 5 DE AGOSTO DE 2026 (Pendientes)
    // ==========================================
    {
        id: "d15",
        client_name: "Felipe Vergara",
        client_phone: "573022223344",
        address: "Calle 147 # 19-50, Usaquén",
        localidad: "Usaquén",
        time_window: "10:00 - 12:00",
        amount: 75000,
        pay_method: "Pagado (Online)",
        status: "PENDIENTE",
        qr_code: "QR-ORQUIDEAS-0801",
        expected_items: 4,
        collected_items: 4,
        evidence_photo: null,
        signature_drawn: false,
        order_date: "2026-08-05",
        sync_pending: false,
        sort_order: 10,
        latitude: 4.7230,
        longitude: -74.0410
    }
];

// Inicialización de Supabase
let supabaseClient = null;
function initSupabase() {
    const url = localStorage.getItem("supabase-url") || "";
    const key = localStorage.getItem("supabase-key") || "";
    
    if (url && key && typeof window.supabase !== 'undefined') {
        try {
            supabaseClient = window.supabase.createClient(url, key);
            addSystemLog("🔌 Supabase Cloud conectado correctamente.");
        } catch (e) {
            addSystemLog("❌ Error Supabase: " + e.message);
        }
    } else {
        addSystemLog("ℹ️ Modo Local Offline (Sin conexión a Supabase).");
    }
}

// Historial de Logs
let logs = [];
function addSystemLog(msg) {
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] ${msg}`;
    logs.push(formatted);
    if (logs.length > 50) logs.shift();
    
    const consoleEl = document.getElementById("sync-console-logs");
    if (consoleEl) {
        consoleEl.innerHTML = logs.map(l => `<div>${l}</div>`).join('');
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

// Estado
let deliveries = [];
let currentLocalidad = "Usaquén";
let currentTab = "deliveries";
let currentActiveDeliveryId = null;
let currentCollectedItemsCount = 1;

let currentShift = {
    id: "shift_today",
    driver_name: "Ramón Mendoza",
    initial_cash: 50000,
    collected_cash: 0,
    expenses: 0,
    status: "ABIERTO",
    shift_date: "2026-06-18",
    sync_pending: false
};

// Canvas de Firma
let signatureCanvas = null;
let signatureCtx = null;
let isDrawing = false;
let hasSigned = false;

// 2. Inicialización
async function initApp() {
    initSupabase();

    // Intentar leer de base de datos local Dexie
    if (db) {
        try {
            const count = await db.deliveries.count();
            if (count === 0) {
                await db.deliveries.bulkAdd(DEFAULT_DELIVERIES);
                await db.shift.put(currentShift);
                deliveries = [...DEFAULT_DELIVERIES];
                addSystemLog("📦 Base de datos local sembrada con datos de WhatsApp.");
            } else {
                deliveries = await db.deliveries.toArray();
                
                // CHEQUEAR SI FALTAN PEDIDOS POR DEFECTO (Ej: los nuevos días del calendario)
                let addedMissing = false;
                for (const def of DEFAULT_DELIVERIES) {
                    if (!deliveries.some(d => d.id === def.id)) {
                        deliveries.push(def);
                        await db.deliveries.put(def);
                        addedMissing = true;
                    }
                }
                if (addedMissing) {
                    addSystemLog("📦 Sembrados nuevos pedidos simulados de calendario.");
                }
                
                // MIGRACIÓN AUTOMÁTICA DE DATOS:
                // Si el usuario recargó y tenía datos anteriores sin expected_items, sort_order o coordenadas,
                // actualizamos en caliente usando los datos predeterminados.
                let dataMigrated = false;
                deliveries.forEach((d, idx) => {
                    const def = DEFAULT_DELIVERIES.find(def => def.id === d.id);
                    if (d.expected_items === undefined || d.expected_items === null) {
                        d.expected_items = def ? def.expected_items : 1;
                        d.collected_items = def ? def.expected_items : 1;
                        dataMigrated = true;
                    }
                    if (d.sort_order === undefined || d.sort_order === null) {
                        d.sort_order = def ? def.sort_order : idx * 10;
                        dataMigrated = true;
                    }
                    if (d.latitude === undefined || d.latitude === null) {
                        d.latitude = def ? def.latitude : null;
                        d.longitude = def ? def.longitude : null;
                        dataMigrated = true;
                    }
                });

                if (dataMigrated) {
                    await saveDeliveries();
                    addSystemLog("🔧 Migración: Corregidos registros antiguos con sort_order y geolocalización.");
                }

                const storedShift = await db.shift.get("shift_today");
                if (storedShift) {
                    currentShift = storedShift;
                }
                addSystemLog(`📦 Cargados ${deliveries.length} pedidos locales de IndexedDB.`);
            }
        } catch (e) {
            console.error("Fallo inicializando base de datos local Dexie", e);
            loadLocalStorageFallback();
        }
    } else {
        loadLocalStorageFallback();
    }

    const activeTheme = localStorage.getItem("app-theme") || "theme-dark";
    setTheme(activeTheme);
    recalculateShiftCash();

    renderTabs();
    renderLocalidades();
    renderCalendarStrip();
    
    // Auto-optimizar la ruta inicial de forma silenciosa al arrancar
    if (deliveries.length > 0) {
        await optimizeRouteByProximity(currentLocalidad, true);
    } else {
        renderContent();
    }

    setInterval(runBackgroundSync, 10000);
    runBackgroundSync();

    initSignatureCanvasEvents();
}

function loadLocalStorageFallback() {
    const cached = localStorage.getItem("deliveries");
    if (cached) {
        deliveries = JSON.parse(cached);
    } else {
        deliveries = [...DEFAULT_DELIVERIES];
        localStorage.setItem("deliveries", JSON.stringify(deliveries));
    }

    // Chequear si faltan pedidos por defecto (Ej: los nuevos días del calendario)
    let addedMissingLoc = false;
    for (const def of DEFAULT_DELIVERIES) {
        if (!deliveries.some(d => d.id === def.id)) {
            deliveries.push(def);
            addedMissingLoc = true;
        }
    }
    if (addedMissingLoc) {
        localStorage.setItem("deliveries", JSON.stringify(deliveries));
        addSystemLog("📦 Sembrados nuevos pedidos simulados en LocalStorage.");
    }

    // Migración para fallback de LocalStorage
    let migrated = false;
    deliveries.forEach((d, idx) => {
        const def = DEFAULT_DELIVERIES.find(def => def.id === d.id);
        if (d.expected_items === undefined || d.expected_items === null) {
            d.expected_items = def ? def.expected_items : 1;
            d.collected_items = def ? def.expected_items : 1;
            migrated = true;
        }
        if (d.sort_order === undefined || d.sort_order === null) {
            d.sort_order = def ? def.sort_order : idx * 10;
            migrated = true;
        }
        if (d.latitude === undefined || d.latitude === null) {
            d.latitude = def ? def.latitude : null;
            d.longitude = def ? def.longitude : null;
            migrated = true;
        }
    });
    if (migrated) {
        localStorage.setItem("deliveries", JSON.stringify(deliveries));
    }

    const cachedShift = localStorage.getItem("shift");
    if (cachedShift) {
        currentShift = JSON.parse(cachedShift);
    }
    addSystemLog("📦 Cargados datos locales desde LocalStorage Fallback.");
}

// Variables y funciones del Calendario
let currentDate = "2026-06-18";
let viewYear = 2026;
let viewMonth = 5; // Junio (0-indexado)

function renderCalendarStrip() {
    const strip = document.getElementById("calendar-strip");
    const label = document.getElementById("calendar-month-label");
    if (!strip || !label) return;
    
    strip.innerHTML = "";
    
    const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const weekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    
    label.textContent = `${months[viewMonth]} ${viewYear}`;
    
    const numDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    
    let activeDayElement = null;
    
    for (let d = 1; d <= numDays; d++) {
        const dateObj = new Date(viewYear, viewMonth, d);
        const dayName = weekdays[dateObj.getDay()];
        
        const formattedMonth = String(viewMonth + 1).padStart(2, '0');
        const formattedDay = String(d).padStart(2, '0');
        const dateStr = `${viewYear}-${formattedMonth}-${formattedDay}`;
        
        const count = deliveries.filter(item => item.order_date === dateStr).length;
        const active = dateStr === currentDate ? 'active' : '';
        
        const dayEl = document.createElement("div");
        dayEl.className = `calendar-day ${active}`;
        dayEl.onclick = () => selectDate(dateStr);
        
        dayEl.innerHTML = `
            <span class="calendar-day-name">${dayName}</span>
            <span class="calendar-day-number">${d}</span>
            ${count > 0 ? `<div class="calendar-dot" title="${count} pedidos"></div>` : ''}
        `;
        
        strip.appendChild(dayEl);
        
        if (active) {
            activeDayElement = dayEl;
        }
    }
    
    if (activeDayElement) {
        setTimeout(() => {
            activeDayElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }, 100);
    }
    
    const badge = document.getElementById("current-date-badge");
    if (badge) {
        const parts = currentDate.split('-');
        const monthsShort = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
        badge.textContent = `${parts[2]} ${monthsShort[parseInt(parts[1])-1]} ${parts[0]}`;
    }
}

function prevMonth() {
    viewMonth--;
    if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
    }
    renderCalendarStrip();
}

function nextMonth() {
    viewMonth++;
    if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
    }
    renderCalendarStrip();
}

async function selectDate(date) {
    currentDate = date;
    addSystemLog(`📅 Fecha seleccionada: ${currentDate}.`);
    
    await optimizeRouteByProximity(currentLocalidad, true);
    
    renderCalendarStrip();
}

// 3. Renderizado de Vistas
function renderContent() {
    const container = document.getElementById("main-app-content");
    container.innerHTML = "";

    if (currentTab === "deliveries") {
        renderDeliveriesView(container);
        initDragAndDrop();
    } else if (currentTab === "lifo") {
        renderLifoView(container);
    } else if (currentTab === "cash") {
        renderCashView(container);
    } else if (currentTab === "config") {
        renderConfigView(container);
    }
}

// 3.1. Funciones de Arrastre y Reordenamiento (Drag & Drop / Touch-Drag)
let draggedId = null;
let touchDraggedElement = null;
let touchStartY = 0;

function initDragAndDrop() {
    const lists = document.querySelectorAll('.delivery-list');
    lists.forEach(list => {
        const cards = list.querySelectorAll('.card');
        cards.forEach(card => {
            const statusPill = card.querySelector('.status-pill');
            const status = statusPill ? statusPill.textContent : '';
            if (status === 'Entregado') return;
            
            card.setAttribute('draggable', 'true');
            
            // Eventos HTML5 Drag & Drop (Escritorio)
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('dragend', handleDragEnd);
            
            // Eventos Touch (Móviles) vinculados al tirador drag-handle
            const handle = card.querySelector('.drag-handle');
            if (handle) {
                handle.addEventListener('touchstart', handleTouchStart, { passive: false });
                handle.addEventListener('touchmove', handleTouchMove, { passive: false });
                handle.addEventListener('touchend', handleTouchEnd);
            }
        });
    });
}

// Handlers HTML5 (Desktop)
function handleDragStart(e) {
    draggedId = this.getAttribute('data-id');
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
}

function handleDragOver(e) {
    e.preventDefault();
    const list = this.parentNode;
    const draggingElement = list.querySelector('.dragging');
    if (!draggingElement || draggingElement === this) return;
    
    if (this.parentNode !== draggingElement.parentNode) return;
    
    const rect = this.getBoundingClientRect();
    const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
    list.insertBefore(draggingElement, next ? this.nextSibling : this);
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    draggedId = null;
    saveNewOrder();
}

// Handlers Touch (Mobile)
function handleTouchStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    
    touchDraggedElement = this;
    touchDraggedElement.classList.add('dragging-touch');
    const touch = e.touches[0];
    touchStartY = touch.clientY;
    
    e.preventDefault();
}

function handleTouchMove(e) {
    if (!touchDraggedElement) return;
    
    const touch = e.touches[0];
    const currentY = touch.clientY;
    
    const elementUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elementUnderFinger) return;
    
    const hoverCard = elementUnderFinger.closest('.card');
    if (!hoverCard || hoverCard === touchDraggedElement) return;
    
    const list = touchDraggedElement.parentNode;
    if (hoverCard.parentNode !== list) return;
    
    const rect = hoverCard.getBoundingClientRect();
    const next = (currentY - rect.top) / (rect.bottom - rect.top) > 0.5;
    list.insertBefore(touchDraggedElement, next ? hoverCard.nextSibling : hoverCard);
    
    e.preventDefault();
}

function handleTouchEnd(e) {
    if (!touchDraggedElement) return;
    
    touchDraggedElement.classList.remove('dragging-touch');
    touchDraggedElement = null;
    saveNewOrder();
}

// Guardar el nuevo ordenamiento en Dexie / LocalStorage
async function saveNewOrder() {
    const pendingList = document.querySelector('.delivery-list:nth-of-type(2)');
    const activeList = document.querySelector('.delivery-list:nth-of-type(1)');
    
    let index = 0;
    
    if (activeList) {
        const activeCards = activeList.querySelectorAll('.card');
        activeCards.forEach(card => {
            const id = card.getAttribute('data-id');
            const delivery = deliveries.find(d => d.id === id);
            if (delivery) {
                delivery.sort_order = index * 10;
                delivery.sync_pending = true;
                index++;
            }
        });
    }
    
    if (pendingList) {
        const pendingCards = pendingList.querySelectorAll('.card');
        pendingCards.forEach(card => {
            const id = card.getAttribute('data-id');
            const delivery = deliveries.find(d => d.id === id);
            if (delivery) {
                delivery.sort_order = index * 10;
                delivery.sync_pending = true;
                index++;
            }
        });
    }
    
    deliveries.sort((a, b) => {
        if (a.localidad !== b.localidad) {
            return a.localidad.localeCompare(b.localidad);
        }
        if (a.status === 'ENTREGADO' && b.status !== 'ENTREGADO') return 1;
        if (a.status !== 'ENTREGADO' && b.status === 'ENTREGADO') return -1;
        
        const orderA = a.sort_order !== undefined ? a.sort_order : 999;
        const orderB = b.sort_order !== undefined ? b.sort_order : 999;
        return orderA - orderB;
    });
    
    await saveDeliveries();
    addSystemLog("📝 Reordenamiento manual guardado localmente.");
    
    renderLocalidades();
    renderContent();
}

// Vista de Domicilios
function renderDeliveriesView(container) {
    const filtered = deliveries
        .filter(d => d.localidad === currentLocalidad && d.order_date === currentDate)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        
    const activeRoute = filtered.filter(d => d.status === "EN_RUTA");
    const pending = filtered.filter(d => d.status === "PENDIENTE");
    const completed = filtered.filter(d => d.status === "ENTREGADO");

    const walletWidget = `
        <div class="wallet-widget">
            <div class="wallet-item">
                <div class="wallet-label">Recaudo Efectivo</div>
                <div class="wallet-val">$${currentShift.collected_cash.toLocaleString()}</div>
            </div>
            <div class="wallet-item">
                <div class="wallet-label">Comisión Hoy</div>
                <div class="wallet-val highlight">$${(deliveries.filter(d => d.status === "ENTREGADO" && d.order_date === currentShift.shift_date).length * 8000).toLocaleString()}</div>
            </div>
        </div>
    `;

    container.innerHTML += walletWidget;

    // Sección de Siguiente / En Ruta
    container.innerHTML += `
        <div class="section-title">
            <span>Despacho Activo</span>
            <span class="badge-count">${activeRoute.length}</span>
        </div>
    `;

    const activeList = document.createElement("div");
    activeList.className = "delivery-list";
    if (activeRoute.length === 0) {
        activeList.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-muted); font-size:13px;">No hay despachos activos en esta localidad.</div>`;
    } else {
        activeRoute.forEach(d => {
            activeList.appendChild(createDeliveryCard(d));
        });
    }
    container.appendChild(activeList);

    // Sección de Pendientes con botón de Auto-Ruta
    container.innerHTML += `
        <div class="section-title" style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
            <span>Pedidos Pendientes</span>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn" onclick="optimizeRouteByProximity('${currentLocalidad}')" style="padding: 4px 8px; font-size: 11px; height: 26px; border-radius: 8px; background: rgba(139, 92, 246, 0.1); border-color: rgba(139, 92, 246, 0.2); color: var(--primary); display: flex; align-items: center; gap: 4px; box-shadow: none;" title="Optimizar ruta por cercanía física">
                    ⚡ Auto-Ruta
                </button>
                <span class="badge-count">${pending.length}</span>
            </div>
        </div>
    `;

    const pendingList = document.createElement("div");
    pendingList.className = "delivery-list";
    if (pending.length === 0) {
        pendingList.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-muted); font-size:13px;">¡Todo listo! No hay pedidos pendientes.</div>`;
    } else {
        pending.forEach(d => {
            pendingList.appendChild(createDeliveryCard(d));
        });
    }
    container.appendChild(pendingList);

    // Sección de Entregados
    if (completed.length > 0) {
        container.innerHTML += `
            <div class="section-title" style="margin-top: 15px;">
                <span>Completados Hoy</span>
                <span class="badge-count">${completed.length}</span>
            </div>
        `;
        const completedList = document.createElement("div");
        completedList.className = "delivery-list";
        completed.forEach(d => {
            completedList.appendChild(createDeliveryCard(d));
        });
        container.appendChild(completedList);
    }
}

function createDeliveryCard(d) {
    const card = document.createElement("div");
    card.className = `card ${d.status === 'EN_RUTA' ? 'active-route' : ''}`;
    card.setAttribute('data-id', d.id);
    
    let statusClass = "pending";
    let statusLabel = "Pendiente";
    if (d.status === "EN_RUTA") {
        statusClass = "route";
        statusLabel = "En Ruta";
    } else if (d.status === "ENTREGADO") {
        statusClass = "delivered";
        statusLabel = "Entregado";
    }

    const prendasText = d.status === "ENTREGADO" 
        ? `📦 ${d.collected_items} prendas devueltas` 
        : `📦 ${d.expected_items} prendas esperadas`;

    card.innerHTML = `
        <div class="card-header">
            <div style="display:flex; align-items:center; gap:8px;">
                ${d.status !== 'ENTREGADO' ? `<div class="drag-handle" title="Arrastrar para ordenar">⋮⋮</div>` : ''}
                <div class="time-badge">
                    🕒 <span>${d.time_window}</span>
                </div>
            </div>
            <div class="status-pill ${statusClass}">${statusLabel}</div>
        </div>
        <div class="card-body">
            <div class="client-name">${d.client_name}</div>
            <div style="font-size:12px; font-weight:600; color:var(--secondary); margin-bottom: 2px;">
                ${prendasText}
            </div>
            <div class="address-box">
                <svg width="14" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>${d.address}</span>
            </div>
        </div>
        <div class="price-row">
            <div>
                <span class="pay-method">${d.pay_method}</span>
                ${d.sync_pending ? `<span style="font-size:10px; color:var(--warning); margin-left:8px;">🔄 Pendiente Nube</span>` : ''}
            </div>
            <div class="price-val">$${d.amount.toLocaleString()}</div>
        </div>
    `;

    if (d.status !== "ENTREGADO") {
        const actions = document.createElement("div");
        actions.className = "card-actions";
        
        let startButton = "";
        if (d.status === "PENDIENTE") {
            startButton = `
                <button class="btn btn-deliver" onclick="startRoute('${d.id}')">
                    🏍️ Iniciar Entrega (En Ruta)
                </button>
            `;
        } else {
            startButton = `
                <button class="btn btn-deliver" onclick="openConfirmModal('${d.id}')">
                    📦 Confirmar Recibido / Entrega
                </button>
            `;
        }

        actions.innerHTML = `
            <button class="btn btn-maps" onclick="openMaps('${d.address}')">
                🗺️ Maps / Waze
            </button>
            <button class="btn btn-chat" onclick="sendWhatsappNotification('${d.id}')">
                💬 WhatsApp
            </button>
            ${startButton}
        `;
        card.appendChild(actions);
    } else {
        const confirmationDetails = document.createElement("div");
        confirmationDetails.style.cssText = "font-size:12px; color:var(--success); border-top:1px solid var(--border); padding-top:10px; margin-top:4px; display:flex; justify-content:space-between;";
        confirmationDetails.innerHTML = `
            <span>✅ Entregado exitosamente</span>
            <span>Prenda: ${d.qr_code.split('-').pop()}</span>
        `;
        card.appendChild(confirmationDetails);
    }

    return card;
}

// Vista LIFO
function renderLifoView(container) {
    container.innerHTML = `
        <div class="lifo-guide">
            <h2 class="lifo-title">Guía de Carga Inteligente (LIFO)</h2>
            <p style="font-size:13px; color:var(--text-muted); line-height:1.4; text-align:center; margin-bottom:15px;">
                Carga tu maleta en el siguiente orden. Lo primero que entregarás debe ir arriba (al final de la carga), y lo último abajo (al fondo).
            </p>
            <div class="lifo-container">
                <div class="maleta-draw" id="maleta-items-container"></div>
            </div>
        </div>
    `;

    const itemsContainer = document.getElementById("maleta-items-container");
    const sorted = [...deliveries]
        .filter(d => d.status !== "ENTREGADO" && d.order_date === currentDate)
        .sort((a, b) => {
            // Priorizar la localidad activa actual (currentLocalidad) para que vaya arriba (se entrega primero)
            const aActive = a.localidad === currentLocalidad ? 0 : 1;
            const bActive = b.localidad === currentLocalidad ? 0 : 1;
            
            if (aActive !== bActive) {
                return aActive - bActive;
            }
            return (a.sort_order || 0) - (b.sort_order || 0);
        });

    if (sorted.length === 0) {
        itemsContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">No hay pedidos para cargar hoy.</div>`;
        return;
    }

    sorted.forEach((d, index) => {
        const item = document.createElement("div");
        item.className = "maleta-item";
        const posLabel = index === 0 ? "ARRIBA (FÁCIL ACCESO)" : (index === sorted.length - 1 ? "FONDO MALETA" : `POSICIÓN ${sorted.length - index}`);
        item.innerHTML = `
            <div>
                <div style="font-weight:600; font-size:14px;">${d.client_name}</div>
                <div style="font-size:12px; color:var(--text-muted);">${d.localidad} - ${d.time_window} (${d.expected_items} prendas)</div>
            </div>
            <span class="maleta-label-pos" style="background:${index === 0 ? 'var(--secondary)' : 'var(--primary)'}">${posLabel}</span>
        `;
        itemsContainer.appendChild(item);
    });
}

// Vista de Caja
function renderCashView(container) {
    const shiftClosed = currentShift.status === "CERRADO";
    
    container.innerHTML = `
        <div class="cash-module">
            <h2 class="lifo-title">Módulo de Caja y Viáticos</h2>
            
            <div class="wallet-widget" style="margin-bottom:10px;">
                <div class="wallet-item">
                    <div class="wallet-label">Base Inicial</div>
                    <div class="wallet-val">$${currentShift.initial_cash.toLocaleString()}</div>
                </div>
                <div class="wallet-item">
                    <div class="wallet-label">Gastos Registrados</div>
                    <div class="wallet-val" style="color:var(--danger)">$${currentShift.expenses.toLocaleString()}</div>
                </div>
            </div>

            <div class="wallet-widget" style="background:linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.02) 100%);">
                <div class="wallet-item">
                    <div class="wallet-label">Total Recaudo</div>
                    <div class="wallet-val highlight">$${currentShift.collected_cash.toLocaleString()}</div>
                </div>
                <div class="wallet-item">
                    <div class="wallet-label">Balance Neto Caja</div>
                    <div class="wallet-val" style="color:var(--text-main)">$${(currentShift.initial_cash + currentShift.collected_cash - currentShift.expenses).toLocaleString()}</div>
                </div>
            </div>

            ${shiftClosed ? `
                <div style="background:rgba(16, 185, 129, 0.15); border:1px solid var(--success); border-radius:16px; padding:15px; text-align:center; color:var(--success); font-weight:600;">
                    🔒 Turno Cerrado Exitosamente. Cuentas conciliadas.
                </div>
            ` : `
                <div class="form-group" style="margin-top:10px;">
                    <label>Registrar Gasto (Gasolina / Peaje / Viático)</label>
                    <div style="display:flex; gap:8px;">
                        <input type="number" id="cash-expense-amount" class="input-text" placeholder="Monto $" style="flex:1;">
                        <button class="btn btn-confirm" onclick="registerExpense()" style="width:90px; box-shadow:none;">
                            Añadir
                        </button>
                    </div>
                </div>

                <button class="btn btn-deliver" onclick="closeShift()" style="background:var(--danger); box-shadow:0 4px 15px rgba(239, 68, 68, 0.3); margin-top:20px; font-weight:bold;">
                    🔒 Cerrar Caja y Entregar Turno
                </button>
            `}
        </div>
    `;
}

// Vista de Configuración
function renderConfigView(container) {
    const isGlass = document.body.classList.contains("theme-glass");
    const supabaseUrl = localStorage.getItem("supabase-url") || "";
    const supabaseKey = localStorage.getItem("supabase-key") || "";

    container.innerHTML = `
        <div class="cash-module" style="gap:10px;">
            <h2 class="lifo-title">Configuración de la App</h2>
            
            <div class="form-group">
                <label>Tema Visual</label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <button class="btn ${!isGlass ? 'btn-confirm' : ''}" onclick="changeThemeMode('theme-dark')" style="box-shadow:none;">
                        🌑 Dark
                    </button>
                    <button class="btn ${isGlass ? 'btn-confirm' : ''}" onclick="changeThemeMode('theme-glass')" style="box-shadow:none;">
                        🫧 Glass
                    </button>
                </div>
            </div>

            <div class="form-group" style="border-top:1px solid var(--border); padding-top:10px;">
                <label>Configurar Supabase Cloud (Idempotencia & Sync)</label>
                <input type="text" id="cfg-supabase-url" class="input-text" placeholder="https://tu-proyecto.supabase.co" value="${supabaseUrl}" style="margin-bottom:6px; font-size:12px; padding:10px;">
                <input type="password" id="cfg-supabase-key" class="input-text" placeholder="Anon / Service Key" value="${supabaseKey}" style="margin-bottom:8px; font-size:12px; padding:10px;">
                <button class="btn btn-confirm" onclick="saveSupabaseCredentials()" style="padding:10px; font-weight:600;">
                    💾 Guardar Credenciales
                </button>
            </div>

            <div class="form-group" style="border-top:1px solid var(--border); padding-top:10px;">
                <label>Consola de Sincronización y Logs</label>
                <div class="sync-console" id="sync-console-logs"></div>
            </div>

            <div class="form-group" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <button class="btn btn-maps" onclick="syncDataOffline()" style="padding:10px; font-weight:600; font-size:12px;">
                    🔄 Sincronizar
                </button>
                <button class="btn btn-cancel" onclick="resetDatabase()" style="color:var(--danger); border-color:rgba(239, 68, 68, 0.2); font-size:12px; padding:10px;">
                    Restaurar
                </button>
            </div>
        </div>
    `;

    const consoleEl = document.getElementById("sync-console-logs");
    if (consoleEl) {
        consoleEl.innerHTML = logs.map(l => `<div>${l}</div>`).join('');
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

// 3.5. Algoritmo de Optimización de Ruta por Proximidad (Nearest Neighbor / Vecino Más Cercano)
function getHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

async function optimizeRouteByProximity(localidad, silent = false) {
    addSystemLog(`⚡ Iniciando optimización de ruta para ${localidad}...`);
    
    // Punto de partida inicial: Lavaseco Orquídeas base (Usaquén)
    let startLat = 4.7011;
    let startLng = -74.0330;
    
    // Si la localidad es Suba, centrar el punto de partida en Suba
    if (localidad === 'Suba') {
        startLat = 4.7250;
        startLng = -74.0850;
    }
    
    // Intentar capturar la ubicación GPS del repartidor para optimizar desde su posición actual
    if (navigator.geolocation) {
        try {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 2000, enableHighAccuracy: true });
            });
            startLat = position.coords.latitude;
            startLng = position.coords.longitude;
            addSystemLog(`📡 GPS: Ruta se optimizará desde tu ubicación actual (${startLat.toFixed(5)}, ${startLng.toFixed(5)}).`);
        } catch (e) {
            addSystemLog(`📡 GPS: No disponible o rechazado. Usando base de Lavaseco.`);
        }
    }
    
    // Filtrar los pedidos no completados en la localidad activa para la fecha actual
    let pendingLoc = deliveries.filter(d => d.localidad === localidad && d.status !== 'ENTREGADO' && d.order_date === currentDate);
    if (pendingLoc.length <= 1) {
        if (!silent) {
            addSystemLog("ℹ️ No hay suficientes pedidos pendientes para optimizar.");
            alert("ℹ️ No hay suficientes pedidos pendientes para optimizar la ruta.");
        }
        return;
    }
    
    // Encontrar si hay un pedido en ruta
    let activeRouteDeliv = pendingLoc.find(d => d.status === 'EN_RUTA');
    let unvisited = pendingLoc.filter(d => d.status !== 'EN_RUTA');
    let orderedRoute = [];
    
    let currentLat = startLat;
    let currentLng = startLng;
    
    // Si hay un pedido activo "EN_RUTA", debe ser la primera parada
    if (activeRouteDeliv) {
        orderedRoute.push(activeRouteDeliv);
        currentLat = activeRouteDeliv.latitude !== undefined && activeRouteDeliv.latitude !== null ? activeRouteDeliv.latitude : startLat;
        currentLng = activeRouteDeliv.longitude !== undefined && activeRouteDeliv.longitude !== null ? activeRouteDeliv.longitude : startLng;
        addSystemLog(`🏍️ Priorizando despacho activo para ${activeRouteDeliv.client_name} como primera parada.`);
    }
    
    // Algoritmo Nearest Neighbor (Vecino más cercano) para los demás
    while (unvisited.length > 0) {
        let nearestIdx = -1;
        let minDistance = Infinity;
        
        for (let i = 0; i < unvisited.length; i++) {
            const d = unvisited[i];
            const lat = d.latitude !== undefined && d.latitude !== null ? d.latitude : startLat;
            const lng = d.longitude !== undefined && d.longitude !== null ? d.longitude : startLng;
            
            const dist = getHaversineDistance(currentLat, currentLng, lat, lng);
            if (dist < minDistance) {
                minDistance = dist;
                nearestIdx = i;
            }
        }
        
        if (nearestIdx !== -1) {
            const nextDeliv = unvisited.splice(nearestIdx, 1)[0];
            orderedRoute.push(nextDeliv);
            currentLat = nextDeliv.latitude !== undefined && nextDeliv.latitude !== null ? nextDeliv.latitude : startLat;
            currentLng = nextDeliv.longitude !== undefined && nextDeliv.longitude !== null ? nextDeliv.longitude : startLng;
        } else {
            break;
        }
    }
    
    // Asignar el nuevo sort_order secuencial (0, 10, 20...) a los elementos ordenados
    orderedRoute.forEach((d, idx) => {
        const item = deliveries.find(orig => orig.id === d.id);
        if (item) {
            item.sort_order = idx * 10;
            item.sync_pending = true;
        }
    });
    
    // Asignar orden final a los completados para que queden abajo
    let completedLoc = deliveries.filter(d => d.localidad === localidad && d.status === 'ENTREGADO' && d.order_date === currentDate);
    completedLoc.forEach((d, idx) => {
        d.sort_order = (orderedRoute.length + idx) * 10;
    });
    
    // Ordenar el array general de entregas para persistir consistencia
    deliveries.sort((a, b) => {
        if (a.localidad !== b.localidad) {
            return a.localidad.localeCompare(b.localidad);
        }
        if (a.status === 'ENTREGADO' && b.status !== 'ENTREGADO') return 1;
        if (a.status !== 'ENTREGADO' && b.status === 'ENTREGADO') return -1;
        
        const orderA = a.sort_order !== undefined ? a.sort_order : 999;
        const orderB = b.sort_order !== undefined ? b.sort_order : 999;
        return orderA - orderB;
    });
    
    await saveDeliveries();
    addSystemLog(`✅ Ruta de ${localidad} optimizada con éxito.`);
    
    renderLocalidades();
    renderContent();
    
    if (!silent) {
        alert("⚡ ¡Ruta optimizada por proximidad con éxito!");
    }
}

// 4. Acciones de Entregas
async function startRoute(id) {
    const delivery = deliveries.find(d => d.id === id);
    if (delivery) {
        deliveries.forEach(d => {
            if (d.status === "EN_RUTA" && d.id !== id) {
                d.status = "PENDIENTE";
                d.sync_pending = true;
            }
        });
        delivery.status = "EN_RUTA";
        delivery.sync_pending = true;
        
        await saveDeliveries();
        addSystemLog(`🏍️ Ruta iniciada para ${delivery.client_name}. Estado actualizado.`);
        renderContent();
        triggerBackgroundSync();
    }
}

function openMaps(address) {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    window.open(url, '_blank');
}

function sendWhatsappNotification(id) {
    const d = deliveries.find(d => d.id === id);
    if (d) {
        const msg = `Hola ${d.client_name}, soy tu repartidor de Lavaseco Orquídeas. Ya voy en camino a tu dirección: ${d.address}. Estaré allí en unos 10 minutos.`;
        const url = `https://wa.me/${d.client_phone}?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
        addSystemLog(`💬 Notificación de WhatsApp enviada a ${d.client_name}.`);
    }
}

// 5. Canvas de Firma y Simuladores del Modal
let isQRScanActive = false;
let isPhotoCaptured = false;

function initSignatureCanvasEvents() {
    signatureCanvas = document.getElementById("signature-pad");
    if (!signatureCanvas) return;
    signatureCtx = signatureCanvas.getContext("2d");

    // Ajustar dimensiones del canvas físicamente al tamaño del elemento
    signatureCanvas.width = signatureCanvas.offsetWidth;
    signatureCanvas.height = signatureCanvas.offsetHeight;

    signatureCtx.strokeStyle = "var(--text-main)";
    signatureCtx.lineWidth = 3;
    signatureCtx.lineJoin = "round";
    signatureCtx.lineCap = "round";

    // Mouse Events
    signatureCanvas.addEventListener("mousedown", (e) => {
        isDrawing = true;
        hasSigned = true;
        signatureCtx.beginPath();
        const pos = getCanvasPos(e);
        signatureCtx.moveTo(pos.x, pos.y);
    });
    signatureCanvas.addEventListener("mousemove", (e) => {
        if (!isDrawing) return;
        const pos = getCanvasPos(e);
        signatureCtx.lineTo(pos.x, pos.y);
        signatureCtx.stroke();
        updateCompleteButtonState(); // Actualizar estado del botón en cada trazo
    });
    signatureCanvas.addEventListener("mouseup", () => { isDrawing = false; });
    signatureCanvas.addEventListener("mouseleave", () => { isDrawing = false; });

    // Touch Events (Celular)
    signatureCanvas.addEventListener("touchstart", (e) => {
        isDrawing = true;
        hasSigned = true;
        signatureCtx.beginPath();
        const touch = e.touches[0];
        const pos = getCanvasPos(touch);
        signatureCtx.moveTo(pos.x, pos.y);
        e.preventDefault();
    });
    signatureCanvas.addEventListener("touchmove", (e) => {
        if (!isDrawing) return;
        const touch = e.touches[0];
        const pos = getCanvasPos(touch);
        signatureCtx.lineTo(pos.x, pos.y);
        signatureCtx.stroke();
        updateCompleteButtonState();
        e.preventDefault();
    });
    signatureCanvas.addEventListener("touchend", () => { isDrawing = false; });
}

function getCanvasPos(e) {
    const rect = signatureCanvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function clearSignatureCanvas() {
    if (signatureCtx && signatureCanvas) {
        signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
        hasSigned = false;
        updateCompleteButtonState();
    }
}

// Simulador de Scanner QR
function startQRScan() {
    const btn = document.getElementById("qr-scan-btn");
    const screen = document.getElementById("qr-scanner-screen");
    if (!btn || !screen) return;

    btn.style.display = "none";
    screen.style.display = "block";
    addSystemLog("📷 Activando cámara. Buscando código QR...");

    setTimeout(() => {
        screen.style.display = "none";
        btn.style.display = "block";
        btn.innerHTML = "✅ QR Prenda Validado";
        btn.style.color = "var(--success)";
        btn.style.borderColor = "var(--success)";
        isQRScanActive = true;
        
        const d = deliveries.find(d => d.id === currentActiveDeliveryId);
        const code = d ? d.qr_code : "Desconocido";
        addSystemLog(`✅ Código QR de Prenda validado exitosamente: ${code}`);
        
        updateCompleteButtonState(); // Actualizar botón
    }, 2000);
}

// Simulador de Cámara
function takeDeliveryPhotoSim() {
    const placeholder = document.getElementById("photo-upload-placeholder");
    const preview = document.getElementById("photo-preview-box");
    if (!placeholder || !preview) return;

    const mockPhoto = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200' viewBox='0 0 400 200'><rect width='400' height='200' fill='%231C2331'/><rect x='130' y='40' width='140' height='120' fill='%238B5CF6' rx='10'/><path d='M130 70 L200 110 L270 70' stroke='%237C3AED' stroke-width='4' fill='none'/><circle cx='200' cy='100' r='25' fill='%2306B6D4' opacity='0.8'/><text x='200' y='165' fill='%23F3F4F6' font-size='14' font-weight='bold' font-family='sans-serif' text-anchor='middle'>EVIDENCIA ENTREGADA</text></svg>";

    placeholder.style.display = "none";
    preview.src = mockPhoto;
    preview.style.display = "block";
    isPhotoCaptured = true;
    addSystemLog("📷 Captura de foto de evidencia completada.");
    
    updateCompleteButtonState(); // Actualizar botón
}

// Controlar habilitación del botón Completar
function updateCompleteButtonState() {
    const btn = document.getElementById("btn-complete-delivery");
    if (!btn) return;

    if (isQRScanActive && isPhotoCaptured && hasSigned) {
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
        btn.style.background = "var(--success)";
        btn.style.boxShadow = "0 4px 15px var(--success-glow)";
    } else {
        btn.style.opacity = "0.4";
        btn.style.pointerEvents = "none";
        btn.style.background = "#666";
        btn.style.boxShadow = "none";
    }
}

// Funciones de Conteo de Prendas
function adjustItemCount(direction) {
    const display = document.getElementById("modal-items-count-display");
    const expectedInfo = document.getElementById("modal-expected-items-info");
    const d = deliveries.find(d => d.id === currentActiveDeliveryId);
    if (!d || !display) return;

    currentCollectedItemsCount += direction;
    if (currentCollectedItemsCount < 1) {
        currentCollectedItemsCount = 1;
    }

    display.textContent = currentCollectedItemsCount;

    if (currentCollectedItemsCount !== d.expected_items) {
        display.style.color = "var(--warning)";
        display.style.textShadow = "0 0 10px rgba(245, 158, 11, 0.3)";
        expectedInfo.style.color = "var(--warning)";
        expectedInfo.textContent = `⚠️ Discrepancia: Bot dice ${d.expected_items} | Domiciliario contó ${currentCollectedItemsCount}`;
    } else {
        display.style.color = "";
        display.style.textShadow = "";
        expectedInfo.style.color = "";
        expectedInfo.textContent = `Esperadas según chatbot: ${d.expected_items} prendas`;
    }
}

// Abrir modal
function openConfirmModal(id) {
    currentActiveDeliveryId = id;
    const d = deliveries.find(d => d.id === id);
    if (d) {
        document.getElementById('modal-client-name').textContent = "Entrega: " + d.client_name;
        document.getElementById('modal-amount').textContent = "$" + d.amount.toLocaleString();
        
        // CORRECCIÓN BUG UNDEFINED:
        // Aseguramos que si d.expected_items es undefined (datos viejos), usemos 1 como base.
        // Pero gracias a la migración automática de initApp, esto ya estará corregido preventivamente.
        const prendasEsperadas = d.expected_items || 1;
        currentCollectedItemsCount = d.collected_items || prendasEsperadas;
        
        const display = document.getElementById("modal-items-count-display");
        const expectedInfo = document.getElementById("modal-expected-items-info");
        
        if (display) {
            display.textContent = currentCollectedItemsCount;
            display.style.color = "";
            display.style.textShadow = "";
        }
        if (expectedInfo) {
            expectedInfo.style.color = "";
            expectedInfo.textContent = `Esperadas según chatbot: ${prendasEsperadas} prendas`;
        }

        // Resetear simuladores
        isQRScanActive = false;
        isPhotoCaptured = false;
        hasSigned = false;
        updateCompleteButtonState();

        const btn = document.getElementById("qr-scan-btn");
        if (btn) {
            btn.style.display = "block";
            btn.innerHTML = "📷 Iniciar Scanner de Prenda";
            btn.style.color = "";
            btn.style.borderColor = "";
        }
        
        const screen = document.getElementById("qr-scanner-screen");
        if (screen) screen.style.display = "none";

        const placeholder = document.getElementById("photo-upload-placeholder");
        if (placeholder) placeholder.style.display = "flex";
        
        const preview = document.getElementById("photo-preview-box");
        if (preview) {
            preview.style.display = "none";
            preview.src = "";
        }

        document.getElementById('confirm-modal').style.display = 'flex';
        
        setTimeout(initSignatureCanvasEvents, 100);
    }
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    currentActiveDeliveryId = null;
}

async function confirmDelivery() {
    const d = deliveries.find(d => d.id === currentActiveDeliveryId);
    if (d) {
        d.status = "ENTREGADO";
        d.evidence_photo = "foto_evidencia.png";
        d.signature_drawn = true;
        d.collected_items = currentCollectedItemsCount;
        d.sync_pending = true;

        if (d.expected_items !== d.collected_items) {
            addSystemLog(`⚠️ ALERTA: Discrepancia física en ${d.client_name}. Chatbot: ${d.expected_items} | Domiciliario: ${d.collected_items}.`);
        }

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async (position) => {
                d.latitude = position.coords.latitude;
                d.longitude = position.coords.longitude;
                addSystemLog(`🗺️ Coordenadas capturadas: ${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`);
                await saveDeliveries();
                triggerBackgroundSync();
            });
        }
        
        await saveDeliveries();
        recalculateShiftCash();
        closeConfirmModal();
        renderLocalidades();
        renderContent();
        
        triggerBackgroundSync();
        addSystemLog(`🎉 Pedido de ${d.client_name} completado con éxito.`);
        alert("🎉 ¡Despacho completado con éxito!");
    }
}

// 6. Gestión Financiera
function recalculateShiftCash() {
    const cashCollected = deliveries
        .filter(d => d.status === "ENTREGADO" && d.pay_method === "Efectivo" && d.order_date === currentShift.shift_date)
        .reduce((sum, d) => sum + d.amount, 0);
        
    currentShift.collected_cash = cashCollected;
    currentShift.sync_pending = true;
    saveShift();
}

async function registerExpense() {
    const amtInput = document.getElementById("cash-expense-amount");
    const amount = parseFloat(amtInput.value);
    
    if (isNaN(amount) || amount <= 0) {
        alert("⚠️ Ingrese un monto de gasto válido.");
        return;
    }

    currentShift.expenses += amount;
    currentShift.sync_pending = true;
    amtInput.value = "";
    
    await saveShift();
    addSystemLog(`💵 Gasto registrado: $${amount.toLocaleString()}. Balance actualizado.`);
    renderContent();
    triggerBackgroundSync();
    alert("✅ Gasto registrado en caja.");
}

async function closeShift() {
    if (confirm("¿Está seguro que desea cerrar la caja del turno?")) {
        currentShift.status = "CERRADO";
        currentShift.sync_pending = true;
        await saveShift();
        addSystemLog("🔒 Turno cerrado y conciliado por el domiciliario.");
        renderContent();
        triggerBackgroundSync();
        alert("🔒 Turno cerrado.");
    }
}

// 7. Configuración e Integraciones Offline / Supabase
function saveSupabaseCredentials() {
    const url = document.getElementById("cfg-supabase-url").value.trim();
    const key = document.getElementById("cfg-supabase-key").value.trim();
    
    localStorage.setItem("supabase-url", url);
    localStorage.setItem("supabase-key", key);
    
    initSupabase();
    alert("💾 Credenciales guardadas. Intentando conectar a la nube...");
    triggerBackgroundSync();
}

function changeThemeMode(theme) {
    setTheme(theme);
    localStorage.setItem("app-theme", theme);
    renderContent();
}

function setTheme(theme) {
    if (theme === "theme-glass") {
        document.body.className = "theme-glass";
    } else {
        document.body.className = "theme-dark";
    }
}

// Sincronización en segundo plano con Supabase
let isSyncing = false;
async function runBackgroundSync() {
    if (!supabaseClient || isSyncing) return;
    isSyncing = true;
    
    addSystemLog("🔄 Sync: Verificando datos locales pendientes de subir...");
    
    try {
        if (db) {
            const pendingDeliveries = await db.deliveries.toArray();
            const pendingList = pendingDeliveries.filter(d => d.sync_pending === true || d.sync_pending === 1);
                
            for (const d of pendingList) {
                addSystemLog(`🔄 Sync: Subiendo entrega de ${d.client_name}...`);
                const payload = {
                    chatbot_order_id: d.qr_code, 
                    client_name: d.client_name,
                    client_phone: d.client_phone,
                    delivery_address: d.address,
                    localidad: d.localidad,
                    time_window: d.time_window,
                    amount: d.amount,
                    pay_method: d.pay_method,
                    status: d.status,
                    qr_code: d.qr_code,
                    expected_items: d.expected_items,
                    collected_items: d.collected_items,
                    signature_drawn: d.signature_drawn,
                    latitude: d.latitude || null,
                    longitude: d.longitude || null
                };
                
                const { error } = await supabaseClient.from('deliveries').upsert(payload);
                if (!error) {
                    d.sync_pending = false;
                    await db.deliveries.put(d);
                    addSystemLog(`✅ Sync: Entrega ${d.client_name} subida de forma idempotente.`);
                } else {
                    addSystemLog(`❌ Sync Error en entrega: ${error.message}`);
                }
            }
            
            const storedShift = await db.shift.get("shift_today");
            if (storedShift && storedShift.sync_pending) {
                addSystemLog("🔄 Sync: Sincronizando estado de caja...");
                const payload = {
                    driver_id: (await supabaseClient.auth.getUser()).data.user?.id || null,
                    shift_date: storedShift.shift_date,
                    initial_cash: storedShift.initial_cash,
                    collected_cash: storedShift.collected_cash,
                    expenses: storedShift.expenses,
                    status: storedShift.status
                };
                
                if (payload.driver_id) {
                    const { error } = await supabaseClient.from('driver_shifts').upsert(payload, { onConflict: 'driver_id, shift_date' });
                    if (!error) {
                        storedShift.sync_pending = false;
                        await db.shift.put(storedShift);
                        addSystemLog("✅ Sync: Caja sincronizada exitosamente.");
                    } else {
                        addSystemLog(`❌ Sync Error en caja: ${error.message}`);
                    }
                }
            }
        }
    } catch (e) {
        addSystemLog("❌ Sync Error de red: " + e.message);
    } finally {
        isSyncing = false;
    }
}

function triggerBackgroundSync() {
    runBackgroundSync();
}

async function syncDataOffline() {
    if (!supabaseClient) {
        alert("⚠️ Configure las credenciales de Supabase en Configuración antes de sincronizar.");
        return;
    }
    
    addSystemLog("🔄 Sincronización manual iniciada por usuario...");
    await runBackgroundSync();
    
    try {
        const { data, error } = await supabaseClient
            .from('deliveries')
            .select('*')
            .eq('delivery_date', '2026-06-18');
            
        if (!error && data) {
            addSystemLog(`✅ Sync: Descargados ${data.length} pedidos de Supabase.`);
            for (const item of data) {
                const mapped = {
                    id: item.id,
                    client_name: item.client_name,
                    client_phone: item.client_phone,
                    address: item.delivery_address,
                    localidad: item.localidad,
                    time_window: item.time_window,
                    amount: item.amount,
                    pay_method: item.pay_method,
                    status: item.status,
                    qr_code: item.qr_code,
                    expected_items: item.expected_items,
                    collected_items: item.collected_items,
                    evidence_photo: item.evidence_photo_url,
                    signature_drawn: item.signature_drawn,
                    order_date: item.delivery_date,
                    sync_pending: false
                };
                if (db) {
                    await db.deliveries.put(mapped);
                }
            }
            
            if (db) {
                deliveries = await db.deliveries.toArray();
            }
            renderLocalidades();
            renderContent();
            alert("✅ Sincronización manual completada.");
        } else if (error) {
            addSystemLog("❌ Sync: Error al descargar: " + error.message);
        }
    } catch (e) {
        addSystemLog("❌ Sync: Error al descargar (Red): " + e.message);
    }
}

async function resetDatabase() {
    if (confirm("¿Desea restaurar los datos iniciales?")) {
        if (db) {
            await db.deliveries.clear();
            await db.shift.clear();
        }
        localStorage.clear();
        window.location.reload();
    }
}

// 8. Helpers de persistencia
async function saveDeliveries() {
    if (db) {
        for (const d of deliveries) {
            await db.deliveries.put(d);
        }
    } else {
        localStorage.setItem("deliveries", JSON.stringify(deliveries));
    }
}

async function saveShift() {
    if (db) {
        await db.shift.put(currentShift);
    } else {
        localStorage.setItem("shift", JSON.stringify(currentShift));
    }
}

// 9. Navegación
function selectNavbarTab(element, tab) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    currentTab = tab;
    renderContent();
}

async function selectLocalidadTab(element, name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    element.classList.add('active');
    currentLocalidad = name;
    
    // Auto-optimizar la ruta de la localidad seleccionada de forma silenciosa
    await optimizeRouteByProximity(currentLocalidad, true);
}

function renderTabs() {
    const navBar = document.querySelector(".nav-bar");
    if (!navBar) return;
    navBar.innerHTML = `
        <div class="nav-item ${currentTab === 'deliveries' ? 'active' : ''}" onclick="selectNavbarTab(this, 'deliveries')">
            <span style="font-size: 20px;">📋</span>
            <span>Entregas</span>
        </div>
        <div class="nav-item ${currentTab === 'lifo' ? 'active' : ''}" onclick="selectNavbarTab(this, 'lifo')">
            <span style="font-size: 20px;">🎒</span>
            <span>Guía Carga</span>
        </div>
        <div class="nav-item ${currentTab === 'cash' ? 'active' : ''}" onclick="selectNavbarTab(this, 'cash')">
            <span style="font-size: 20px;">💵</span>
            <span>Caja</span>
        </div>
        <div class="nav-item ${currentTab === 'config' ? 'active' : ''}" onclick="selectNavbarTab(this, 'config')">
            <span style="font-size: 20px;">⚙️</span>
            <span>Config</span>
        </div>
    `;
}

function renderLocalidades() {
    const selector = document.querySelector(".localidad-selector");
    if (!selector) return;
    selector.innerHTML = "";
    
    const allDeliveries = deliveries.length > 0 ? deliveries : DEFAULT_DELIVERIES;
    const localidades = [...new Set(allDeliveries.map(d => d.localidad))];
    if (localidades.length === 0) {
        localidades.push("Usaquén");
    }
    
    localidades.forEach((loc) => {
        const count = allDeliveries.filter(d => d.localidad === loc && d.order_date === currentDate && d.status !== 'ENTREGADO').length;
        const active = loc === currentLocalidad ? 'active' : '';
        const tab = document.createElement("div");
        tab.className = `tab ${active}`;
        tab.textContent = `${loc} (${count})`;
        tab.onclick = () => selectLocalidadTab(tab, loc);
        selector.appendChild(tab);
    });
}

window.addEventListener("DOMContentLoaded", initApp);
