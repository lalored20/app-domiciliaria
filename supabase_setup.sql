-- ==========================================================
-- SCRIPT DE CONFIGURACIÓN DE SUPABASE PARA APP DOMICILIARIA
-- ==========================================================
-- Copia y pega este script en el "SQL Editor" de tu panel de Supabase.

-- 1. Tabla de Entregas (deliveries)
CREATE TABLE IF NOT EXISTS public.deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chatbot_order_id VARCHAR(100) UNIQUE,                      -- Evita cobros/entregas duplicadas (Idempotencia)
    client_name VARCHAR(100) NOT NULL,
    client_phone VARCHAR(20) NOT NULL,
    delivery_address TEXT NOT NULL,
    localidad VARCHAR(50) NOT NULL,                           -- Filtro principal (Usaquén, Suba, etc.)
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,          -- Día del servicio
    time_window VARCHAR(50) NOT NULL,                         -- Ej: "08:00 - 10:00"
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    pay_method VARCHAR(30) NOT NULL DEFAULT 'Efectivo',       -- Efectivo | Transferencia | Pagado (Online)
    status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',          -- PENDIENTE | EN_RUTA | ENTREGADO | NO_ENTREGADO
    qr_code VARCHAR(100),                                     -- Código único de prenda a escanear
    evidence_photo_url TEXT,                                  -- Link a la foto en Supabase Storage
    signature_drawn BOOLEAN DEFAULT FALSE,
    expected_items INT NOT NULL DEFAULT 1,                     -- Prendas registradas inicialmente
    collected_items INT NOT NULL DEFAULT 1,                    -- Prendas contadas físicamente en puerta
    latitude DOUBLE PRECISION,                                 -- Geolocalización real al entregar
    longitude DOUBLE PRECISION,
    driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Asignada a un Domiciliario específico
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS (Seguridad a Nivel de Fila)
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad (RLS) para deliveries
-- Permitir lectura pública o restringida por autenticación.
-- Los domiciliarios autenticados pueden ver todos sus domicilios asignados.
CREATE POLICY "Domiciliarios pueden ver sus asignaciones" 
ON public.deliveries 
FOR SELECT 
TO authenticated 
USING (driver_id = auth.uid() OR driver_id IS NULL);

-- Los domiciliarios pueden actualizar sus domicilios en ruta
CREATE POLICY "Domiciliarios pueden actualizar estado de entregas" 
ON public.deliveries 
FOR UPDATE 
TO authenticated 
USING (driver_id = auth.uid())
WITH CHECK (driver_id = auth.uid());

-- Permitir inserts públicos (para el chatbot de WhatsApp)
CREATE POLICY "Chatbot puede insertar entregas" 
ON public.deliveries 
FOR INSERT 
TO anon, authenticated
WITH CHECK (true);


-- 2. Tabla de Turnos y Cajas (driver_shifts)
CREATE TABLE IF NOT EXISTS public.driver_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    shift_date DATE NOT NULL DEFAULT CURRENT_DATE,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    end_time TIMESTAMP WITH TIME ZONE,
    initial_cash NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    collected_cash NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    expenses NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'ABIERTO',             -- ABIERTO | CERRADO
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para turnos
CREATE POLICY "Domiciliarios pueden ver sus propios turnos" 
ON public.driver_shifts 
FOR SELECT 
TO authenticated 
USING (driver_id = auth.uid());

CREATE POLICY "Domiciliarios pueden gestionar su turno" 
ON public.driver_shifts 
FOR ALL 
TO authenticated 
USING (driver_id = auth.uid())
WITH CHECK (driver_id = auth.uid());


-- 3. Habilitar Tiempo Real (Realtime) para Sincronización Inmediata
-- Esto permite que la app móvil escuche cambios e inserciones al instante
alter publication supabase_realtime add table public.deliveries;
alter publication supabase_realtime add table public.driver_shifts;


-- 4. Creación del Storage Bucket para fotos de evidencias
-- Nota: En Supabase la administración de Buckets se realiza mediante la UI o la tabla de storage.
-- Este script inserta el registro básico para el bucket de evidencias de entrega.
INSERT INTO storage.buckets (id, name, public) 
VALUES ('delivery-evidences', 'delivery-evidences', true)
ON CONFLICT (id) DO NOTHING;

-- Política pública para ver evidencias
CREATE POLICY "Evidencias son públicas para visualización" 
ON storage.objects 
FOR SELECT 
TO anon, authenticated 
USING (bucket_id = 'delivery-evidences');

-- Política para permitir que domiciliarios suban fotos
CREATE POLICY "Domiciliarios autenticados pueden subir fotos" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'delivery-evidences');
