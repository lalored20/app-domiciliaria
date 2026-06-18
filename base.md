# 🛸 APP DOMICILIARIA - Base de Conocimiento y Requerimientos

Este archivo contiene la especificación base de la aplicación de domiciliarios, recopilando problemas, soluciones, características clave e integraciones con el Chatbot de WhatsApp.

---

## 🏛️ 1. Flujo del Sistema (Visión General)
1. **Contacto:** El cliente interactúa con la IA en WhatsApp (cotizaciones, consultas, confirmación).
2. **Cierre:** La IA confirma la venta, recopila los datos de entrega (Nombre, Dirección, Teléfono, Localidad, Horario y Factura/Pedido) y los registra en la base de datos centralizada de Supabase.
3. **Despacho:** La App de Domicilios recibe los datos en tiempo real, agrupándolos por **Día actual**, **Localidad** y **Horario**.
4. **Entrega:** El domiciliario recorre la ruta óptima de forma secuencial y reporta estados ("En Ruta", "Entregado", "No Entregado") con soporte offline.

---

## 🔍 2. Lista Ampliada de Problemas (Pain Points del Domiciliario)

### 📌 Problemas Logísticos y Operativos
1. **Nomenclaturas Complejas o Erróneas:** El cliente escribe direcciones informales o abreviadas en WhatsApp (ej. *"Detrás del centro comercial, portón verde"*), dificultando que el GPS encuentre el punto exacto.
2. **Zonas de Difícil Acceso / Restricciones de Tráfico:** Zonas peatonales, conjuntos residenciales con accesos restringidos para motos/vehículos, o restricciones vehiculares del día (Pico y Placa).
3. **Ausencia del Cliente:** Llegar y que el cliente no se encuentre en la dirección, esté dormido, o no escuche el timbre/portero.
4. **Pérdida de Conectividad Móvil:** Sótanos de edificios, zonas de sombra de señal o falta de datos móviles en el celular del domiciliario.
5. **Rutas Repetitivas o Cruces Ineficientes:** Repartir en direcciones cercanas pero en diferentes horas del día debido a una mala planeación cronológica, incrementando el consumo de gasolina y tiempo.
6. **Desorden en la Carga Física (Maleta de Reparto):** Cargar la moto con los paquetes sin orden lógico. Al llegar al primer destino, el paquete está al fondo de la maleta, obligando a desordenar todo bajo la lluvia o sol.
7. **Retrasos por Imprevistos (Fuerza Mayor):** Lluvia torrencial, pinchazo de llanta o tráfico pesado que detienen la ruta y obligan a llamar uno por uno a los clientes restantes para excusarse.

### 📌 Problemas Financieros y de Recaudo
8. **Manejo de Efectivo y Sencillo (Cambio):** Tener que dar cambio de billetes grandes cuando no se especificó en el chatbot.
9. **Verificación de Transferencias:** Clientes que envían comprobantes de transferencia falsos o que tardan en verse reflejados en la cuenta de la empresa.
10. **Pérdida de Paquetes o Reclamos de Clientes:** Clientes que afirman no haber recibido el paquete cuando este se dejó en portería.
11. **Falta de Claridad en Comisiones:** El domiciliario no sabe con precisión cuántos domicilios exitosos lleva acumulados en el día ni el valor total de sus comisiones, lo que causa discusiones al cierre del turno.

### 📌 Problemas de Comunicación y Cambios
12. **Cambio de Dirección en Ruta:** El cliente cambia de opinión y le escribe al Chatbot para modificar la dirección de entrega cuando el domiciliario ya va en camino al punto original.
13. **Llamadas Rechazadas por Spam:** El domiciliario llama al cliente desde su número personal y el celular del cliente bloquea la llamada por ser un número desconocido.

---

## 🚀 3. Lista Ampliada de Funciones para la App Domiciliaria

### 🗺️ Módulo de Navegación y Mapas
*   **Geolocalización Automática (One-Touch Navigation):** Cada domicilio tendrá un botón directo con el ícono de Google Maps y Waze. Al presionarlo, abrirá automáticamente la aplicación de GPS del celular con la dirección exacta ya digitada, optimizando el tiempo del repartidor.
*   **Geocodificación por Coordenadas:** Si el chatbot captura la ubicación exacta (mediante un mensaje de ubicación enviado por el cliente en WhatsApp), se guardan las coordenadas latitud/longitud en la base de datos para navegar directo al pin geográfico, eliminando errores de nomenclatura.

### 📍 Clasificación, Ruteo y Carga Inteligente
*   **Agrupamiento por Localidades:** Interfaz organizada por pestañas o bloques de localidad (Usaquén, Chapinero, Suba, etc.).
*   **Orden Cronológico de Entrega:** Secuenciación automática de pedidos por franja horaria (ej. Mañana: 8am-12pm, Tarde: 2pm-6pm) y distancia para hacer un recorrido lineal.
*   **Guía de Carga Inversa (LIFO - Last In, First Out):** La app muestra una pantalla que indica cómo acomodar los paquetes físicamente en la maleta de reparto. Lo último que se va a entregar debe ir abajo, y lo primero que se va a entregar debe ir en la parte superior.

### 💬 Comunicación Automatizada y Emergencias
*   **Mensaje Plantilla de Llegada:** Un botón de "Notificar Cliente" en la app abre WhatsApp con un mensaje pre-cargado: 
    *   *«Hola [Nombre], soy tu repartidor de Lavaseco Orquídeas. Ya voy en camino a tu dirección [Dirección] con tu pedido. Estaré allí en unos 10 minutos.»*
*   **Reporte de Demoras Masivas:** Un botón de "Retraso por Lluvia/Tráfico" que envía automáticamente un mensaje de aviso a las siguientes 3 entregas pendientes estimando la nueva hora de llegada.

### 🧾 Gestión de Caja, Comisiones e Idempotencia (Patrón POS-Architect)
*   **Módulo de Caja del Domiciliario:** Apertura de caja con base de efectivo inicial, registro de cobros (Efectivo, Transferencia, Pago Web) y registro de gastos (Gasolina, Peajes) durante el turno.
*   **Dashboard de Ganancias Diarias:** Panel visual donde el repartidor ve en tiempo real su acumulado de entregas, dinero a entregar a la administración, y comisiones ganadas en el día.
*   **Idempotencia Transaccional:** Cada orden tiene una llave única generada por el chatbot. Si hay problemas de red, se evita que un pedido se cobre o entregue dos veces en el sistema.

### 📦 Validación y Estado de Entrega (Proof of Delivery)
*   **Evidencia Fotográfica:** Opción obligatoria de tomar foto del paquete entregado en portería o al cliente. Las fotos se almacenan en el Storage de Supabase.
*   **Escaneo de QR/Código de Barras:** Para evitar entregar un paquete a un cliente que no corresponde, el domiciliario escanea la etiqueta física de la prenda/paquete con la cámara del celular.
*   **Firma Digital en Pantalla:** El cliente puede firmar directamente con el dedo sobre la pantalla del celular del domiciliario para confirmar el recibido.

### 📡 Resiliencia y Modo Offline (Dexie.js)
*   **Carga Inicial del Turno:** La app almacena en la base de datos local (IndexedDB) todas las entregas asignadas al inicio del turno.
*   **Modo Desconectado:** El domiciliario puede cambiar estados de entrega, tomar fotos y firmas sin internet. Al detectar conexión, los datos se sincronizan con Supabase en segundo plano.

---

## 🛠️ 4. Arquitectura de Datos y Tablas en Supabase

### Tabla `deliveries`
*   `id`: UUID (Llave primaria).
*   `chatbot_order_id`: Identificador único del chatbot (para idempotencia).
*   `client_name`: Nombre del cliente.
*   `client_phone`: Teléfono de contacto.
*   `delivery_address`: Dirección formateada.
*   `localidad`: Localidad o comuna.
*   `delivery_date`: Fecha programada de entrega.
*   `time_window`: Ventana horaria de entrega.
*   `total_amount`: Valor total a cobrar.
*   `payment_method`: EFECTIVO | TRANSFERENCIA | PAGADO.
*   `status`: PENDIENTE | EN_RUTA | ENTREGADO | NO_ENTREGADO | CANCELADO.
*   `latitude` / `longitude`: Coordenadas de geolocalización.
*   `evidence_image_url`: Ruta de la imagen en Supabase Storage.
*   `failure_reason`: Razón si la entrega falla (ej: "No estaba el cliente").

### Tabla `driver_shifts` (Caja y Métricas)
*   `id`: UUID.
*   `driver_id`: Relación con el usuario domiciliario.
*   `shift_date`: Fecha del turno.
*   `initial_cash`: Dinero base entregado para vueltas.
*   `collected_cash`: Dinero físico recolectado.
*   `expenses`: Gastos del día registrados por el domiciliario.
*   `commissions_earned`: Comisión calculada del día.
*   `status`: ABIERTO | CERRADO.
