/* SYSTEMA ANTIGRAVITY v4.5: MOTOR DE LÓGICA DE NEGOCIO (FULL MIGRADO, AUTOCORREGIDO E INTERACTIVO) */

// 1. Configuración de Base de Datos Local con Dexie.js (Offline Cache)
let db = null;
try {
    if (typeof Dexie !== 'undefined') {
        db = new Dexie("AppDomiciliariaDB");
        db.version(4).stores({
            deliveries: 'id, client_name, client_phone, address, localidad, time_window, amount, pay_method, status, qr_code, expected_items, collected_items, evidence_photo, signature_drawn, order_date, sync_pending',
            shift: 'id, driver_name, initial_cash, collected_cash, expenses, status, shift_date, sync_pending',
            pending_wa_messages: '++id, phone, message, status, timestamp, attempts'
        });
        console.log("🔋 Dexie.js (IndexedDB local) activo (v4).");
    }
} catch (e) {
    console.warn("⚠️ Falló Dexie. Usando LocalStorage fallback.", e);
}

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

// Estado
let deliveries = [];
let currentLocalidad = "Usaquén";
let currentTab = "deliveries";
let currentActiveDeliveryId = null;
let currentCollectedItemsCount = 1;

function getTodayDateString() {
    const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('fr-CA', options); // 'fr-CA' outputs YYYY-MM-DD
    return formatter.format(new Date());
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

    // Purgar datos ficticios residuales si existen en Dexie (IDs que empiezan por "d" y terminan en número)
    if (db) {
        try {
            const keys = await db.deliveries.toCollection().primaryKeys();
            const mockKeys = keys.filter(k => typeof k === 'string' && /^d\d+$/.test(k));
            if (mockKeys.length > 0) {
                await db.deliveries.bulkDelete(mockKeys);
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
            cachedList = cachedList.filter(d => !(typeof d.id === 'string' && /^d\d+$/.test(d.id)));
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
            deliveries = await db.deliveries.toArray();
            
            // Inicializar turno si no existe o cargar
            const storedShift = await db.shift.get("shift_today");
            if (storedShift) {
                currentShift = storedShift;
                if (!currentShift.expenses_detail) {
                    currentShift.expenses_detail = [];
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
                    await db.shift.put(currentShift);
                }
            } else {
                await db.shift.put(currentShift);
            }
            addSystemLog(`📦 Cargados ${deliveries.length} pedidos locales de IndexedDB.`);
        } catch (e) {
            console.error("Fallo inicializando base de datos local Dexie", e);
            loadLocalStorageFallback();
        }
    } else {
        loadLocalStorageFallback();
    }

    const activeTheme = localStorage.getItem("app-theme") || "theme-dark";
    setTheme(activeTheme);

    // Sincronizar fecha inicial seleccionada con la fecha del turno actual
    if (currentShift && currentShift.shift_date) {
        currentDate = currentShift.shift_date;
        const dateParts = currentDate.split('-');
        if (dateParts.length === 3) {
            viewYear = parseInt(dateParts[0]);
            viewMonth = parseInt(dateParts[1]) - 1;
        }
    }
    
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
        deliveries = [];
        localStorage.setItem("deliveries", JSON.stringify(deliveries));
    }

    const cachedShift = localStorage.getItem("shift");
    if (cachedShift) {
        currentShift = JSON.parse(cachedShift);
        if (!currentShift.expenses_detail) {
            currentShift.expenses_detail = [];
        }
        if (currentShift.shift_date !== todayDateStr) {
            currentShift.shift_date = todayDateStr;
            currentShift.collected_cash = 0;
            currentShift.expenses = 0;
            currentShift.expenses_detail = [];
            currentShift.status = "ABIERTO";
            localStorage.setItem("shift", JSON.stringify(currentShift));
        }
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
            <div style="font-size:12px; font-weight:600; color:var(--secondary); margin-bottom: 2px;">
                ${prendasText}
            </div>
            <div class="address-box">
                <svg width="14" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span ${isWarningAddress ? 'style="color: var(--warning); font-weight: 700; background: rgba(239, 68, 68, 0.08); padding: 1px 4px; border-radius: 4px;"' : ''}>
                    ${isWarningAddress ? '⚠️ ' + d.address : d.address}
                </span>
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
            <button class="btn btn-chat" onclick="toggleWhatsappTemplatesDropdown(event, '${d.id}')" style="position:relative;">
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
        
        // Enviar notificación automática si la API está configurada
        const waEnabled = localStorage.getItem("wa-api-enabled") === "true";
        if (waEnabled) {
            sendWhatsappNotification(id, "EN_RUTA");
        }
    }
}

function openMaps(address) {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    window.open(url, '_blank');
}

async function queueWhatsappMessage(phone, message, client_name = "", order_id = "", address = "", status = "") {
    if (db) {
        try {
            await db.pending_wa_messages.add({
                phone,
                message,
                client_name,
                order_id,
                address,
                status,
                timestamp: Date.now(),
                attempts: 0
            });
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

function openChatTranscriptionModal(id) {
    const d = deliveries.find(item => item.id === id);
    if (!d) return;

    document.getElementById('chat-modal-title').textContent = `Pedido #${d.ticket_number || 'N/A'}`;
    
    // Status pill style
    const statusPill = document.getElementById('chat-modal-status');
    statusPill.textContent = d.status === 'PENDIENTE' ? 'Pendiente' : (d.status === 'EN_RUTA' ? 'En Ruta' : 'Entregado');
    statusPill.className = `status-pill ${d.status === 'PENDIENTE' ? 'pending' : (d.status === 'EN_RUTA' ? 'route' : 'delivered')}`;

    document.getElementById('chat-modal-client-name').textContent = d.client_name;
    document.getElementById('chat-modal-phone').textContent = `Celular: +${d.client_phone}`;
    
    // Highlight if address is placeholder "Recogida WhatsApp"
    const isPlaceholder = d.address === 'Recogida WhatsApp';
    const addressEl = document.getElementById('chat-modal-address');
    if (isPlaceholder) {
        addressEl.innerHTML = `Dirección: <span style="color:var(--warning); font-weight:700; background:rgba(239,68,68,0.1); padding:2px 6px; border-radius:4px;">⚠️ Recogida WhatsApp (No confirmada)</span>`;
    } else {
        addressEl.textContent = `Dirección: ${d.address}`;
    }

    document.getElementById('chat-modal-amount').textContent = `Valor: $${d.amount.toLocaleString()} (${d.pay_method})`;

    // Payment details
    const payDetailsEl = document.getElementById('chat-modal-payment-details');
    if (d.payment_details) {
        payDetailsEl.textContent = d.payment_details;
        payDetailsEl.style.color = 'var(--text-main)';
    } else {
        payDetailsEl.textContent = "Sin detalles de pago específicos (Pago en punto o contraentrega).";
        payDetailsEl.style.color = 'var(--text-muted)';
    }

    // Chat transcription
    const transcriptEl = document.getElementById('chat-modal-transcript');
    if (d.chat_transcription) {
        transcriptEl.textContent = d.chat_transcription;
    } else {
        transcriptEl.innerHTML = `<span style="color:var(--text-muted); font-style:italic;">No hay transcripción de chat disponible para este despacho.</span>`;
    }

    document.getElementById('chat-details-modal').style.display = 'flex';
}

function closeChatDetailsModal() {
    document.getElementById('chat-details-modal').style.display = 'none';
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
        
        // Enviar notificación automática si la API está configurada
        const waEnabled = localStorage.getItem("wa-api-enabled") === "true";
        if (waEnabled) {
            sendWhatsappNotification(d.id, "ENTREGADO");
        }
        
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
            const pendingMessages = await db.pending_wa_messages.toArray();
            for (const msg of pendingMessages) {
                if (msg.attempts > 5) {
                    addSystemLog(`⚠️ Cola WA: Descartado mensaje para ${msg.client_name || msg.phone} tras 5 intentos.`);
                    await db.pending_wa_messages.delete(msg.id);
                    continue;
                }
                
                try {
                    msg.attempts++;
                    await db.pending_wa_messages.put(msg);
                    
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
                        await db.pending_wa_messages.delete(msg.id);
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
                const pendingDeliveries = await db.deliveries.toArray();
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
                        longitude: d.longitude || null
                    };
                    
                    const { error } = await supabaseClient.from('deliveries').upsert(payload);
                    if (!error) {
                        d.sync_pending = false;
                        await db.deliveries.put(d);
                        addSystemLog(`✅ Sync: Entrega ${d.client_name} subida a Supabase.`);
                    } else {
                        addSystemLog(`❌ Sync Error en entrega: ${error.message}`);
                    }
                }
                
                const storedShift = await db.shift.get("shift_today");
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
                            await db.shift.put(storedShift);
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
            if (db) {
                const localD = await db.deliveries.toArray();
                
                // Enviar cambios locales al servidor local
                const response = await fetch("/api/deliveries/sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ deliveries: localD })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.data) {
                        let updatedCount = 0;
                        for (const serverD of result.data) {
                            const localItem = localD.find(d => d.id === serverD.id || (d.chatbot_order_id && d.chatbot_order_id === serverD.chatbot_order_id));
                            
                            // Si no existe localmente, o cambió el estado en el servidor y no tenemos cambios pendientes locales
                            if (!localItem) {
                                await db.deliveries.put(serverD);
                                updatedCount++;
                            } else if (localItem.sync_pending === false && localItem.status !== serverD.status) {
                                await db.deliveries.put(serverD);
                                updatedCount++;
                            }
                        }
                        
                        // Quitar flag sync_pending si el servidor reconoció los cambios
                        for (const d of localD) {
                            if (d.sync_pending) {
                                d.sync_pending = false;
                                await db.deliveries.put(d);
                            }
                        }
                        
                        if (updatedCount > 0) {
                            addSystemLog(`✅ Sync: Descargados ${updatedCount} nuevos pedidos desde el webhook.`);
                            deliveries = await db.deliveries.toArray();
                            renderLocalidades();
                            renderContent();
                        }
                    }
                }
                
                // Sincronizar Shift/Turno localmente
                const storedShift = await db.shift.get("shift_today");
                if (storedShift && storedShift.sync_pending) {
                    const shiftRes = await fetch("/api/shift/sync", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ shift: storedShift })
                    });
                    if (shiftRes.ok) {
                        storedShift.sync_pending = false;
                        await db.shift.put(storedShift);
                        addSystemLog("✅ Sync: Caja local sincronizada con el servidor.");
                    }
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
