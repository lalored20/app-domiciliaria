/* SYSTEMA ANTIGRAVITY v4.5: MOTOR DE LÓGICA DE NEGOCIO (Corrección de navegador y app domiciliaria) */

// 1. IndexedDB/Dexie DESACTIVADO - La app funciona 100% con LocalStorage + Express Server
// Razón: IndexedDB se congela indefinidamente en Chrome normal (no incógnito) para localhost,
// causando crash del navegador. LocalStorage + sync con servidor es suficiente y estable.
let db = null;


// Datos de prueba iniciales
const DEFAULT_DELIVERIES = [];

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

// Helper para prevenir bloqueos de IndexedDB/Dexie mediante un límite de tiempo
function promiseWithTimeout(promise, ms, timeoutErrorMsg) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(timeoutErrorMsg || "Promise timed out"));
        }, ms);
        
        promise.then(
            (res) => {
                clearTimeout(timer);
                resolve(res);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    });
}

// Estado
let deliveries = [];
let currentLocalidad = "Usaquén";
let currentTab = "deliveries";
let currentActiveDeliveryId = null;
let currentCollectedItemsCount = 1;
let currentCollectedItemsCommentsMap = {};

function getTodayDateString() {
    try {
        const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
        const formatter = new Intl.DateTimeFormat('fr-CA', options); // 'fr-CA' outputs YYYY-MM-DD
        const formatted = formatter.format(new Date());
        if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
            return formatted;
        }
    } catch (e) {
        console.warn("Intl.DateTimeFormat America/Bogota failed, falling back to manual offset math:", e);
    }
    
    try {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        // Bogotá es UTC-5
        const bogotaDate = new Date(utc + (3600000 * -5));
        const yyyy = bogotaDate.getFullYear();
        const mm = String(bogotaDate.getMonth() + 1).padStart(2, '0');
        const dd = String(bogotaDate.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    } catch (err) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }
}

const todayDateStr = getTodayDateString();

let currentShift = {
    id: "shift_today",
    driver_name: "Ramón Mendoza",
    initial_cash: 50000,
    collected_cash: 0,
    expenses: 0,
    expenses_detail: [],
    status: "ABIERTO",
    shift_date: todayDateStr,
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

    // Purgar datos ficticios residuales si existen en Dexie (IDs que empiezan por "d", "test_" o "web_")
    if (db) {
        try {
            const keys = await promiseWithTimeout(db.deliveries.toCollection().primaryKeys(), 1500, "Dexie primaryKeys timeout");
            const mockKeys = keys.filter(k => typeof k === 'string' && (/^d\d+$/.test(k) || k.startsWith('test_') || k.startsWith('web_')));
            if (mockKeys.length > 0) {
                await promiseWithTimeout(db.deliveries.bulkDelete(mockKeys), 1500, "Dexie bulkDelete timeout");
                addSystemLog(`🧹 Limpiados ${mockKeys.length} registros ficticios residuales de IndexedDB.`);
            }
        } catch (e) {
            console.warn("Fallo purgando datos ficticios residuales de IndexedDB:", e);
        }
    }

    // Purgar datos ficticios residuales de LocalStorage
    const cachedLoc = localStorage.getItem("deliveries");
    if (cachedLoc) {
        try {
            let cachedList = JSON.parse(cachedLoc);
            const originalLen = cachedList.length;
            cachedList = cachedList.filter(d => !(typeof d.id === 'string' && (/^d\d+$/.test(d.id) || d.id.startsWith('test_') || d.id.startsWith('web_'))));
            if (cachedList.length !== originalLen) {
                localStorage.setItem("deliveries", JSON.stringify(cachedList));
                addSystemLog("🧹 Limpiados registros ficticios residuales de LocalStorage.");
            }
        } catch (e) {
            console.error("Error al procesar LocalStorage cached deliveries:", e);
        }
    }

    // Intentar leer de base de datos local Dexie
    if (db) {
        try {
            // Cargar entregas reales guardadas en IndexedDB
            deliveries = await promiseWithTimeout(db.deliveries.toArray(), 1500, "Dexie deliveries.toArray timeout");
            if (Array.isArray(deliveries)) {
                deliveries = deliveries.filter(item => item && typeof item === 'object');
            } else {
                deliveries = [];
            }

            // Saneamiento de coordenadas de fallback residuales locales
            const fallbackLats = [4.7011, 4.7250, 4.6675, 4.6432, 4.6669, 4.7012, 4.6738, 4.6307, 4.6186, 4.6205, 4.4600, 4.5300, 4.5600];
            let needsReload = false;
            for (const d of deliveries) {
                if (d && d.latitude && fallbackLats.some(f => Math.abs(f - d.latitude) < 0.001)) {
                    d.latitude = null;
                    d.longitude = null;
                    d.sync_pending = false; // Evitar subir el null erróneamente al servidor
                    await promiseWithTimeout(db.deliveries.put(d), 1000, "Dexie put timeout");
                    needsReload = true;
                }
            }
            if (needsReload) {
                deliveries = await promiseWithTimeout(db.deliveries.toArray(), 1500, "Dexie deliveries.toArray reload timeout");
                addSystemLog("🧹 Limpiadas coordenadas de fallback locales en IndexedDB.");
            }
            
            // Inicializar turno si no existe o cargar
            const storedShift = await promiseWithTimeout(db.shift.get("shift_today"), 1500, "Dexie shift.get timeout");
            if (storedShift && typeof storedShift === 'object') {
                currentShift = storedShift;
                if (!currentShift.expenses_detail) {
                    currentShift.expenses_detail = [];
                }
                if (!currentShift.shift_date) {
                    currentShift.shift_date = todayDateStr;
                }
                // Si el turno cargado es de un día anterior, lo reiniciamos para el nuevo día
                if (currentShift.shift_date !== todayDateStr) {
                    addSystemLog(`⏰ Nuevo día detectado. Rollover de turno de ${currentShift.shift_date} a ${todayDateStr}.`);
                    currentShift.shift_date = todayDateStr;
                    currentShift.collected_cash = 0;
                    currentShift.expenses = 0;
                    currentShift.expenses_detail = [];
                    currentShift.status = "ABIERTO";
                    currentShift.sync_pending = true;
                    await promiseWithTimeout(db.shift.put(currentShift), 1500, "Dexie shift.put rollover timeout");
                }
            } else {
                await promiseWithTimeout(db.shift.put(currentShift), 1500, "Dexie shift.put init timeout");
            }
            addSystemLog(`📦 Cargados ${deliveries.length} pedidos locales de IndexedDB.`);
        } catch (e) {
            console.error("Fallo inicializando base de datos local Dexie", e);
            db = null;
            loadLocalStorageFallback();
        }
    } else {
        loadLocalStorageFallback();
    }

    const activeTheme = localStorage.getItem("app-theme") || "theme-dark";
    setTheme(activeTheme);

    // Sincronizar fecha inicial seleccionada con la fecha del turno actual de forma defensiva
    if (currentShift && typeof currentShift.shift_date === 'string') {
        const dateParts = currentShift.shift_date.split('-');
        if (dateParts.length === 3) {
            const parsedY = parseInt(dateParts[0]);
            const parsedM = parseInt(dateParts[1]) - 1;
            if (!isNaN(parsedY) && !isNaN(parsedM) && parsedM >= 0 && parsedM <= 11) {
                currentDate = currentShift.shift_date;
                viewYear = parsedY;
                viewMonth = parsedM;
            }
        }
    }
    
    recalculateShiftCash();

    renderTabs();
    renderLocalidades();
    renderCalendarStrip();
    
    renderContent();

    initSwipeNavigation();

    setInterval(runBackgroundSync, 10000);
    runBackgroundSync();

    initSignatureCanvasEvents();
}

function loadLocalStorageFallback() {
    const cached = localStorage.getItem("deliveries");
    try {
        deliveries = JSON.parse(cached);
    } catch (e) {}
    if (!Array.isArray(deliveries)) {
        deliveries = [];
        localStorage.setItem("deliveries", JSON.stringify([]));
    } else {
        deliveries.forEach(d => {
            if (d) {
                const storedFacade = localStorage.getItem("photo_facade_" + d.client_phone);
                if (storedFacade) d.facade_photo = storedFacade;
                
                const storedEvidence = localStorage.getItem("photo_evidence_" + d.id);
                if (storedEvidence) d.evidence_photo = storedEvidence;
            }
        });
    }

    const cachedShift = localStorage.getItem("shift");
    let parsedShift = null;
    try {
        parsedShift = JSON.parse(cachedShift);
    } catch (e) {}
    
    if (parsedShift && typeof parsedShift === 'object') {
        currentShift = parsedShift;
    }
    
    if (!currentShift || !currentShift.shift_date) {
        currentShift = {
            id: "shift_today",
            driver_name: "Ramón Mendoza",
            initial_cash: 50000,
            collected_cash: 0,
            expenses: 0,
            expenses_detail: [],
            status: "ABIERTO",
            shift_date: todayDateStr,
            sync_pending: false
        };
    }
    
    if (currentShift.shift_date !== todayDateStr) {
        currentShift.shift_date = todayDateStr;
        currentShift.collected_cash = 0;
        currentShift.expenses = 0;
        currentShift.expenses_detail = [];
        currentShift.status = "ABIERTO";
        localStorage.setItem("shift", JSON.stringify(currentShift));
    }
    addSystemLog("📦 Cargados datos locales desde LocalStorage Fallback.");
}

// Variables y funciones del Calendario
let currentDate = todayDateStr;
const todayDateObj = new Date();
let viewYear = todayDateObj.getFullYear();
let viewMonth = todayDateObj.getMonth();

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
        const isToday = dateStr === currentShift.shift_date;
        const todayClass = isToday ? 'today' : '';
        const isDiffActive = (dateStr === currentDate && !isToday);
        const diffClass = isDiffActive ? 'different-day' : '';
        
        const dayEl = document.createElement("div");
        dayEl.className = `calendar-day ${active} ${todayClass} ${diffClass}`;
        dayEl.onclick = () => selectDate(dateStr);
        
        const dayNameText = isToday ? "Hoy" : dayName;
        
        dayEl.innerHTML = `
            <span class="calendar-day-name">${dayNameText}</span>
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

function changeDay(offset) {
    const parts = currentDate.split('-');
    if (parts.length !== 3) return;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);
    
    const dateObj = new Date(year, month, day);
    dateObj.setDate(dateObj.getDate() + offset);
    
    const newY = dateObj.getFullYear();
    const newM = dateObj.getMonth();
    const newD = dateObj.getDate();
    
    const formattedMonth = String(newM + 1).padStart(2, '0');
    const formattedDay = String(newD).padStart(2, '0');
    currentDate = `${newY}-${formattedMonth}-${formattedDay}`;
    
    viewMonth = newM;
    viewYear = newY;
    
    addSystemLog(`📅 Fecha cambiada: ${currentDate}.`);
    
    renderCalendarStrip();
    renderLocalidades();
    renderContent();
}

function prevDay() {
    changeDay(-1);
}

function nextDay() {
    changeDay(1);
}

async function selectDate(date) {
    currentDate = date;
    addSystemLog(`📅 Fecha seleccionada: ${currentDate}.`);
    
    renderCalendarStrip();
    renderLocalidades();
    renderContent();
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

// Agrupador de pedidos para evitar duplicidad de tarjetas de un mismo cliente
function groupDeliveries(deliveriesArray) {
    const groups = {};
    deliveriesArray.forEach(d => {
        const key = `${d.client_name || ''}_${d.client_phone || ''}`;
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(d);
    });
    
    return Object.values(groups).map(group => {
        // Ordenar internamente por número de ticket
        group.sort((a, b) => (a.ticket_number || 0) - (b.ticket_number || 0));
        const main = group[0];
        
        const hasEnRuta = group.some(item => item.status === 'EN_RUTA');
        const allEntregado = group.every(item => item.status === 'ENTREGADO');
        
        let status = 'PENDIENTE';
        if (hasEnRuta) {
            status = 'EN_RUTA';
        } else if (allEntregado) {
            status = 'ENTREGADO';
        }
        
        const totalAmount = group.reduce((sum, item) => sum + (item.amount || 0), 0);
        const totalExpected = group.reduce((sum, item) => sum + (item.expected_items || 1), 0);
        const totalCollected = group.reduce((sum, item) => sum + (item.collected_items || 0), 0);
        
        return {
            ...main,
            status: status,
            amount: totalAmount,
            expected_items: totalExpected,
            collected_items: totalCollected,
            orders: group
        };
    });
}

// Vista de Domicilios
function renderDeliveriesView(container) {
    const filtered = deliveries
        .filter(d => d.localidad === currentLocalidad && d.order_date === currentDate)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        
    const grouped = groupDeliveries(filtered);
        
    const activeRoute = grouped.filter(d => d.status === "EN_RUTA");
    const pending = grouped.filter(d => d.status === "PENDIENTE");
    const completed = grouped.filter(d => d.status === "ENTREGADO");

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
    
    const facadePhotos = getFacadePhotosList(d);
    const hasFacade = facadePhotos.length > 0 || (d.facade_latitude && d.facade_longitude);
    let facadePillHtml = "";
    
    if (hasFacade) {
        facadePillHtml = `
            <div onclick="openFacadeModal(event, '${d.id}')" style="margin-top: 6px; padding: 6px 10px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(16, 185, 129, 0.15)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.08)'">
                <span style="color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 4px;">🏡 Fachada registrada (${facadePhotos.length} fotos + GPS)</span>
                <span style="font-size: 10px; color: var(--text-muted); font-weight: 600;">Ver ➔</span>
            </div>
        `;
    } else {
        facadePillHtml = `
            <div onclick="openFacadeModal(event, '${d.id}')" style="margin-top: 6px; padding: 6px 10px; border: 1px dashed rgba(139, 92, 246, 0.4); background: rgba(139, 92, 246, 0.02); border-radius: 8px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(139, 92, 246, 0.08)'; this.style.borderColor='var(--primary)';" onmouseout="this.style.background='rgba(139, 92, 246, 0.02)'; this.style.borderColor='rgba(139, 92, 246, 0.4)';">
                <span style="color: var(--primary); font-weight: 700; display: flex; align-items: center; gap: 4px;">📷 Registrar Fachada & GPS</span>
                <span style="font-size: 10px; color: var(--text-muted); font-weight: 600;">Registrar ➔</span>
            </div>
        `;
    }
    
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

    const siblingCount = d.orders ? d.orders.length : 1;

    let itemsDetailHtml = "";
    if (d.orders && d.orders.length > 1) {
        itemsDetailHtml = `
            <div style="font-size: 11px; margin-top: 4px; margin-bottom: 6px; padding: 8px 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 6px;">
                ${d.orders.map(o => {
                    const statusIcon = o.status === 'ENTREGADO' ? '✅' : (o.status === 'EN_RUTA' ? '🏍️' : '🕒');
                    const itemsDesc = o.items && o.items.length > 0 
                        ? o.items.map(item => `${item.quantity}x ${item.type}`).join(', ')
                        : `${o.expected_items} prendas`;
                    return `
                        <div style="display: flex; flex-direction: column; padding-bottom: 4px; border-bottom: 1px dashed rgba(255,255,255,0.05); line-height: 1.3;">
                            <div style="display: flex; justify-content: space-between; font-weight: 700;">
                                <span style="color: var(--primary);">🎟️ #${o.ticket_number || 'N/A'}</span>
                                <span style="font-size: 10px; color: var(--text-muted);">${statusIcon} ${o.status === 'EN_RUTA' ? 'En Ruta' : (o.status === 'PENDIENTE' ? 'Pendiente' : 'Entregado')}</span>
                            </div>
                            <div style="color: var(--text-main); font-size: 11px; margin-top: 2px;">${itemsDesc}</div>
                            <div style="text-align: right; font-weight: 600; font-size: 10px; color: var(--secondary); margin-top: 1px;">$${(o.amount || 0).toLocaleString()}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } else {
        if (d.items && d.items.length > 0) {
            itemsDetailHtml = `
                <div class="items-list-box" style="margin-top: 4px; margin-bottom: 6px; padding: 6px 8px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border); border-radius: 6px; font-size: 11px; color: var(--text-main);">
                    ${d.items.map(item => `<div style="display: flex; justify-content: space-between; margin-bottom: 2px;"><span>👔 ${item.quantity}x ${item.type}</span><span style="color:var(--text-muted); font-weight:500;">$${(item.price || 0).toLocaleString()}</span></div>`).join('')}
                </div>
            `;
        }
    }

    const isWarningAddress = d.address === 'Recogida WhatsApp';

    card.innerHTML = `
        <div class="card-header">
            <div style="display:flex; align-items:center; gap:8px;">
                ${d.status !== 'ENTREGADO' ? `<div class="drag-handle" title="Arrastrar para ordenar">⋮⋮</div>` : ''}
                <div class="time-badge">
                    🕒 <span>${d.time_window}</span>
                </div>
                ${d.ticket_number ? `<span class="ticket-badge" style="background: rgba(139, 92, 246, 0.15); color: var(--primary); font-size: 11px; padding: 2px 6px; border-radius: 6px; font-weight: 700; border: 1px solid rgba(139, 92, 246, 0.25);">🎟️ #${d.ticket_number}</span>` : ''}
            </div>
            <div class="status-pill ${statusClass}">${statusLabel}</div>
        </div>
        <div class="card-body">
            <div class="client-name" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <span>${d.client_name}</span>
                ${d.chat_transcription ? `<button class="btn-chat-info" onclick="openChatTranscriptionModal('${d.id}')" style="background: rgba(92, 212, 255, 0.1); border: 1px solid rgba(92, 212, 255, 0.25); color: #5cd4ff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s; white-space: nowrap;" onmouseover="this.style.background='rgba(92, 212, 255, 0.2)'" onmouseout="this.style.background='rgba(92, 212, 255, 0.1)'">💬 Detalle</button>` : ''}
            </div>
            <div style="font-size:12px; font-weight:600; color:var(--secondary); margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                <span>${prendasText}</span>
                ${siblingCount > 1 ? `<span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">👥 ${siblingCount} pedidos hoy</span>` : ''}
            </div>
            ${itemsDetailHtml}
            <div class="address-box">
                <svg width="14" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>
                    ${formatShortAddress(d.address)}
                </span>
            </div>
            ${facadePillHtml}
        </div>
        <div class="price-row">
            <div>
                <span class="pay-method">${d.pay_method}</span>
                ${d.sync_pending ? `<span style="font-size:10px; color:var(--warning); margin-left:8px;">🔄 Pendiente Nube</span>` : ''}
            </div>
            <div class="price-val">$${(d.amount || 0).toLocaleString()}</div>
        </div>
    `;

    if (d.status !== "ENTREGADO") {
        const actions = document.createElement("div");
        actions.className = "card-actions";
        
        const orderIdsCsv = d.orders ? d.orders.map(o => o.id).join(',') : d.id;
        const mainId = d.orders ? d.orders[0].id : d.id;
        
        let startButton = "";
        if (d.status === "PENDIENTE") {
            startButton = `
                <button class="btn btn-deliver" onclick="startRoute('${orderIdsCsv}')">
                    🏍️ Iniciar Entrega (En Ruta)
                </button>
            `;
        } else {
            startButton = `
                <button class="btn btn-deliver" onclick="openConfirmModal('${orderIdsCsv}')">
                    📦 Confirmar Recibido / Entrega
                </button>
            `;
        }

        actions.innerHTML = `
            <button class="btn btn-maps" onclick="openMaps('${mainId}')">
                🗺️ Maps
            </button>
            <button class="btn btn-chat" onclick="toggleWhatsappTemplatesDropdown(event, '${mainId}')" style="position:relative;">
                💬 Chat
            </button>
            <a class="btn btn-call" href="tel:${d.client_phone}">
                📞 Llamar
            </a>
            ${startButton}
        `;
        card.appendChild(actions);
    } else {
        const confirmationDetails = document.createElement("div");
        confirmationDetails.style.cssText = "font-size:12px; color:var(--success); border-top:1px solid var(--border); padding-top:10px; margin-top:4px; display:flex; justify-content:space-between;";
        let qrLabel = "";
        if (d.qr_code && typeof d.qr_code === 'string') {
            qrLabel = `<span>Prenda: ${escapeHtml(d.qr_code.split('-').pop())}</span>`;
        }
        confirmationDetails.innerHTML = `
            <span>✅ Entregado exitosamente</span>
            ${qrLabel}
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

    const grouped = groupDeliveries(sorted);

    if (grouped.length === 0) {
        itemsContainer.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">No hay pedidos para cargar hoy.</div>`;
        return;
    }

    grouped.forEach((d, index) => {
        const item = document.createElement("div");
        item.className = "maleta-item";
        const posLabel = index === 0 ? "ARRIBA (FÁCIL ACCESO)" : (index === grouped.length - 1 ? "FONDO MALETA" : `POSICIÓN ${grouped.length - index}`);
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
    const expensesDetail = currentShift.expenses_detail || [];
    
    let expensesListHtml = "";
    if (expensesDetail.length > 0) {
        expensesListHtml = `
            <div class="expenses-list" style="margin-top:15px; background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:15px;">
                <div style="font-weight:600; font-size:13px; color:var(--text-muted); margin-bottom:8px; display:flex; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:6px;">
                    <span>Concepto</span>
                    <span>Monto</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px; max-height:120px; overflow-y:auto; padding-right:4px;">
                    ${expensesDetail.map((e, index) => `
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; padding:2px 0;">
                            <span style="color:var(--text-main); font-weight:500;">${e.description}</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="color:var(--danger); font-weight:600;">-$${e.amount.toLocaleString()}</span>
                                ${shiftClosed ? '' : `
                                    <button class="btn-delete-expense" onclick="deleteExpense(${index})" title="Eliminar Gasto">
                                        🗑️
                                    </button>
                                `}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
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
                <div style="background:rgba(16, 185, 129, 0.15); border:1px solid var(--success); border-radius:16px; padding:15px; text-align:center; color:var(--success); font-weight:600; margin-bottom:10px;">
                    🔒 Turno Cerrado Exitosamente. Cuentas conciliadas.
                </div>
                <button class="btn btn-chat" onclick="shareShiftReportToWhatsapp()" style="background:var(--secondary); border-color:var(--secondary); font-weight:bold; width:100%; margin-bottom:15px; box-shadow:none;">
                    📲 Compartir Reporte de Cierre por WhatsApp
                </button>
                ${expensesListHtml}
            ` : `
                <div class="form-group" style="margin-top:10px;">
                    <label>Registrar Gasto (Concepto y Monto)</label>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        <input type="text" id="cash-expense-desc" class="input-text" placeholder="Concepto (ej: Gasolina, Peaje, Viáticos...)" style="width:100%;">
                        <div style="display:flex; gap:8px;">
                            <input type="number" id="cash-expense-amount" class="input-text" placeholder="Monto $" style="flex:1;">
                            <button class="btn btn-confirm" onclick="registerExpense()" style="width:90px; box-shadow:none;">
                                Añadir
                            </button>
                        </div>
                    </div>
                </div>
                
                ${expensesListHtml}

                <div style="display:grid; grid-template-columns:1fr; gap:10px; margin-top:20px;">
                    <button class="btn btn-chat" onclick="shareShiftReportToWhatsapp()" style="background:var(--secondary); border-color:var(--secondary); font-weight:bold; box-shadow:0 4px 15px rgba(6, 182, 212, 0.3);">
                        📲 Compartir Reporte a WhatsApp
                    </button>
                    <button class="btn btn-deliver" onclick="closeShift()" style="background:var(--danger); box-shadow:0 4px 15px rgba(239, 68, 68, 0.3); font-weight:bold;">
                        🔒 Cerrar Caja y Entregar Turno
                    </button>
                </div>
            `}
        </div>
    `;
}

async function shareShiftReportToWhatsapp() {
    let adminPhone = localStorage.getItem("wa-admin-phone") || "";
    if (!adminPhone) {
        adminPhone = prompt("📱 Ingrese el teléfono del administrador (con código de país, ej: 573001234567):");
        if (!adminPhone) return;
        localStorage.setItem("wa-admin-phone", adminPhone.replace(/\D/g, ''));
    }
    
    const statusLabel = currentShift.status === "CERRADO" ? "🔒 CERRADO Y CONCILIADO" : "🔓 ABIERTO";
    const netBalance = currentShift.initial_cash + currentShift.collected_cash - currentShift.expenses;
    
    const shiftDeliveries = deliveries.filter(d => d.order_date === currentShift.shift_date);
    const completed = shiftDeliveries.filter(d => d.status === "ENTREGADO").length;
    const pending = shiftDeliveries.filter(d => d.status === "PENDIENTE").length;
    const active = shiftDeliveries.filter(d => d.status === "EN_RUTA").length;
    
    let expensesText = "";
    if (currentShift.expenses_detail && currentShift.expenses_detail.length > 0) {
        expensesText = currentShift.expenses_detail.map(e => `- ${e.description}: $${e.amount.toLocaleString()}`).join("\n");
    } else {
        expensesText = "Ninguno";
    }

    const reportText = `*📦 REPORTE DE CAJA - LAVASECO ORQUÍDEAS*
-------------------------------------------
👤 *Domiciliario:* ${currentShift.driver_name || "Ramón Mendoza"}
📅 *Fecha Turno:* ${currentShift.shift_date}
🚦 *Estado:* ${statusLabel}

💰 *Base Inicial:* $${currentShift.initial_cash.toLocaleString()}
💵 *Recaudo Efectivo:* $${currentShift.collected_cash.toLocaleString()}
❌ *Total Gastos:* $${currentShift.expenses.toLocaleString()}

📋 *Detalle de Gastos:*
${expensesText}

⚖️ *Balance Neto:* $${netBalance.toLocaleString()}

📈 *Entregas:*
✅ Completadas: ${completed}
⏳ Pendientes: ${pending}
🏍️ En Ruta: ${active}
-------------------------------------------
_Enviado desde App Domiciliaria_`;

    await sendWhatsappNotification(adminPhone, "REPORTADO", reportText);
    alert("📲 Reporte de caja enviado o abierto en WhatsApp.");
}

function renderConfigView(container) {
    const isGlass = document.body.classList.contains("theme-glass");
    const supabaseUrl = localStorage.getItem("supabase-url") || "";
    const supabaseKey = localStorage.getItem("supabase-key") || "";
    const waApiEnabled = localStorage.getItem("wa-api-enabled") === "true";
    const waApiUrl = localStorage.getItem("wa-api-url") || "";
    const waApiToken = localStorage.getItem("wa-api-token") || "";
    const waAdminPhone = localStorage.getItem("wa-admin-phone") || "";
    const waSessionStatus = localStorage.getItem("wa-session-status") || "🔴 Desconectado (Haga clic en Vincular)";

    const isConnected = waSessionStatus.includes("🟢");

    container.innerHTML = `
        <div class="cash-module" style="gap:10px; overflow-y:auto; max-height:100%; padding-bottom:30px;">
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
                <label>Integración WhatsApp API Gateway (Automático)</label>
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
                    <input type="checkbox" id="cfg-wa-api-enabled" ${waApiEnabled ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
                    <span style="font-size:12px; color:var(--text-main); font-weight:500;">Habilitar Envíos Automáticos</span>
                </div>
                <input type="text" id="cfg-wa-admin-phone" class="input-text" placeholder="Teléfono del Administrador (ej: 573001234567)" value="${waAdminPhone}" style="margin-bottom:6px; font-size:12px; padding:10px;">
                <input type="text" id="cfg-wa-api-url" class="input-text" placeholder="https://api.tu-servidor-whatsapp.com/send" value="${waApiUrl}" style="margin-bottom:6px; font-size:12px; padding:10px;">
                <input type="password" id="cfg-wa-api-token" class="input-text" placeholder="API Token / Auth Bearer Key" value="${waApiToken}" style="margin-bottom:8px; font-size:12px; padding:10px;">
                <button class="btn btn-confirm" onclick="saveWhatsappCredentials()" style="padding:10px; font-weight:600; background:var(--secondary); border-color:var(--secondary); box-shadow:none;">
                    💾 Guardar Integración WhatsApp
                </button>
            </div>

            <div class="form-group" style="border-top:1px solid var(--border); padding-top:10px; display:flex; flex-direction:column; align-items:center; gap:8px;">
                <label style="width:100%; text-align:left;">Sincronizar con el WhatsApp Original</label>
                <div id="wa-qr-status-text" style="font-size:12px; font-weight:700; color:${isConnected ? 'var(--success)' : 'var(--danger)'}; text-align:center;">
                    ${waSessionStatus}
                </div>
                
                ${isConnected ? `
                    <div style="font-size:45px; margin:10px;">📱✅</div>
                    <button class="btn btn-cancel" onclick="localStorage.removeItem('wa-session-status'); addSystemLog('🔴 Sesión WhatsApp eliminada.'); renderContent();" style="font-size:11px; padding:6px 12px;">
                        Desvincular Dispositivo
                    </button>
                ` : `
                    <div id="wa-qr-container" style="display:flex; justify-content:center; background:#FFF; padding:12px; border-radius:16px; margin:5px 0;">
                        <svg width="110" height="110" viewBox="0 0 29 29" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M0 0h7v7H0zm2 2v3h3V2zm0 13h7v7H0zm2 2v3h3v-3zm13-17h7v7h-7zm2 2v3h3V2z" fill="#000"/>
                            <path d="M9 1h1v2H9zm0 4h3v1H9zm1-1h1v1h-1zm4-3h1v1h-1zm0 2h1v3h-1zm2 1h1v1h-1zm-2 2h1v1h-1zm4-4h2v1h-2zm1 2h1v2h-1zm-2 2h2v1h-2zm-5 7h1v1h-1zm0 2h1v2h-1zm2 1h1v1h-1zm0-3h1v1h-1zm1 1h2v1h-2zm1-2h1v1h-1zm1 3h2v1h-2zm3-3h1v1h-1zm0 2h1v1h-1zm1-1h1v1h-1zm-9 6h1v1h-1zm2 0h1v1h-1zm1 0h1v1h-1zm2 0h2v1h-2zm4 0h1v1h-1z" fill="#000"/>
                        </svg>
                    </div>
                    <button class="btn" id="wa-link-btn" onclick="simularVinculacionQR()" style="background:var(--success); border-color:var(--success); font-weight:600; font-size:12px; padding:8px 16px; box-shadow:none;">
                        🔗 Vincular WhatsApp por Código QR
                    </button>
                `}
            </div>

            <div class="form-group" style="border-top:1px solid var(--border); padding-top:10px;">
                <label>Cola de Mensajes de WhatsApp y Notificaciones</label>
                <div class="sync-console" id="wa-console-logs" style="height:90px; color:#5cd4ff;"></div>
            </div>

            <div class="form-group" style="border-top:1px solid var(--border); padding-top:10px;">
                <label>Consola de Sincronización de Base de Datos</label>
                <div class="sync-console" id="sync-console-logs" style="height:90px;"></div>
            </div>

            <div class="form-group" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:5px;">
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

    loadWhatsappLogs();
}

function saveWhatsappCredentials() {
    const enabled = document.getElementById("cfg-wa-api-enabled").checked;
    const url = document.getElementById("cfg-wa-api-url").value.trim();
    const token = document.getElementById("cfg-wa-api-token").value.trim();
    const adminPhone = document.getElementById("cfg-wa-admin-phone").value.trim();
    
    localStorage.setItem("wa-api-enabled", enabled ? "true" : "false");
    localStorage.setItem("wa-api-url", url);
    localStorage.setItem("wa-api-token", token);
    localStorage.setItem("wa-admin-phone", adminPhone.replace(/\D/g, ''));
    
    addSystemLog(`⚙️ Configuración WhatsApp actualizada. Automático: ${enabled ? 'SÍ' : 'NO'}`);
    alert("✅ Configuración de WhatsApp guardada.");
    renderContent();
}

function simularVinculacionQR() {
    const statusText = document.getElementById("wa-qr-status-text");
    const qrContainer = document.getElementById("wa-qr-container");
    const linkBtn = document.getElementById("wa-link-btn");
    
    if (!statusText || !qrContainer || !linkBtn) return;
    
    linkBtn.disabled = true;
    linkBtn.innerHTML = "⏳ Vinculando dispositivo...";
    statusText.innerHTML = "🟡 Conectando con WhatsApp...";
    qrContainer.style.opacity = "0.5";
    
    setTimeout(() => {
        localStorage.setItem("wa-session-status", "🟢 Conectado (Celular de Ramón)");
        addSystemLog("🟢 WhatsApp: Dispositivo original vinculado exitosamente.");
        renderContent();
    }, 2500);
}

async function loadWhatsappLogs() {
    const waConsole = document.getElementById("wa-console-logs");
    if (!waConsole) return;
    
    try {
        const res = await fetch("/api/whatsapp/logs");
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.logs) {
                if (data.logs.length === 0) {
                    waConsole.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:10px;">No hay mensajes registrados aún.</div>`;
                } else {
                    waConsole.innerHTML = data.logs.map(log => `
                        <div style="margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:4px;">
                            <span style="color:var(--secondary)">[${log.timestamp}]</span>
                            <span style="color:#FFF">A: ${log.phone} (${log.client_name})</span>
                            <div style="padding-left:10px; color:#aaa; font-style:italic;">"${log.message}"</div>
                        </div>
                    `).join("");
                }
                waConsole.scrollTop = waConsole.scrollHeight;
            }
        }
    } catch (e) {
        console.error("Fallo obteniendo logs de WhatsApp:", e);
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
        renderLocalidades();
        renderContent();
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
    const ids = id.split(',');
    const mainId = ids[0];
    
    // Poner todas las demás entregas activas a PENDIENTE
    deliveries.forEach(d => {
        if (d.status === "EN_RUTA" && !ids.includes(d.id)) {
            d.status = "PENDIENTE";
            d.sync_pending = true;
        }
    });

    // Poner las entregas del grupo a EN_RUTA
    let clientName = "";
    ids.forEach(currentId => {
        const delivery = deliveries.find(d => d.id === currentId);
        if (delivery) {
            delivery.status = "EN_RUTA";
            delivery.sync_pending = true;
            clientName = delivery.client_name;
        }
    });
    
    await saveDeliveries();
    addSystemLog(`🏍️ Ruta iniciada para ${clientName} (${ids.length} pedidos). Estado actualizado.`);
    renderContent();
    triggerBackgroundSync();
    
    const waEnabled = localStorage.getItem("wa-api-enabled") === "true";
    if (waEnabled) {
        sendWhatsappNotification(mainId, "EN_RUTA");
    }
}

function openMaps(id) {
    const d = deliveries.find(item => item.id === id);
    if (!d) return;
    
    let query = d.address;
    if (d.latitude && d.longitude) {
        query = `${d.latitude},${d.longitude}`;
    }
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    window.open(url, '_blank');
}

async function queueWhatsappMessage(phone, message, client_name = "", order_id = "", address = "", status = "") {
    if (db) {
        try {
            await promiseWithTimeout(db.pending_wa_messages.add({
                phone,
                message,
                client_name,
                order_id,
                address,
                status,
                timestamp: Date.now(),
                attempts: 0
            }), 2000, "Dexie pending_wa_messages.add timeout");
            addSystemLog(`📥 Cola WA: Mensaje para ${client_name || phone} encolado localmente.`);
        } catch (e) {
            console.error("Fallo al encolar mensaje de WhatsApp:", e);
        }
    } else {
        addSystemLog(`⚠️ Advertencia: Dexie inactivo, no se pudo encolar mensaje.`);
    }
}

async function sendWhatsappNotification(id, statusTrigger = "EN_RUTA", customText = "") {
    let phone = "";
    let clientName = "";
    let address = "";
    let status = "";
    let orderId = "";
    
    const d = deliveries.find(item => item.id === id);
    if (d) {
        phone = d.client_phone;
        clientName = d.client_name;
        address = d.address;
        status = d.status;
        orderId = d.id;
    } else {
        // Podría ser un número directo (ej: del Administrador para el reporte de turno)
        phone = id.replace(/\D/g, '');
        clientName = "Administrador";
        address = "Cierre de Turno";
        status = "REPORTADO";
        orderId = "shift_" + currentShift.shift_date;
    }

    let msg = customText;
    if (!msg) {
        if (statusTrigger === "EN_RUTA") {
            msg = `Hola ${clientName}, soy Ramón de Lavaseco Orquídeas. Ya voy en camino a tu dirección: ${address}. Estaré allí en unos 10 minutos.`;
        } else if (statusTrigger === "ENTREGADO") {
            msg = `Hola ${clientName}, tu servicio de Lavaseco Orquídeas ha sido entregado exitosamente. ¡Muchas gracias por tu confianza!`;
        } else {
            msg = `Notificación de Lavaseco Orquídeas para ${clientName}.`;
        }
    }

    const waEnabled = localStorage.getItem("wa-api-enabled") === "true";
    
    if (waEnabled) {
        addSystemLog(`💬 WhatsApp API: Enviando notificación a ${clientName}...`);
        try {
            // Llamar al proxy del servidor local para registrar/enviar y evitar problemas de CORS
            const response = await fetch("/api/whatsapp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone: phone,
                    message: msg,
                    client_name: clientName,
                    address: address,
                    status: status,
                    order_id: orderId
                })
            });
            
            const result = await response.json();
            if (response.ok && result.success) {
                addSystemLog(`✅ WhatsApp API: Notificación entregada al proxy con éxito.`);
                if (typeof loadWhatsappLogs === 'function') loadWhatsappLogs();
            } else {
                addSystemLog(`❌ WhatsApp API Error: Código ${response.status}. Encolando mensaje.`);
                await queueWhatsappMessage(phone, msg, clientName, orderId, address, status);
            }
        } catch (err) {
            addSystemLog(`❌ WhatsApp API Error: Conexión fallida (${err.message}). Encolando mensaje.`);
            await queueWhatsappMessage(phone, msg, clientName, orderId, address, status);
        }
    } else {
        // Fallback al enlace manual wa.me
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
        addSystemLog(`💬 WhatsApp Manual: Abierta ventana para enviar a ${clientName}.`);
    }
}

function toggleWhatsappTemplatesDropdown(event, id) {
    event.stopPropagation();
    
    const existing = document.getElementById(`wa-dropdown-${id}`);
    if (existing) {
        existing.remove();
        return;
    }
    
    document.querySelectorAll('.wa-dropdown-menu').forEach(el => el.remove());
    
    const d = deliveries.find(item => item.id === id);
    if (!d) return;
    
    const btn = event.currentTarget;
    const parent = btn.parentNode;
    
    const dropdown = document.createElement("div");
    dropdown.id = `wa-dropdown-${id}`;
    dropdown.className = "wa-dropdown-menu";
    
    const templates = [
        { label: "🏍️ En Camino (10m)", trigger: "EN_RUTA", text: `Hola ${d.client_name}, soy Ramón de Lavaseco Orquídeas. Ya voy en camino a tu dirección: ${d.address}. Estaré allí en unos 10 minutos.` },
        { label: "🕒 Retraso en Vía", trigger: "RETRASO", text: `Hola ${d.client_name}, he tenido un pequeño retraso de 15 minutos en la vía. Estaré llegando lo más pronto posible. ¡Gracias!` },
        { label: "📍 Llegué al Punto", trigger: "LLEGADA", text: `Hola ${d.client_name}, ya me encuentro afuera de tu dirección: ${d.address}.` },
        { label: "❓ Perdido / Confirmar Ubicación", trigger: "PERDIDO", text: "" },
        { label: "📦 Confirmar Recibido", trigger: "ENTREGADO", text: `Hola ${d.client_name}, tu servicio por valor de $${d.amount.toLocaleString()} ha sido entregado. ¡Muchas gracias por tu confianza!` },
        { label: "💬 Chat Manual", trigger: "MANUAL", text: "" }
    ];
    
    templates.forEach(t => {
        const item = document.createElement("div");
        item.className = "wa-dropdown-item";
        item.textContent = t.label;
        item.onclick = (e) => {
            e.stopPropagation();
            dropdown.remove();
            if (t.trigger === "MANUAL") {
                const url = `https://wa.me/${d.client_phone}`;
                window.open(url, '_blank');
                addSystemLog(`💬 WhatsApp Manual: Abierto chat libre con ${d.client_name}.`);
            } else if (t.trigger === "PERDIDO") {
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (position) => {
                            const lat = position.coords.latitude;
                            const lng = position.coords.longitude;
                            const gpsLink = `https://maps.google.com/?q=${lat},${lng}`;
                            const msg = `Hola ${d.client_name}, me encuentro en la zona de entrega buscando tu dirección pero las calles son confusas. Estoy exactamente en este punto: ${gpsLink}. ¿Me podrías confirmar tu dirección o compartir un enlace de tu ubicación exacta por aquí? ¡Muchas gracias!`;
                            sendWhatsappNotification(id, "PERDIDO", msg);
                        },
                        (err) => {
                            const msg = `Hola ${d.client_name}, llegué a tu zona de entrega pero no ubico tu dirección exacta. ¿Me confirmarías la dirección o me compartirías un enlace de tu ubicación de WhatsApp para guiarme? ¡Muchas gracias!`;
                            sendWhatsappNotification(id, "PERDIDO", msg);
                        },
                        { timeout: 4000, enableHighAccuracy: true }
                    );
                } else {
                    const msg = `Hola ${d.client_name}, llegué a tu zona de entrega pero no ubico tu dirección exacta. ¿Me confirmarías la dirección o me compartirías un enlace de tu ubicación de WhatsApp para guiarme? ¡Muchas gracias!`;
                    sendWhatsappNotification(id, "PERDIDO", msg);
                }
            } else {
                sendWhatsappNotification(id, t.trigger, t.text);
            }
        };
        dropdown.appendChild(item);
    });
    
    parent.appendChild(dropdown);
    
    const closeHandler = () => {
        dropdown.remove();
        document.removeEventListener('click', closeHandler);
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
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

// Variable global para almacenar las imágenes de evidencia capturadas
let capturedPhotosList = [];

// Soporte de Cámara y Subida de Archivo Real
function triggerCameraInput() {
    const input = document.getElementById("camera-input");
    if (input) {
        input.value = "";
        input.click();
    } else {
        takeDeliveryPhotoSim();
    }
}

function handleCameraFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const rawBase64 = e.target.result;
        addSystemLog("⚡ Optimizando tamaño de la foto de evidencia...");
        const base64 = await compressImage(rawBase64, 800, 800, 0.7);
        
        if (capturedPhotosList.length < 4) {
            capturedPhotosList.push(base64);
            addSystemLog(`📷 Foto de evidencia ${capturedPhotosList.length} añadida.`);
            renderPhotosGallery();
        }
    };
    reader.readAsDataURL(file);
}

// Simulador de Cámara (Failsafe)
function takeDeliveryPhotoSim() {
    if (capturedPhotosList.length >= 4) {
        alert("⚠️ Has alcanzado el límite máximo de 4 fotos.");
        return;
    }
    
    const colors = ["%238B5CF6", "%2306B6D4", "%2310B981", "%23F59E0B"];
    const activeColor = colors[capturedPhotosList.length] || "%238B5CF6";
    const mockPhoto = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200' viewBox='0 0 400 200'><rect width='400' height='200' fill='%231C2331'/><rect x='130' y='40' width='140' height='120' fill='${activeColor}' rx='10'/><path d='M130 70 L200 110 L270 70' stroke='%237C3AED' stroke-width='4' fill='none'/><circle cx='200' cy='100' r='25' fill='%23FFFFFF' opacity='0.5'/><text x='200' y='165' fill='%23F3F4F6' font-size='14' font-weight='bold' font-family='sans-serif' text-anchor='middle'>EVIDENCIA %23${capturedPhotosList.length + 1}</text></svg>`;

    capturedPhotosList.push(mockPhoto);
    addSystemLog(`📷 Foto de evidencia simulada #${capturedPhotosList.length} completada.`);
    renderPhotosGallery();
}

function removeGalleryPhoto(index) {
    if (index >= 0 && index < capturedPhotosList.length) {
        capturedPhotosList.splice(index, 1);
        addSystemLog(`📷 Foto de evidencia eliminada. Quedan ${capturedPhotosList.length} fotos.`);
        renderPhotosGallery();
    }
}

function renderPhotosGallery() {
    const container = document.getElementById("photos-gallery-container");
    if (!container) return;
    
    let html = "";
    capturedPhotosList.forEach((src, index) => {
        html += `
            <div style="position: relative; width: 68px; height: 68px; transition: all 0.2s ease;">
                <img src="${src}" onclick="openLightbox('${src}')" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px; cursor: zoom-in; border: 1px solid var(--border); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                <div onclick="removeGalleryPhoto(${index})" style="position: absolute; top: -6px; right: -6px; background: #ef4444; color: white; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; cursor: pointer; border: 1.5px solid var(--bg-card); z-index: 10; box-shadow: 0 2px 4px rgba(0,0,0,0.3); line-height: 1;">×</div>
            </div>
        `;
    });
    
    // Botón de Añadir Foto
    if (capturedPhotosList.length < 4) {
        html += `
            <div onclick="triggerCameraInput()" style="width: 68px; height: 68px; border-radius: 8px; border: 1px dashed var(--border); display: flex; flex-direction: column; justify-content: center; align-items: center; background: rgba(255,255,255,0.02); cursor: pointer; color: var(--text-muted); transition: all 0.2s;" onmouseover="this.style.borderColor='var(--primary)'; this.style.background='rgba(255,255,255,0.05)';" onmouseout="this.style.borderColor='var(--border)'; this.style.background='rgba(255,255,255,0.02)';">
                <span style="font-size: 22px; color: var(--primary); font-weight: bold; line-height: 1; margin-bottom: 2px;">+</span>
                <span style="font-size: 9px; font-weight: 700; color: var(--text-muted);">Añadir</span>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    // Actualizar validación
    isPhotoCaptured = capturedPhotosList.length > 0;
    updateCompleteButtonState();
}

// Controlar habilitación del botón Completar
function updateCompleteButtonState() {
    const btn = document.getElementById("btn-complete-delivery");
    if (!btn) return;

    if (isPhotoCaptured && hasSigned) {
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

// Variable global para almacenar el conteo manual por prenda
let currentCollectedItemsMap = {};

function adjustGroupedItemCount(orderId, itemType, direction) {
    const key = `${orderId}_${itemType}`;
    if (currentCollectedItemsMap[key] === undefined) return;
    
    currentCollectedItemsMap[key] += direction;
    if (currentCollectedItemsMap[key] < 0) {
        currentCollectedItemsMap[key] = 0;
    }
    
    const span = document.getElementById(`count-${orderId}-${itemType}`);
    if (span) {
        span.textContent = currentCollectedItemsMap[key];
    }
    
    updateGroupedItemsSummary();
}

let currentExtraGarmentsList = [];

function updateGroupedItemsSummary() {
    const ids = currentActiveDeliveryId.split(',');
    const groupItems = deliveries.filter(item => ids.includes(item.id));
    
    let totalExpected = 0;
    let totalCollected = 0;
    
    groupItems.forEach(item => {
        if (item.items && item.items.length > 0) {
            item.items.forEach(sub => {
                totalExpected += sub.quantity;
                const key = `${item.id}_${sub.type}`;
                totalCollected += (currentCollectedItemsMap[key] !== undefined ? currentCollectedItemsMap[key] : sub.quantity);
            });
        } else {
            totalExpected += (item.expected_items || 1);
            const key = `${item.id}_prendas_generales`;
            totalCollected += (currentCollectedItemsMap[key] !== undefined ? currentCollectedItemsMap[key] : (item.expected_items || 1));
        }
    });
    
    // Sumar prendas extras
    currentExtraGarmentsList.forEach(extra => {
        totalCollected += extra.quantity;
    });
    
    const summaryEl = document.getElementById("modal-items-count-summary");
    if (summaryEl) {
        if (totalCollected !== totalExpected) {
            summaryEl.style.color = "var(--warning)";
            summaryEl.textContent = `⚠️ Discrepancia: Esperadas ${totalExpected} | Contadas ${totalCollected}`;
        } else {
            summaryEl.style.color = "var(--success)";
            summaryEl.textContent = `✅ Total de prendas verificado: ${totalExpected} de ${totalExpected}`;
        }
    }
    
    currentCollectedItemsCount = totalCollected;
}

function renderGarmentsVerificationTable() {
    const ids = currentActiveDeliveryId.split(',');
    const groupItems = deliveries.filter(d => ids.includes(d.id));
    
    let tableHtml = `
        <table style="width:100%; border-collapse:collapse; font-size:12px; color:var(--text-main); text-align:left; margin-top:8px;">
            <thead>
                <tr style="border-bottom: 1px solid var(--border); font-weight:700; color:var(--text-muted); font-size:11px;">
                    <th style="padding:6px 4px; width:55px;">Pedido</th>
                    <th style="padding:6px 4px;">Detalles de la Prenda & Novedades</th>
                    <th style="padding:6px 4px; text-align:center; width:90px;">Conteo</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    // 1. Originales
    groupItems.forEach(item => {
        if (item.items && item.items.length > 0) {
            item.items.forEach(sub => {
                const key = `${item.id}_${sub.type}`;
                if (currentCollectedItemsMap[key] === undefined) {
                    currentCollectedItemsMap[key] = sub.quantity;
                }
                const count = currentCollectedItemsMap[key];
                const comment = currentCollectedItemsCommentsMap[key] || "";
                tableHtml += `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                        <td style="padding:8px 4px; font-weight:700; color:var(--primary); vertical-align:top; padding-top:12px;">#${item.ticket_number || 'N/A'}</td>
                        <td style="padding:8px 4px; vertical-align:top;">
                            <div style="font-weight:600; font-size:12px;">${escapeHtml(sub.type)}</div>
                            <div style="font-size:10px; color:var(--text-muted); font-style:italic; margin-bottom:6px;">Esperadas: ${sub.quantity} ud.</div>
                            
                            <div style="margin-top:4px;">
                                <input type="text" id="comment-${item.id}-${escapeHtml(sub.type)}" placeholder="Reportar daño, rotura, incoherencia..." value="${escapeHtml(comment)}" oninput="updateItemComment('${item.id}', '${escapeHtml(sub.type)}', this.value)" style="width:100%; padding:6px 8px; font-size:11px; border-radius:6px; border:1px solid var(--border); background:var(--bg-input); color:var(--text-main); outline:none;">
                            </div>
                        </td>
                        <td style="padding:8px 4px; text-align:center; vertical-align:top; padding-top:12px;">
                            <div style="display:inline-flex; align-items:center; gap:6px; background:var(--bg-input); padding:2px 6px; border-radius:8px; border:1px solid var(--border);">
                                <button class="btn" onclick="adjustGroupedItemCount('${item.id}', '${escapeHtml(sub.type)}', -1)" style="width:20px; height:20px; border-radius:4px; padding:0; display:flex; align-items:center; justify-content:center; font-size:12px; background:var(--bg-card); border-color:var(--border); font-weight:bold; color:var(--text-main);">-</button>
                                <span id="count-${item.id}-${escapeHtml(sub.type)}" style="font-weight:700; font-size:12px; min-width:18px; text-align:center; color:var(--text-main);">${count}</span>
                                <button class="btn" onclick="adjustGroupedItemCount('${item.id}', '${escapeHtml(sub.type)}', 1)" style="width:20px; height:20px; border-radius:4px; padding:0; display:flex; align-items:center; justify-content:center; font-size:12px; background:var(--bg-card); border-color:var(--border); font-weight:bold; color:var(--text-main);">+</button>
                            </div>
                        </td>
                    </tr>
                `;
            });
        } else {
            const key = `${item.id}_prendas_generales`;
            if (currentCollectedItemsMap[key] === undefined) {
                currentCollectedItemsMap[key] = item.expected_items || 1;
            }
            const count = currentCollectedItemsMap[key];
            const comment = currentCollectedItemsCommentsMap[key] || "";
            tableHtml += `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    <td style="padding:8px 4px; font-weight:700; color:var(--primary); vertical-align:top; padding-top:12px;">#${item.ticket_number || 'N/A'}</td>
                    <td style="padding:8px 4px; vertical-align:top;">
                        <div style="font-weight:600; font-size:12px;">Prendas Generales</div>
                        <div style="font-size:10px; color:var(--text-muted); font-style:italic; margin-bottom:6px;">Esperadas: ${item.expected_items || 1} ud.</div>
                        
                        <div style="margin-top:4px;">
                            <input type="text" id="comment-${item.id}-prendas_generales" placeholder="Reportar daño, rotura, incoherencia..." value="${escapeHtml(comment)}" oninput="updateItemComment('${item.id}', 'prendas_generales', this.value)" style="width:100%; padding:6px 8px; font-size:11px; border-radius:6px; border:1px solid var(--border); background:var(--bg-input); color:var(--text-main); outline:none;">
                        </div>
                    </td>
                    <td style="padding:8px 4px; text-align:center; vertical-align:top; padding-top:12px;">
                        <div style="display:inline-flex; align-items:center; gap:6px; background:var(--bg-input); padding:2px 6px; border-radius:8px; border:1px solid var(--border);">
                            <button class="btn" onclick="adjustGroupedItemCount('${item.id}', 'prendas_generales', -1)" style="width:20px; height:20px; border-radius:4px; padding:0; display:flex; align-items:center; justify-content:center; font-size:12px; background:var(--bg-card); border-color:var(--border); font-weight:bold; color:var(--text-main);">-</button>
                            <span id="count-${item.id}-prendas_generales" style="font-weight:700; font-size:12px; min-width:18px; text-align:center; color:var(--text-main);">${count}</span>
                            <button class="btn" onclick="adjustGroupedItemCount('${item.id}', 'prendas_generales', 1)" style="width:20px; height:20px; border-radius:4px; padding:0; display:flex; align-items:center; justify-content:center; font-size:12px; background:var(--bg-card); border-color:var(--border); font-weight:bold; color:var(--text-main);">+</button>
                        </div>
                    </td>
                </tr>
            `;
        }
    });
    
    // 2. Extras
    currentExtraGarmentsList.forEach((extra, index) => {
        tableHtml += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); background: rgba(139,92,246,0.02);">
                <td style="padding:8px 4px; font-weight:700; color:var(--secondary); vertical-align:top; padding-top:12px;">Extra</td>
                <td style="padding:8px 4px; vertical-align:top;">
                    <div style="font-weight:700; font-size:12px; color:var(--text-main); display:flex; align-items:center; gap:4px;">
                        <span>${escapeHtml(extra.type)}</span>
                        <span onclick="removeExtraGarment(${index})" style="color:#ef4444; font-size:10px; cursor:pointer; font-weight:bold; margin-left:6px;">[Quitar]</span>
                    </div>
                    <div style="font-size:10px; color:var(--text-muted); font-style:italic; margin-bottom:6px;">Añadida manualmente</div>
                    
                    <div style="margin-top:4px;">
                        <input type="text" id="comment-extra-${index}" placeholder="Reportar detalle/novedad..." value="${escapeHtml(extra.comment)}" oninput="updateExtraGarmentComment(${index}, this.value)" style="width:100%; padding:6px 8px; font-size:11px; border-radius:6px; border:1px solid var(--border); background:var(--bg-input); color:var(--text-main); outline:none;">
                    </div>
                </td>
                <td style="padding:8px 4px; text-align:center; vertical-align:top; padding-top:12px;">
                    <div style="display:inline-flex; align-items:center; gap:6px; background:var(--bg-input); padding:2px 6px; border-radius:8px; border:1px solid var(--border);">
                        <button class="btn" onclick="adjustExtraGarmentCount(${index}, -1)" style="width:20px; height:20px; border-radius:4px; padding:0; display:flex; align-items:center; justify-content:center; font-size:12px; background:var(--bg-card); border-color:var(--border); font-weight:bold; color:var(--text-main);">-</button>
                        <span id="count-extra-${index}" style="font-weight:700; font-size:12px; min-width:18px; text-align:center; color:var(--text-main);">${extra.quantity}</span>
                        <button class="btn" onclick="adjustExtraGarmentCount(${index}, 1)" style="width:20px; height:20px; border-radius:4px; padding:0; display:flex; align-items:center; justify-content:center; font-size:12px; background:var(--bg-card); border-color:var(--border); font-weight:bold; color:var(--text-main);">+</button>
                    </div>
                </td>
            </tr>
        `;
    });
    
    tableHtml += `
            </tbody>
        </table>
    `;
    
    const tableDiv = document.getElementById("modal-garments-verification-table");
    if (tableDiv) tableDiv.innerHTML = tableHtml;
    
    updateGroupedItemsSummary();
}

function updateExtraGarmentComment(index, val) {
    if (currentExtraGarmentsList[index]) {
        currentExtraGarmentsList[index].comment = val;
    }
}



function adjustExtraGarmentCount(index, dir) {
    if (currentExtraGarmentsList[index]) {
        currentExtraGarmentsList[index].quantity += dir;
        if (currentExtraGarmentsList[index].quantity < 0) {
            currentExtraGarmentsList[index].quantity = 0;
        }
        renderGarmentsVerificationTable();
    }
}

function removeExtraGarment(index) {
    currentExtraGarmentsList.splice(index, 1);
    renderGarmentsVerificationTable();
    addSystemLog("👔 Prenda manual eliminada.");
}

function showAddExtraGarmentForm() {
    const form = document.getElementById("extra-garment-form");
    if (form) {
        form.style.display = "block";
        document.getElementById("extra-garment-name").focus();
    }
}

function hideAddExtraGarmentForm() {
    const form = document.getElementById("extra-garment-form");
    if (form) {
        form.style.display = "none";
        document.getElementById("extra-garment-name").value = "";
        document.getElementById("extra-garment-qty").value = "1";
        document.getElementById("extra-garment-comment").value = "";
    }
}

function addExtraGarmentToVerification() {
    const nameInput = document.getElementById("extra-garment-name");
    const qtyInput = document.getElementById("extra-garment-qty");
    const commentInput = document.getElementById("extra-garment-comment");
    
    const name = nameInput.value.trim();
    const qty = parseInt(qtyInput.value) || 1;
    const comment = commentInput.value.trim() || "✅ Prenda adicionada en sitio";
    
    if (!name) {
        alert("Por favor, ingresa el nombre de la prenda.");
        return;
    }
    
    currentExtraGarmentsList.push({
        type: name,
        quantity: qty,
        comment: comment,
        tempId: 'extra_' + Date.now()
    });
    
    addSystemLog(`👔 Prenda manual añadida: ${qty}x ${name}`);
    renderGarmentsVerificationTable();
    hideAddExtraGarmentForm();
}

function updateItemComment(orderId, itemType, commentValue) {
    const key = `${orderId}_${itemType}`;
    if (!currentCollectedItemsCommentsMap) {
        currentCollectedItemsCommentsMap = {};
    }
    currentCollectedItemsCommentsMap[key] = commentValue;
}



// Lightbox para agrandar imágenes
function openLightbox(src) {
    const lightbox = document.getElementById("image-lightbox");
    const img = document.getElementById("lightbox-img");
    if (lightbox && img) {
        img.src = src;
        lightbox.style.display = "flex";
    }
}

function closeLightbox() {
    const lightbox = document.getElementById("image-lightbox");
    if (lightbox) {
        lightbox.style.display = "none";
    }
}

// Registro de Fachada y Coordenadas GPS
let activeFacadeOrderId = null;

function captureFacadeAndGPS(orderId) {
    const d = deliveries.find(item => item.id === orderId);
    if (!d) return;
    
    // Abrir input de cámara
    const cameraInput = document.getElementById("facade-camera-input");
    if (cameraInput) {
        activeFacadeOrderId = orderId;
        cameraInput.click();
    }
}

function getFacadePhotosList(d) {
    if (!d || !d.facade_photo) return [];
    try {
        const parsed = JSON.parse(d.facade_photo);
        if (Array.isArray(parsed)) {
            return parsed.filter(Boolean);
        }
    } catch (e) {}
    if (typeof d.facade_photo === 'string' && d.facade_photo.trim() !== '') {
        return [d.facade_photo];
    }
    return [];
}

async function deleteFacadePhoto(orderId, index) {
    const d = deliveries.find(item => item.id === orderId);
    if (!d) return;
    
    let list = getFacadePhotosList(d);
    list.splice(index, 1);
    
    const newVal = list.length > 0 ? JSON.stringify(list) : null;
    
    deliveries.forEach(item => {
        if (item.client_phone === d.client_phone) {
            item.facade_photo = newVal;
            item.sync_pending = true;
        }
    });
    
    if (db) {
        const localItems = await promiseWithTimeout(db.deliveries.where('client_phone').equals(d.client_phone).toArray(), 2000, "Dexie facade delete query timeout");
        for (const item of localItems) {
            item.facade_photo = newVal;
            item.sync_pending = true;
            await promiseWithTimeout(db.deliveries.put(item), 1500, "Dexie facade delete put timeout");
        }
    } else {
        if (newVal) {
            localStorage.setItem("photo_facade_" + d.client_phone, newVal);
        } else {
            localStorage.removeItem("photo_facade_" + d.client_phone);
        }
        await saveDeliveries();
    }
    
    triggerBackgroundSync();
    
    const currentView = document.getElementById("main-app-content");
    if (currentView) {
        currentView.innerHTML = "";
        renderDeliveriesView(currentView);
    }
    
    openFacadeModal(null, orderId);
    addSystemLog("🗑️ Foto de fachada eliminada.");
}

function captureRealtimeGps(event, orderId) {
    if (event) event.stopPropagation();
    
    const d = deliveries.find(item => item.id === orderId);
    if (!d) return;
    
    const statusEl = document.getElementById("facade-gps-status");
    if (statusEl) {
        statusEl.innerHTML = `
            <span style="color: var(--primary); font-weight: 700; display: flex; align-items: center; gap: 6px;">
                <span class="pulse-radar" style="display: inline-block; width: 10px; height: 10px; background: var(--primary); border-radius: 50%;"></span>
                Obteniendo ubicación satelital (Alta Precisión)...
            </span>
        `;
    }
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                await saveFacadeData(d.client_phone, null, lat, lng);
                addSystemLog("📡 Ubicación GPS (Alta Precisión) obtenida.");
            },
            (error) => {
                console.warn("⚠️ Geolocalización con alta precisión fallida. Reintentando con baja precisión...", error);
                if (statusEl) {
                    statusEl.innerHTML = `
                        <span style="color: var(--warning); font-weight: 700; display: flex; align-items: center; gap: 6px;">
                            <span class="pulse-radar" style="display: inline-block; width: 10px; height: 10px; background: var(--warning); border-radius: 50%;"></span>
                            Buscando por red/celdas (Baja Precisión)...
                        </span>
                    `;
                }
                
                navigator.geolocation.getCurrentPosition(
                    async (position2) => {
                        const lat = position2.coords.latitude;
                        const lng = position2.coords.longitude;
                        await saveFacadeData(d.client_phone, null, lat, lng);
                        addSystemLog("📡 Ubicación GPS (Baja Precisión) obtenida.");
                    },
                    (error2) => {
                        console.warn("❌ Geolocalización fallida completamente:", error2);
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color: var(--danger); font-weight: 700;">❌ Error al obtener GPS: ${error2.message}</span>`;
                        }
                    },
                    { enableHighAccuracy: false, timeout: 5000 }
                );
            },
            { enableHighAccuracy: true, timeout: 4000 }
        );
    } else {
        if (statusEl) {
            statusEl.innerHTML = `<span style="color: var(--danger); font-weight: 700;">❌ Geolocalización no soportada en el navegador.</span>`;
        }
    }
}

async function geocodeClientAddress(event, orderId) {
    if (event) event.stopPropagation();
    
    const d = deliveries.find(item => item.id === orderId);
    if (!d) return;
    
    const statusEl = document.getElementById("facade-gps-status");
    if (statusEl) {
        statusEl.innerHTML = `
            <span style="color: var(--primary); font-weight: 700; display: flex; align-items: center; gap: 6px;">
                <span class="pulse-radar" style="display: inline-block; width: 10px; height: 10px; background: var(--primary); border-radius: 50%;"></span>
                Resolviendo dirección en el servidor...
            </span>
        `;
    }
    
    try {
        const res = await fetch(`/api/geocode?address=${encodeURIComponent(d.address)}`);
        if (res.ok) {
            const result = await res.json();
            if (result.success) {
                await saveFacadeData(d.client_phone, null, result.latitude, result.longitude);
                addSystemLog("📡 Dirección resuelta a coordenadas con éxito.");
            } else {
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color: var(--danger); font-weight: 700;">❌ No se pudo resolver la dirección.</span>`;
                }
            }
        } else {
            if (statusEl) {
                statusEl.innerHTML = `<span style="color: var(--danger); font-weight: 700;">❌ Error del servidor de geolocalización.</span>`;
            }
        }
    } catch (e) {
        console.error(e);
        if (statusEl) {
            statusEl.innerHTML = `<span style="color: var(--danger); font-weight: 700;">❌ Error de conexión al servidor.</span>`;
        }
    }
}

function compressImage(base64Str, maxWidth = 800, maxHeight = 800, quality = 0.7) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = function() {
            let width = img.width;
            let height = img.height;
            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width = Math.round((width * maxHeight) / height);
                    height = maxHeight;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
            resolve(compressedBase64);
        };
        img.onerror = function() {
            resolve(base64Str);
        };
    });
}

function handleFacadePhoto(event) {
    const file = event.target.files[0];
    if (!file || !activeFacadeOrderId) return;
    
    const d = deliveries.find(item => item.id === activeFacadeOrderId);
    if (!d) return;
    
    addSystemLog("⏳ Procesando foto de fachada...");
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const rawBase64 = e.target.result;
        
        // Comprimir imagen a resolución optimizada (max 800px, 70% calidad) para no saturar LocalStorage ni red
        addSystemLog("⚡ Optimizando tamaño de la imagen...");
        const base64 = await compressImage(rawBase64, 800, 800, 0.7);
        
        // Obtener fotos actuales
        let list = getFacadePhotosList(d);
        if (list.length >= 4) {
            alert("⚠️ Límite de 4 fotos de fachada alcanzado. Por favor elimina alguna para agregar una nueva.");
            return;
        }
        list.push(base64);
        const newVal = JSON.stringify(list);
        
        // 1. Guardar de forma inmediata para respuesta visual instantánea (Demora 0ms)
        await saveFacadeData(d.client_phone, newVal, null, null);
        addSystemLog("🏡 Foto de fachada agregada exitosamente.");
        
        // 2. Obtener geolocalización en segundo plano de forma asíncrona (no bloqueante)
        if (navigator.geolocation) {
            addSystemLog("📡 Obteniendo coordenadas satelitales en segundo plano...");
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    await saveFacadeData(d.client_phone, null, lat, lng);
                    addSystemLog(`📡 Coordenadas GPS actualizadas en segundo plano: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                },
                (gpsErr) => {
                    console.warn("⚠️ No se pudo obtener ubicación en segundo plano:", gpsErr);
                },
                { enableHighAccuracy: true, timeout: 5000 }
            );
        }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
}

async function saveFacadeData(clientPhone, photoBase64, lat, lng) {
    deliveries.forEach(item => {
        if (item.client_phone === clientPhone) {
            if (photoBase64) item.facade_photo = photoBase64;
            if (lat) item.facade_latitude = lat;
            if (lng) item.facade_longitude = lng;
            item.sync_pending = true;
        }
    });
    
    if (db) {
        const localItems = await promiseWithTimeout(db.deliveries.where('client_phone').equals(clientPhone).toArray(), 2000, "Dexie facade save query timeout");
        for (const item of localItems) {
            if (photoBase64) item.facade_photo = photoBase64;
            if (lat) item.facade_latitude = lat;
            if (lng) item.facade_longitude = lng;
            item.sync_pending = true;
            await promiseWithTimeout(db.deliveries.put(item), 1500, "Dexie facade save put timeout");
        }
    } else {
        if (photoBase64) {
            localStorage.setItem("photo_facade_" + clientPhone, photoBase64);
        }
        await saveDeliveries();
    }
    
    triggerBackgroundSync();
    
    const currentView = document.getElementById("main-app-content");
    if (currentView) {
        currentView.innerHTML = "";
        renderDeliveriesView(currentView);
    }
    
    if (activeFacadeOrderId) {
        openFacadeModal(null, activeFacadeOrderId);
    }
}

function openGpsMaps(lat, lng) {
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    window.open(url, "_blank");
}

function openFacadeModal(event, orderId) {
    if (event) event.stopPropagation();
    
    const d = deliveries.find(item => item.id === orderId);
    if (!d) return;
    
    activeFacadeOrderId = orderId;
    const photos = getFacadePhotosList(d);
    const hasGps = d.facade_latitude && d.facade_longitude;
    
    let photosGalleryHtml = "";
    if (photos.length > 0) {
        photosGalleryHtml = `
            <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; width: 100%; box-sizing: border-box; margin-bottom: 8px;">
                ${photos.map((src, index) => `
                    <div class="facade-thumbnail">
                        <img src="${src}" onclick="openLightbox('${src}')" title="Ampliar imagen">
                        <span class="facade-thumbnail-remove" onclick="deleteFacadePhoto('${d.id}', ${index})">×</span>
                    </div>
                `).join('')}
                ${photos.length < 4 ? `
                    <div onclick="captureFacadeAndGPS('${d.id}')" style="width: 68px; height: 68px; border: 1.5px dashed var(--primary); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--primary); cursor: pointer; font-size: 20px; transition: all 0.2s; background: rgba(255,255,255,0.02);" onmouseover="this.style.background='rgba(139,92,246,0.05)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
                        ➕
                    </div>
                ` : ''}
            </div>
        `;
    } else {
        photosGalleryHtml = `
            <div onclick="captureFacadeAndGPS('${d.id}')" style="padding: 30px; text-align: center; color: var(--text-muted); border: 1.5px dashed var(--border); border-radius: 12px; width: 100%; box-sizing: border-box; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.01);" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
                <div style="font-size: 24px; margin-bottom: 6px;">📷</div>
                <div style="font-size: 11px; font-weight: 600;">Tomar Fotos de Fachada</div>
                <div style="font-size: 9px; color: var(--text-muted); margin-top: 2px;">(Toma hasta 4 fotos diferentes)</div>
            </div>
        `;
    }
    
    let modalBodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 15px; align-items: center;">
            
            <!-- Datos del Cliente -->
            <div style="text-align: left; width: 100%; font-size: 12px; color: var(--text-main); line-height: 1.5; background: rgba(255,255,255,0.02); padding: 12px; border-radius: 12px; border: 1px solid var(--border); box-sizing: border-box; display: flex; flex-direction: column; gap: 4px;">
                <div>👤 <strong>Cliente:</strong> ${escapeHtml(d.client_name)}</div>
                <div>📍 <strong>Dirección:</strong> ${escapeHtml(d.address)}</div>
            </div>
            
            <!-- Galería de Fotos -->
            <div style="width: 100%; text-align: left;">
                <div style="font-weight: 700; color: var(--primary); font-size: 11px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">🏡 Fotos de Fachada y Casa</div>
                ${photosGalleryHtml}
            </div>
            
            <!-- Ubicación Satelital en Tiempo Real -->
            <div style="width: 100%; text-align: left; padding: 12px; background: rgba(16, 185, 129, 0.03); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 12px; box-sizing: border-box;">
                <div style="font-weight: 700; color: #10b981; font-size: 11px; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                    🛰️ Ubicación GPS en Tiempo Real
                </div>
                <div id="facade-gps-status" style="font-size: 11px; color: var(--text-muted); line-height: 1.4; margin-bottom: 10px;">
                    ${hasGps ? `📌 Coordenadas guardadas:<br/><strong style="color:var(--text-main); font-size:12px;">${d.facade_latitude.toFixed(6)}, ${d.facade_longitude.toFixed(6)}</strong>` : '❌ Sin coordenadas GPS de fachada registradas para este cliente.'}
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;">
                    <div style="display: flex; gap: 8px; width: 100%;">
                        <button class="btn" onclick="captureRealtimeGps(event, '${d.id}')" style="flex: 1; background: rgba(139, 92, 246, 0.08); border-color: rgba(139, 92, 246, 0.3); color: var(--primary); padding: 8px; font-size: 11px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(139, 92, 246, 0.15)'" onmouseout="this.style.background='rgba(139, 92, 246, 0.08)'">
                            🛰️ Satélite (Móvil)
                        </button>
                        <button class="btn" onclick="geocodeClientAddress(event, '${d.id}')" style="flex: 1; background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.3); color: #10b981; padding: 8px; font-size: 11px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(16, 185, 129, 0.15)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.08)'">
                            🌐 Por Dirección
                        </button>
                    </div>
                    ${hasGps ? `
                        <button class="btn" onclick="openGpsMaps(${d.facade_latitude}, ${d.facade_longitude})" style="width: 100%; background: #10b981; border-color: #10b981; color: white; padding: 8px; font-size: 11px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 4px; font-weight: bold; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">
                            🗺️ Abrir en Google Maps
                        </button>
                    ` : ''}
                </div>
            </div>
            
        </div>
    `;
    
    const bodyEl = document.getElementById("facade-modal-body");
    if (bodyEl) bodyEl.innerHTML = modalBodyHtml;
    
    const modalEl = document.getElementById("facade-detail-modal");
    if (modalEl) modalEl.style.display = "flex";
}

function closeFacadeModal() {
    const modalEl = document.getElementById("facade-detail-modal");
    if (modalEl) modalEl.style.display = "none";
}

function captureFacadeAndGPSFromCard(event, orderId) {
    if (event) event.stopPropagation();
    captureFacadeAndGPS(orderId);
}

// Abrir modal
function openConfirmModal(id) {
    currentActiveDeliveryId = id;
    const ids = id.split(',');
    const mainId = ids[0];
    const groupItems = deliveries.filter(d => ids.includes(d.id));
    const d = groupItems.find(d => d.id === mainId);
    
    if (d) {
        document.getElementById('modal-client-name').textContent = "Entrega: " + d.client_name;
        
        // Sumar montos del grupo
        const totalAmt = groupItems.reduce((sum, item) => sum + (item.amount || 0), 0);
        document.getElementById('modal-amount').textContent = "$" + totalAmt.toLocaleString();
        
        // Inicializar mapas de conteo, comentarios y lista de prendas extras
        currentCollectedItemsMap = {};
        currentCollectedItemsCommentsMap = {};
        currentExtraGarmentsList = [];
        hideAddExtraGarmentForm();
        
        groupItems.forEach(item => {
            let parsedComments = {};
            if (item.items_comments) {
                try {
                    parsedComments = typeof item.items_comments === 'string' ? JSON.parse(item.items_comments) : item.items_comments;
                } catch (e) {
                    parsedComments = {};
                }
            }
            Object.keys(parsedComments).forEach(type => {
                currentCollectedItemsCommentsMap[`${item.id}_${type}`] = parsedComments[type];
            });
        });

        // Generar la tabla dinámicamente
        renderGarmentsVerificationTable();

        // Resetear fotos y firma
        capturedPhotosList = [];
        if (d.evidence_photo) {
            try {
                const parsed = JSON.parse(d.evidence_photo);
                if (Array.isArray(parsed)) {
                    capturedPhotosList = parsed.filter(Boolean);
                } else if (d.evidence_photo !== "foto_evidencia.png" && d.evidence_photo.trim() !== "") {
                    capturedPhotosList = [d.evidence_photo];
                }
            } catch (e) {
                if (d.evidence_photo !== "foto_evidencia.png" && d.evidence_photo.trim() !== "") {
                    capturedPhotosList = [d.evidence_photo];
                }
            }
        }
        
        renderPhotosGallery();
        hasSigned = false;
        updateCompleteButtonState();

        document.getElementById('confirm-modal').style.display = 'flex';
        
        setTimeout(initSignatureCanvasEvents, 100);
    }
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    currentActiveDeliveryId = null;
}

function formatShortAddress(address) {
    if (!address) return '';
    if (address === 'Recogida WhatsApp') return '⚠️ Recogida WhatsApp';
    
    // Si no contiene comas, asumimos que es una dirección cruda ya corta
    if (!address.includes(',')) {
        return address.replace(/:$/, '').trim();
    }
    
    const parts = address.split(',').map(p => p.trim());
    const street = parts[0];
    let neighborhood = parts[1] || '';
    let locality = '';
    
    // Buscar la localidad en las partes
    for (const part of parts) {
        if (part.toLowerCase().includes('localidad')) {
            locality = part.replace(/localidad/i, '').trim();
            break;
        }
    }
    
    // Si la segunda parte es un código postal o "UPZs de Bogotá", buscar otra que sirva como barrio
    if (neighborhood.toLowerCase().includes('upz') || /^\d+$/.test(neighborhood) || neighborhood.toLowerCase().includes('bogotá') || neighborhood.toLowerCase() === locality.toLowerCase()) {
        neighborhood = '';
    }
    
    let result = street;
    if (neighborhood) {
        result += `, ${neighborhood}`;
    }
    if (locality) {
        result += ` (${locality})`;
    }
    return result;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function extractDeliveryNotes(chatText) {
    if (!chatText) return "Ninguna indicación especial encontrada en el chat.";
    
    const lines = chatText.split('\n');
    const keywords = ['apto', 'apartamento', 'casa', 'piso', 'torre', 'bloque', 'conjunto', 'porteria', 'portería', 'timbre', 'timbrar', 'tocar', 'reja', 'esquina', 'local', 'indicacion', 'indicación', 'indicaciones'];
    const matches = [];
    
    lines.forEach(line => {
        const lower = line.toLowerCase();
        if (keywords.some(keyword => lower.includes(keyword)) && !lower.includes('checkout.bold.co') && !lower.includes('pago')) {
            const cleanLine = line.replace(/^\s*[-*•]\s*/, '').trim();
            if (cleanLine.length > 5 && cleanLine.length < 150) {
                matches.push(cleanLine);
            }
        }
    });
    
    if (matches.length === 0) {
        return "No se encontraron indicaciones especiales explícitas en el chat.";
    }
    return matches.map(m => `• ${m}`).join('\n');
}

function openChatTranscriptionModal(id) {
    const d = deliveries.find(item => item.id === id);
    if (!d) return;

    // 1. Calcular las ubicaciones de hermanos agendados hoy (excluyendo "Recogida WhatsApp")
    const siblingDeliveries = deliveries.filter(item => 
        item.order_date === d.order_date && 
        item.client_name === d.client_name &&
        item.client_phone === d.client_phone
    );
    const uniqueLocations = [];
    siblingDeliveries.forEach(item => {
        if (item.address === 'Recogida WhatsApp') return;
        
        let isNew = true;
        for (const loc of uniqueLocations) {
            // Comparar texto simplificado
            const cleanA = (item.raw_address || item.address || "").toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanB = (loc.rawAddress || "").toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
                isNew = false;
                break;
            }
            // Comparar coordenadas GPS por proximidad
            if (item.latitude && item.longitude && loc.latitude && loc.longitude) {
                const latDiff = Math.abs(item.latitude - loc.latitude);
                const lngDiff = Math.abs(item.longitude - loc.longitude);
                if (latDiff < 0.003 && lngDiff < 0.003) {
                    isNew = false;
                    break;
                }
            }
        }
        if (isNew) {
            let displayAddress = item.raw_address || item.address;
            if (displayAddress && displayAddress.includes(",")) {
                displayAddress = displayAddress.split(",")[0].trim();
            }
            uniqueLocations.push({
                display: displayAddress,
                rawAddress: item.raw_address || item.address,
                latitude: item.latitude,
                longitude: item.longitude
            });
        }
    });

    // 2. Alerta consolidada de ruta
    let routingHtml = "";
    if (siblingDeliveries.length > 1) {
        let addressesListHtml = "";
        if (uniqueLocations.length > 1) {
            addressesListHtml = `
                <div style="margin-top: 6px; font-weight: 700; color: #f87171;">⚠️ Puntos de entrega diferentes para hoy:</div>
                <ul style="margin: 4px 0 0 12px; padding: 0; list-style-type: disc; color: var(--text-main);">
                    ${uniqueLocations.map(loc => `<li>${loc.display}</li>`).join('')}
                </ul>
            `;
        } else {
            addressesListHtml = `<div style="margin-top: 4px; color: var(--success); font-weight: 600;">✅ Todos los pedidos corresponden al mismo domicilio.</div>`;
        }
        routingHtml = `
            <div style="margin-top: 8px; padding: 10px; background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 8px; font-size: 11px;">
                <strong>👥 Consolidado de Ruta:</strong> El cliente tiene <strong>${siblingDeliveries.length} pedidos hoy</strong>.
                ${addressesListHtml}
            </div>
        `;
    }

    // 3. Detalles de prendas y servicios
    let itemsListHtml = "";
    if (d.items && d.items.length > 0) {
        itemsListHtml = d.items.map(item => `• ${item.quantity}x ${escapeHtml(item.type)}`).join('<br/>');
    } else {
        itemsListHtml = `• ${d.expected_items} prendas esperadas (Plan no especificado)`;
    }

    // Verificar prendas extras guardadas en items_comments
    if (d.items_comments) {
        try {
            const parsed = typeof d.items_comments === 'string' ? JSON.parse(d.items_comments) : d.items_comments;
            if (parsed && parsed.__extra_garments__) {
                const extras = parsed.__extra_garments__;
                extras.forEach(extra => {
                    itemsListHtml += `<br/><span style="color: #a78bfa; font-weight: bold;">• [Extra] ${extra.quantity}x ${escapeHtml(extra.type)} (${escapeHtml(extra.comment || '')})</span>`;
                });
            }
        } catch (e) {}
    }

    // 4. Pago consolidado
    const payDetails = d.payment_details ? d.payment_details : "Sin detalles de pago específicos (Pago en punto o contraentrega).";

    // 5. Indicaciones del chat
    const chatNotes = extractDeliveryNotes(d.chat_transcription);

    // 5.1 Evidencias fotográficas si está entregado
    let evidencePhotosHtml = "";
    if (d.status === "ENTREGADO" && d.evidence_photo) {
        let photosList = [];
        try {
            const parsed = JSON.parse(d.evidence_photo);
            if (Array.isArray(parsed)) {
                photosList = parsed.filter(Boolean);
            } else if (d.evidence_photo !== "foto_evidencia.png" && d.evidence_photo.trim() !== "") {
                photosList = [d.evidence_photo];
            }
        } catch (e) {
            if (d.evidence_photo !== "foto_evidencia.png" && d.evidence_photo.trim() !== "") {
                photosList = [d.evidence_photo];
            }
        }
        
        if (photosList.length > 0) {
            evidencePhotosHtml = `
                <div style="border-top: 1px dashed var(--border); padding-top: 8px; margin-top: 8px;">
                    <div style="font-weight: 700; color: var(--primary); font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">📸 EVIDENCIAS DE ENTREGA</div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${photosList.map(src => `
                            <img src="${src}" onclick="openLightbox('${src}')" style="width: 55px; height: 55px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); cursor: zoom-in; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }

    // 6. Ocultar campos viejos redundantes del modal
    document.getElementById('chat-modal-address').style.display = 'none';
    document.getElementById('chat-modal-amount').style.display = 'none';
    
    // Ocultar sección vieja de detalles de pago para evitar duplicados
    const payDetailsEl = document.getElementById('chat-modal-payment-details');
    if (payDetailsEl && payDetailsEl.parentNode) {
        payDetailsEl.parentNode.style.display = 'none';
    }

    // Ocultar el elemento de raw address dinámico anterior si existe
    const oldRawEl = document.getElementById('chat-modal-raw-address');
    if (oldRawEl) {
        oldRawEl.style.display = 'none';
    }

    // 7. Renderizar cabecera básica del cliente
    document.getElementById('chat-modal-title').textContent = `Pedido #${d.ticket_number || 'N/A'}`;
    
    const statusPill = document.getElementById('chat-modal-status');
    statusPill.textContent = d.status === 'PENDIENTE' ? 'Pendiente' : (d.status === 'EN_RUTA' ? 'En Ruta' : 'Entregado');
    statusPill.className = `status-pill ${d.status === 'PENDIENTE' ? 'pending' : (d.status === 'EN_RUTA' ? 'route' : 'delivered')}`;

    document.getElementById('chat-modal-client-name').textContent = d.client_name;
    document.getElementById('chat-modal-phone').textContent = `Celular: +${d.client_phone}`;

    // 8. Caja de Resumen Integrado (Pulido, sin tanto texto, súper ordenado)
    const summaryBoxHtml = `
        <div class="summary-route-box" style="padding: 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 10px; font-size: 12px; color: var(--text-main); line-height: 1.5; display: flex; flex-direction: column; gap: 10px;">
            
            <!-- Sección: Planificación de Entrega -->
            <div style="border-bottom: 1px dashed var(--border); padding-bottom: 8px;">
                <div style="font-weight: 700; color: var(--primary); font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">📍 PLANIFICACIÓN DE ENTREGA</div>
                <div><strong>Dirección de entrega:</strong> ${formatShortAddress(d.address)}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;"><strong>Original escrita:</strong> "${escapeHtml(d.raw_address || d.address)}"</div>
                ${routingHtml}
            </div>

            <!-- Sección: Prendas y Servicios -->
            <div style="border-bottom: 1px dashed var(--border); padding-bottom: 8px;">
                <div style="font-weight: 700; color: var(--secondary); font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">👔 DETALLE DEL SERVICIO</div>
                <div style="color: var(--text-main); font-weight: 500;">${itemsListHtml}</div>
            </div>

            <!-- Sección: Detalles de Pago -->
            <div style="border-bottom: 1px dashed var(--border); padding-bottom: 8px;">
                <div style="font-weight: 700; color: #10b981; font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">💰 INFORMACIÓN DE PAGO</div>
                <div><strong>Total:</strong> $${d.amount.toLocaleString()} (${d.pay_method})</div>
                <div style="font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 2px;">"${payDetails}"</div>
            </div>

            <!-- Sección: Indicaciones de Entrega -->
            <div>
                <div style="font-weight: 700; color: #a78bfa; font-size: 13px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">ℹ️ INDICACIONES Y PUNTOS DE REFERENCIA</div>
                <div style="background: rgba(255,255,255,0.02); padding: 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05); color: var(--text-muted); font-style: italic; margin-bottom: 8px;">
                    ${chatNotes}
                </div>
            </div>
            
            ${evidencePhotosHtml}
            
        </div>
    `;

    // 9. Inyectar en su propia sección limpia
    const routeSummaryEl = document.getElementById('chat-modal-route-summary');
    if (routeSummaryEl) {
        routeSummaryEl.innerHTML = summaryBoxHtml;
    }

    // 10. Chat transcription (sin resumen crítico dentro, solo el historial)
    const transcriptEl = document.getElementById('chat-modal-transcript');
    if (d.chat_transcription) {
        transcriptEl.innerHTML = `
            <pre style="white-space: pre-wrap; font-family: inherit; font-size: 11px; margin: 0; color: var(--text-muted); line-height: 1.4;">${escapeHtml(d.chat_transcription)}</pre>
        `;
    } else {
        transcriptEl.innerHTML = `<span style="color:var(--text-muted); font-style:italic;">No hay transcripción de chat disponible para este despacho.</span>`;
    }

    document.getElementById('chat-details-modal').style.display = 'flex';
}

function closeChatDetailsModal() {
    document.getElementById('chat-details-modal').style.display = 'none';
}

async function confirmDelivery() {
    const ids = currentActiveDeliveryId.split(',');
    const mainId = ids[0];
    
    const deliveriesToConfirm = deliveries.filter(d => ids.includes(d.id));
    if (deliveriesToConfirm.length > 0) {
        let lat = null;
        let lng = null;
        
        const applyConfirmation = async () => {
            deliveriesToConfirm.forEach(d => {
                d.status = "ENTREGADO";
                d.evidence_photo = JSON.stringify(capturedPhotosList);
                d.signature_drawn = true;
                
                // Construir el mapa de comentarios específico para esta orden
                const orderComments = {};
                if (d.items && d.items.length > 0) {
                    let orderCollected = 0;
                    d.items.forEach(sub => {
                        const key = `${d.id}_${sub.type}`;
                        const count = currentCollectedItemsMap[key] !== undefined ? currentCollectedItemsMap[key] : sub.quantity;
                        orderCollected += count;
                        
                        if (currentCollectedItemsCommentsMap[key]) {
                            orderComments[sub.type] = currentCollectedItemsCommentsMap[key];
                        }
                    });
                    d.collected_items = orderCollected;
                } else {
                    const key = `${d.id}_prendas_generales`;
                    d.collected_items = currentCollectedItemsMap[key] !== undefined ? currentCollectedItemsMap[key] : (d.expected_items || 1);
                    if (currentCollectedItemsCommentsMap[key]) {
                        orderComments["prendas_generales"] = currentCollectedItemsCommentsMap[key];
                    }
                }
                
                if (d.id === mainId && currentExtraGarmentsList.length > 0) {
                    d.collected_items += currentExtraGarmentsList.reduce((sum, extra) => sum + extra.quantity, 0);
                    orderComments["__extra_garments__"] = currentExtraGarmentsList;
                }
                
                d.items_comments = JSON.stringify(orderComments);
                
                if (d.id === mainId) {
                    if (d.expected_items !== d.collected_items) {
                        addSystemLog(`⚠️ ALERTA: Discrepancia física en ${d.client_name} (#${d.ticket_number}). Chatbot: ${d.expected_items} | Domiciliario: ${d.collected_items}.`);
                    }
                }
                
                if (lat !== null && lng !== null) {
                    d.latitude = lat;
                    d.longitude = lng;
                }
                d.sync_pending = true;
            });
            
            await saveDeliveries();
            recalculateShiftCash();
            closeConfirmModal();
            renderLocalidades();
            renderContent();
            
            triggerBackgroundSync();
            addSystemLog(`🎉 ${deliveriesToConfirm.length} pedidos de ${deliveriesToConfirm[0].client_name} completados con éxito.`);
            
            const waEnabled = localStorage.getItem("wa-api-enabled") === "true";
            if (waEnabled) {
                sendWhatsappNotification(mainId, "ENTREGADO");
            }
            
            alert(`🎉 ¡Entrega de ${deliveriesToConfirm.length} pedidos completada con éxito!`);
        };

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    lat = position.coords.latitude;
                    lng = position.coords.longitude;
                    addSystemLog(`🗺️ Coordenadas capturadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
                    await applyConfirmation();
                },
                async (error) => {
                    await applyConfirmation();
                }
            );
        } else {
            await applyConfirmation();
        }
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
    const descInput = document.getElementById("cash-expense-desc");
    const amtInput = document.getElementById("cash-expense-amount");
    
    const description = descInput.value.trim() || "Gasto general";
    const amount = parseFloat(amtInput.value);
    
    if (isNaN(amount) || amount <= 0) {
        alert("⚠️ Ingrese un monto de gasto válido.");
        return;
    }

    // Alerta de seguridad para montos inusualmente altos (ej: más de $150.000)
    if (amount > 150000) {
        const confirmHigh = confirm(`⚠️ Has ingresado un gasto inusualmente alto de $${amount.toLocaleString()}.\n¿Confirmas que el valor es correcto?`);
        if (!confirmHigh) {
            return;
        }
    }

    if (!currentShift.expenses_detail) {
        currentShift.expenses_detail = [];
    }

    currentShift.expenses_detail.push({
        description: description,
        amount: amount,
        timestamp: Date.now()
    });

    currentShift.expenses += amount;
    currentShift.sync_pending = true;
    
    descInput.value = "";
    amtInput.value = "";
    
    await saveShift();
    addSystemLog(`💵 Gasto registrado (${description}): $${amount.toLocaleString()}. Balance actualizado.`);
    renderContent();
    triggerBackgroundSync();
    alert("✅ Gasto registrado en caja.");
}

async function deleteExpense(index) {
    if (currentShift.status === "CERRADO") return;
    
    const expense = currentShift.expenses_detail[index];
    if (!expense) return;
    
    if (confirm(`¿Está seguro de que desea eliminar el gasto "${expense.description}" por $${expense.amount.toLocaleString()}?`)) {
        // Restar del total acumulado de gastos, asegurándonos de no bajar de 0
        currentShift.expenses = Math.max(0, currentShift.expenses - expense.amount);
        
        // Remover del detalle
        currentShift.expenses_detail.splice(index, 1);
        currentShift.sync_pending = true;
        
        await saveShift();
        addSystemLog(`🗑️ Gasto eliminado (${expense.description}): $${expense.amount.toLocaleString()}. Balance actualizado.`);
        renderContent();
        triggerBackgroundSync();
        alert("✅ Gasto eliminado correctamente.");
    }
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

function saveWhatsappCredentials() {
    const enabled = document.getElementById("cfg-wa-api-enabled").checked;
    const url = document.getElementById("cfg-wa-api-url").value.trim();
    const token = document.getElementById("cfg-wa-api-token").value.trim();
    
    localStorage.setItem("wa-api-enabled", enabled ? "true" : "false");
    localStorage.setItem("wa-api-url", url);
    localStorage.setItem("wa-api-token", token);
    
    addSystemLog(`⚙️ Configuración de WhatsApp API actualizada. Automático: ${enabled ? 'SÍ' : 'NO'}`);
    alert("✅ Configuración de WhatsApp API guardada con éxito.");
    renderContent();
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

// Sincronización en segundo plano con Supabase y Servidor Local
let isSyncing = false;
async function runBackgroundSync() {
    if (isSyncing) return;
    isSyncing = true;
    
    try {
        // 1. Sincronizar cola de mensajes de WhatsApp (Tanto para Supabase como para local)
        if (db) {
            const pendingMessages = await promiseWithTimeout(db.pending_wa_messages.toArray(), 2000, "Dexie WA messages toArray timeout");
            for (const msg of pendingMessages) {
                if (msg.attempts > 5) {
                    addSystemLog(`⚠️ Cola WA: Descartado mensaje para ${msg.client_name || msg.phone} tras 5 intentos.`);
                    await promiseWithTimeout(db.pending_wa_messages.delete(msg.id), 1500, "Dexie WA msg delete timeout");
                    continue;
                }
                
                try {
                    msg.attempts++;
                    await promiseWithTimeout(db.pending_wa_messages.put(msg), 1500, "Dexie WA msg put timeout");
                    
                    const response = await fetch("/api/whatsapp/send", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            phone: msg.phone,
                            message: msg.message,
                            client_name: msg.client_name,
                            address: msg.address,
                            status: msg.status,
                            order_id: msg.order_id
                        })
                    });
                    
                    if (response.ok) {
                        await promiseWithTimeout(db.pending_wa_messages.delete(msg.id), 1500, "Dexie WA msg success delete timeout");
                        addSystemLog(`✅ Cola WA: Mensaje pendiente para ${msg.client_name} enviado con éxito.`);
                        if (typeof loadWhatsappLogs === 'function') loadWhatsappLogs();
                    }
                } catch (e) {
                    console.error("Fallo reintentando mensaje de WhatsApp en segundo plano:", e);
                }
            }
        }

        // 2. Sincronización de base de datos
        if (supabaseClient) {
            addSystemLog("🔄 Sync: Verificando datos locales con Supabase Cloud...");
            if (db) {
                const pendingDeliveries = await promiseWithTimeout(db.deliveries.toArray(), 2000, "Dexie sync deliveries toArray timeout");
                const pendingList = pendingDeliveries.filter(d => d.sync_pending === true || d.sync_pending === 1);
                    
                for (const d of pendingList) {
                    addSystemLog(`🔄 Sync: Subiendo entrega de ${d.client_name} a Supabase...`);
                    const payload = {
                        chatbot_order_id: d.chatbot_order_id || d.id, 
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
                        longitude: d.longitude || null,
                        items_comments: d.items_comments || null
                    };
                    
                    const { error } = await supabaseClient.from('deliveries').upsert(payload);
                    if (!error) {
                        d.sync_pending = false;
                        await promiseWithTimeout(db.deliveries.put(d), 1500, "Dexie sync delivery put timeout");
                        addSystemLog(`✅ Sync: Entrega ${d.client_name} subida a Supabase.`);
                    } else {
                        addSystemLog(`❌ Sync Error en entrega: ${error.message}`);
                    }
                }
                
                const storedShift = await promiseWithTimeout(db.shift.get("shift_today"), 1500, "Dexie sync shift.get timeout");
                if (storedShift && storedShift.sync_pending) {
                    addSystemLog("🔄 Sync: Sincronizando estado de caja a Supabase...");
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
                            await promiseWithTimeout(db.shift.put(storedShift), 1500, "Dexie sync shift.put timeout");
                            addSystemLog("✅ Sync: Caja sincronizada con Supabase.");
                        } else {
                            addSystemLog(`❌ Sync Error en caja: ${error.message}`);
                        }
                    }
                }
            }
        } else {
            // Sincronización LOCAL con Express backend
            addSystemLog("🔄 Sync: Verificando datos con servidor local...");
            
            let localD = [];
            let isUsingLocalStorage = false;
            
            if (db) {
                try {
                    localD = await promiseWithTimeout(db.deliveries.toArray(), 1200, "Timeout al leer entregas locales");
                } catch (e) {
                    console.warn("Fallo lectura de IndexedDB en sync local. Usando LocalStorage fallback:", e);
                    localD = JSON.parse(localStorage.getItem("deliveries") || "[]");
                    isUsingLocalStorage = true;
                }
            } else {
                localD = JSON.parse(localStorage.getItem("deliveries") || "[]");
                isUsingLocalStorage = true;
            }
            
            // Re-asociar fotos aisladas a localD para que estén en memoria durante el sync y no se pierdan
            if (isUsingLocalStorage) {
                localD.forEach(d => {
                    if (d) {
                        const storedFacade = localStorage.getItem("photo_facade_" + d.client_phone);
                        if (storedFacade) d.facade_photo = storedFacade;
                        
                        const storedEvidence = localStorage.getItem("photo_evidence_" + d.id);
                        if (storedEvidence) d.evidence_photo = storedEvidence;
                    }
                });
            }
            
            const pendingD = localD.filter(d => d.sync_pending === true || d.sync_pending === 1);
            
            // Enviar solo cambios locales pendientes al servidor local
            const response = await fetch("/api/deliveries/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deliveries: pendingD })
            });
            
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data) {
                    let updatedCount = 0;
                    for (const serverD of result.data) {
                        const localItem = localD.find(d => d.id === serverD.id || (d.chatbot_order_id && d.chatbot_order_id === serverD.chatbot_order_id));
                        
                        if (!localItem) {
                            localD.push(serverD);
                            if (!isUsingLocalStorage) {
                                try {
                                    await promiseWithTimeout(db.deliveries.put(serverD), 1000, "Timeout al escribir entrega");
                                } catch (e) {
                                    isUsingLocalStorage = true;
                                }
                            }
                            updatedCount++;
                        } else {
                            let localChanged = false;
                            if (!localItem.sync_pending && localItem.status !== serverD.status) {
                                localItem.status = serverD.status;
                                localChanged = true;
                            }
                            if (!localItem.sync_pending && (
                                localItem.client_phone !== serverD.client_phone ||
                                localItem.latitude !== serverD.latitude ||
                                localItem.longitude !== serverD.longitude ||
                                localItem.address !== serverD.address ||
                                localItem.localidad !== serverD.localidad ||
                                localItem.items_comments !== serverD.items_comments ||
                                localItem.collected_items !== serverD.collected_items ||
                                (serverD.facade_photo && localItem.facade_photo !== serverD.facade_photo) ||
                                (serverD.facade_latitude && localItem.facade_latitude !== serverD.facade_latitude) ||
                                (serverD.facade_longitude && localItem.facade_longitude !== serverD.facade_longitude)
                            )) {
                                localItem.client_phone = serverD.client_phone;
                                localItem.latitude = serverD.latitude;
                                localItem.longitude = serverD.longitude;
                                localItem.address = serverD.address;
                                localItem.localidad = serverD.localidad;
                                localItem.items_comments = serverD.items_comments;
                                localItem.collected_items = serverD.collected_items;
                                
                                if (serverD.facade_photo) localItem.facade_photo = serverD.facade_photo;
                                if (serverD.facade_latitude) localItem.facade_latitude = serverD.facade_latitude;
                                if (serverD.facade_longitude) localItem.facade_longitude = serverD.facade_longitude;
                                localChanged = true;
                            }
                            if (localChanged) {
                                if (!isUsingLocalStorage) {
                                    try {
                                        await promiseWithTimeout(db.deliveries.put(localItem), 1000, "Timeout al guardar entrega");
                                    } catch (e) {
                                        isUsingLocalStorage = true;
                                    }
                                }
                                updatedCount++;
                            }
                        }
                    }
                    
                    // Quitar flag sync_pending si el servidor reconoció los cambios
                    for (const d of pendingD) {
                        const localItem = localD.find(x => x.id === d.id);
                        if (localItem && localItem.sync_pending) {
                            localItem.sync_pending = false;
                            if (!isUsingLocalStorage) {
                                try {
                                    await promiseWithTimeout(db.deliveries.put(localItem), 1000, "Timeout al remover sync_pending");
                                } catch (e) {
                                    isUsingLocalStorage = true;
                                }
                            }
                        }
                    }
                    
                    if (isUsingLocalStorage) {
                        const currentLocalStorageD = JSON.parse(localStorage.getItem("deliveries") || "[]");
                        
                        localD.forEach(item => {
                            const idx = currentLocalStorageD.findIndex(x => x.id === item.id);
                            if (idx !== -1) {
                                const localItem = currentLocalStorageD[idx];
                                
                                // Mezcla Inteligente: Si local está "Por confirmar" pero el servidor resolvió los datos reales, los actualizamos de inmediato
                                const localNameUnconfirmed = !localItem.client_name || localItem.client_name.toLowerCase().includes("confirmar") || localItem.client_name.trim() === "";
                                const serverNameConfirmed = item.client_name && !item.client_name.toLowerCase().includes("confirmar") && item.client_name.trim() !== "";
                                if (localNameUnconfirmed && serverNameConfirmed) {
                                    localItem.client_name = item.client_name;
                                }
                                
                                const localAddrUnconfirmed = !localItem.address || localItem.address.toLowerCase().includes("confirmar") || localItem.address.trim() === "";
                                const serverAddrConfirmed = item.address && !item.address.toLowerCase().includes("confirmar") && item.address.trim() !== "";
                                if (localAddrUnconfirmed && serverAddrConfirmed) {
                                    localItem.address = item.address;
                                }
                                
                                // Para el resto de campos (estados, fotos, coordenadas), protegemos si hay cambios locales "en vuelo"
                                if (!localItem.sync_pending) {
                                    localItem.status = item.status;
                                    localItem.facade_photo = item.facade_photo;
                                    localItem.facade_latitude = item.facade_latitude;
                                    localItem.facade_longitude = item.facade_longitude;
                                }
                            } else {
                                currentLocalStorageD.push(item);
                            }
                        });
                        
                        deliveries = currentLocalStorageD;
                        
                        // Re-asociar fotos para asegurar que la memoria de la aplicación esté completa
                        deliveries.forEach(d => {
                            if (d) {
                                const storedFacade = localStorage.getItem("photo_facade_" + d.client_phone);
                                if (storedFacade) d.facade_photo = storedFacade;
                                
                                const storedEvidence = localStorage.getItem("photo_evidence_" + d.id);
                                if (storedEvidence) d.evidence_photo = storedEvidence;
                            }
                        });
                        
                        // Guardar la versión limpia a LocalStorage
                        await saveDeliveries();
                    }
                    
                    if (updatedCount > 0 || isUsingLocalStorage) {
                        if (updatedCount > 0) {
                            addSystemLog(`✅ Sync: Descargados ${updatedCount} nuevos pedidos desde el webhook.`);
                        }
                        renderLocalidades();
                        renderContent();
                        
                        // Si el modal de la fachada está abierto para una orden, re-renderizarlo para mostrar la dirección resuelta en vivo
                        if (activeFacadeOrderId) {
                            openFacadeModal(null, activeFacadeOrderId);
                        }
                    }
                }
            }
            
            // Sincronizar Shift/Turno localmente
            let storedShift = null;
            if (db && !isUsingLocalStorage) {
                try {
                    storedShift = await promiseWithTimeout(db.shift.get("shift_today"), 1200, "Timeout al obtener turno");
                } catch (e) {
                    storedShift = JSON.parse(localStorage.getItem("shift") || "null");
                    isUsingLocalStorage = true;
                }
            } else {
                storedShift = JSON.parse(localStorage.getItem("shift") || "null");
            }
            
            if (storedShift && storedShift.sync_pending) {
                const shiftRes = await fetch("/api/shift/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ shift: storedShift })
                });
                if (shiftRes.ok) {
                    storedShift.sync_pending = false;
                    if (db && !isUsingLocalStorage) {
                        try {
                            await promiseWithTimeout(db.shift.put(storedShift), 1000, "Timeout al guardar turno");
                        } catch (e) {
                            localStorage.setItem("shift", JSON.stringify(storedShift));
                        }
                    } else {
                        localStorage.setItem("shift", JSON.stringify(storedShift));
                    }
                    addSystemLog("✅ Sync: Caja local sincronizada con el servidor.");
                }
            }
        }
    } catch (e) {
        addSystemLog("❌ Sync Error de conexión: " + e.message);
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
                    sync_pending: false,
                    items_comments: item.items_comments || null
                };
                if (db) {
                    await promiseWithTimeout(db.deliveries.put(mapped), 1500, "Dexie dailyRoute put timeout");
                }
            }
            
            if (db) {
                deliveries = await promiseWithTimeout(db.deliveries.toArray(), 2000, "Dexie dailyRoute toArray timeout");
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
            await promiseWithTimeout(db.deliveries.clear(), 2000, "Dexie reset deliveries.clear timeout");
            await promiseWithTimeout(db.shift.clear(), 2000, "Dexie reset shift.clear timeout");
        }
        localStorage.clear();
        window.location.reload();
    }
}

// 8. Helpers de persistencia
async function saveDeliveries() {
    if (db) {
        for (const d of deliveries) {
            await promiseWithTimeout(db.deliveries.put(d), 1500, "Dexie saveDeliveries put timeout");
        }
    } else {
        const cleanDeliveries = deliveries.map(d => {
            if (d.facade_photo) {
                localStorage.setItem("photo_facade_" + d.client_phone, d.facade_photo);
            }
            if (d.evidence_photo) {
                localStorage.setItem("photo_evidence_" + d.id, d.evidence_photo);
            }
            return {
                ...d,
                facade_photo: null,
                evidence_photo: null
            };
        });
        
        try {
            localStorage.setItem("deliveries", JSON.stringify(cleanDeliveries));
        } catch (e) {
            console.error("Fallo al escribir deliveries en LocalStorage:", e);
        }
    }
}

async function saveShift() {
    if (db) {
        await promiseWithTimeout(db.shift.put(currentShift), 1500, "Dexie saveShift put timeout");
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
    
    // Siempre renderizar el contenido correspondiente a la localidad seleccionada
    renderContent();
    
    // Y actualizar el estado de las flechas del selector
    updateLocalidadArrows();
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

function scrollLocalidades(direction) {
    const selector = document.getElementById("localidad-selector");
    if (selector) {
        selector.scrollBy({ left: direction * 150, behavior: 'smooth' });
        setTimeout(updateLocalidadArrows, 300);
    }
}

function updateLocalidadArrows() {
    const selector = document.getElementById("localidad-selector");
    const arrowLeft = document.getElementById("loc-arrow-left");
    const arrowRight = document.getElementById("loc-arrow-right");
    if (!selector || !arrowLeft || !arrowRight) return;
    
    arrowLeft.disabled = selector.scrollLeft <= 5;
    const isEnd = selector.scrollLeft + selector.clientWidth >= selector.scrollWidth - 5;
    arrowRight.disabled = isEnd;
}

function renderLocalidades() {
    const selector = document.querySelector(".localidad-selector");
    if (!selector) return;
    selector.innerHTML = "";
    
    // Solo mostrar las localidades que tienen entregas programadas para la fecha seleccionada
    const deliveriesToday = deliveries.filter(d => d.order_date === currentDate);
    let localidades = [...new Set(deliveriesToday.map(d => d.localidad).filter(l => typeof l === 'string' && l.trim() !== ''))];
    
    if (localidades.length === 0) {
        localidades.push("Usaquén");
    }

    // Ordenar las localidades alfabéticamente
    localidades.sort((a, b) => a.localeCompare(b));

    // Asegurarse de que la localidad seleccionada actualmente tenga pedidos hoy,
    // de lo contrario, preseleccionar la primera localidad que sí tenga entregas.
    if (deliveriesToday.length > 0 && !deliveriesToday.some(d => d.localidad === currentLocalidad)) {
        const firstActive = deliveriesToday.find(d => d.status !== 'ENTREGADO') || deliveriesToday[0];
        if (firstActive) {
            currentLocalidad = firstActive.localidad;
        }
    }
    
    localidades.forEach((loc) => {
        const count = deliveriesToday.filter(d => d.localidad === loc && d.status !== 'ENTREGADO').length;
        const active = loc === currentLocalidad ? 'active' : '';
        const tab = document.createElement("div");
        tab.className = `tab ${active}`;
        tab.textContent = `${loc} (${count})`;
        tab.onclick = () => {
            selectLocalidadTab(tab, loc);
            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            setTimeout(updateLocalidadArrows, 300);
        };
        selector.appendChild(tab);
    });

    // Agregar listener de scroll para actualizar el estado de las flechas
    selector.removeEventListener("scroll", updateLocalidadArrows);
    selector.addEventListener("scroll", updateLocalidadArrows);
    
    // Inicializar el estado de las flechas
    setTimeout(updateLocalidadArrows, 100);
}

let swipeStartX = 0;
let swipeEndX = 0;
let swipeStartY = 0;
let swipeEndY = 0;

function initSwipeNavigation() {
    const container = document.getElementById("main-app-content");
    if (!container) return;

    // Detectar inicio de toque
    container.addEventListener('touchstart', e => {
        swipeStartX = e.changedTouches[0].screenX;
        swipeStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    // Detectar fin de toque
    container.addEventListener('touchend', e => {
        swipeEndX = e.changedTouches[0].screenX;
        swipeEndY = e.changedTouches[0].screenY;
        handleSwipeGesture();
    }, { passive: true });
}

function handleSwipeGesture() {
    const swipeThreshold = 80; // Distancia mínima en píxeles para detectar swipe
    const verticalThreshold = 40; // Ignorar si se desliza demasiado en vertical (ej. scrolling)
    
    const diffX = swipeEndX - swipeStartX;
    const diffY = swipeEndY - swipeStartY;
    
    if (Math.abs(diffY) > verticalThreshold) return; // Movimiento principalmente vertical
    if (Math.abs(diffX) < swipeThreshold) return;

    // Obtener todas las pestañas de localidad
    const tabs = Array.from(document.querySelectorAll('.localidad-selector .tab'));
    if (tabs.length <= 1) return;

    const activeIndex = tabs.findIndex(t => t.classList.contains('active'));
    if (activeIndex === -1) return;

    let targetIndex = -1;
    if (diffX < 0) {
        // Deslizar a la izquierda -> Siguiente tab (derecha)
        if (activeIndex < tabs.length - 1) {
            targetIndex = activeIndex + 1;
        }
    } else {
        // Deslizar a la derecha -> Tab anterior (izquierda)
        if (activeIndex > 0) {
            targetIndex = activeIndex - 1;
        }
    }

    if (targetIndex !== -1) {
        const targetTab = tabs[targetIndex];
        // Simular click
        targetTab.click();
    }
}

window.addEventListener("DOMContentLoaded", initApp);
