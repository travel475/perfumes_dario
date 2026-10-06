-- ==============================================================================
-- SCHEMA INICIAL DE SUPABASE - PROYECTO PERFUMES / SISTEMA POS
-- ==============================================================================
-- Copia y ejecuta todo este script en el SQL Editor de tu proyecto en Supabase.
-- ==============================================================================

-- Habilitar extensión pgcrypto (para uuid)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABLA DE PERFILES DE USUARIOS (Sincronizada con auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  nombre TEXT,
  rol TEXT DEFAULT 'vendedor',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies para public.profiles (Permitir lectura/escritura en el frontend)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura de perfiles a todos los usuarios" ON public.profiles;
CREATE POLICY "Permitir lectura de perfiles a todos los usuarios"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Permitir insercion/actualización de perfiles" ON public.profiles;
CREATE POLICY "Permitir insercion/actualización de perfiles"
  ON public.profiles FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger para crear/actualizar automáticamente un perfil cuando se crea un usuario en Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nombre, rol)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nombre', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'rol', 'vendedor')
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. TABLA PROVEEDORES
CREATE TABLE IF NOT EXISTS public.proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  nit TEXT,
  contacto TEXT,
  telefono TEXT,
  email TEXT,
  ciudad TEXT,
  estado TEXT DEFAULT 'activo',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA PRODUCTOS
CREATE TABLE IF NOT EXISTS public.productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  categoria TEXT,
  proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  precio_costo NUMERIC DEFAULT 0,
  precio_venta NUMERIC DEFAULT 0,
  stock NUMERIC DEFAULT 0,
  stock_minimo NUMERIC DEFAULT 0,
  estado TEXT DEFAULT 'activo',
  unidad TEXT DEFAULT 'Frasco',
  descripcion TEXT,
  imagen TEXT,
  calidad TEXT,
  mililitros NUMERIC,
  genero TEXT,
  familia_olfativa TEXT,
  talla TEXT,
  color TEXT,
  tipo_producto TEXT DEFAULT 'perfume',
  es_por_encargo BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABLA CLIENTES
CREATE TABLE IF NOT EXISTS public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  tipo TEXT DEFAULT 'persona',
  documento TEXT,
  email TEXT,
  telefono TEXT,
  ciudad TEXT,
  direccion TEXT,
  fecha_registro DATE DEFAULT CURRENT_DATE,
  limite_credito NUMERIC DEFAULT 0,
  credito_usado NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABLA MATERIAS PRIMAS
CREATE TABLE IF NOT EXISTS public.materias_primas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  tipo TEXT,
  unidad_medida TEXT,
  stock NUMERIC DEFAULT 0,
  stock_minimo NUMERIC DEFAULT 0,
  costo_unitario NUMERIC DEFAULT 0,
  estado TEXT DEFAULT 'activo',
  imagen TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABLA VENTAS
CREATE TABLE IF NOT EXISTS public.ventas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura TEXT NOT NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  cliente_nombre TEXT,
  vendedor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  vendedor_nombre TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  items JSONB DEFAULT '[]'::jsonb,
  total NUMERIC DEFAULT 0,
  estado TEXT DEFAULT 'completada',
  notas TEXT,
  metodo_pago TEXT DEFAULT 'contado',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABLA COMPRAS
CREATE TABLE IF NOT EXISTS public.compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_compra TEXT NOT NULL,
  proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  proveedor_nombre TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  items JSONB DEFAULT '[]'::jsonb,
  total NUMERIC DEFAULT 0,
  estado TEXT DEFAULT 'completada',
  comprador_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  comprador_nombre TEXT,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABLA MOVIMIENTOS KARDEX (Productos Terminados)
CREATE TABLE IF NOT EXISTS public.movimientos_kardex (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id UUID REFERENCES public.productos(id) ON DELETE CASCADE,
  producto_nombre TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  tipo TEXT NOT NULL,
  cantidad NUMERIC DEFAULT 0,
  stock_anterior NUMERIC DEFAULT 0,
  stock_nuevo NUMERIC DEFAULT 0,
  referencia TEXT,
  notas TEXT,
  registrado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign Key nombrada para compatibilidad con query de Supabase
ALTER TABLE public.movimientos_kardex
  DROP CONSTRAINT IF EXISTS movimientos_kardex_registrado_por_fkey,
  ADD CONSTRAINT movimientos_kardex_registrado_por_fkey 
  FOREIGN KEY (registrado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 9. TABLA MOVIMIENTOS MATERIAS PRIMAS
CREATE TABLE IF NOT EXISTS public.movimientos_materias_primas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  materia_prima_id UUID REFERENCES public.materias_primas(id) ON DELETE CASCADE,
  materia_prima_nombre TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  tipo TEXT NOT NULL,
  cantidad NUMERIC DEFAULT 0,
  stock_anterior NUMERIC DEFAULT 0,
  stock_nuevo NUMERIC DEFAULT 0,
  referencia TEXT,
  notas TEXT,
  registrado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign Key nombrada para compatibilidad con query de Supabase
ALTER TABLE public.movimientos_materias_primas
  DROP CONSTRAINT IF EXISTS movimientos_materias_primas_registrado_por_fkey,
  ADD CONSTRAINT movimientos_materias_primas_registrado_por_fkey 
  FOREIGN KEY (registrado_por) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 10. TABLA ABONOS (Pagos de Crédito)
CREATE TABLE IF NOT EXISTS public.abonos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
  cliente_nombre TEXT,
  monto NUMERIC DEFAULT 0,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  registrado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  metodo_pago TEXT DEFAULT 'efectivo',
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. TABLA GASTOS
CREATE TABLE IF NOT EXISTS public.gastos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  descripcion TEXT NOT NULL,
  categoria TEXT,
  monto NUMERIC DEFAULT 0,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  registrado_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  observaciones TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. TABLA LOGS DE ACTIVIDAD
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_nombre TEXT,
  rol TEXT,
  accion TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  modulo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. TABLA CONFIGURACIÓN DE EMPRESA
CREATE TABLE IF NOT EXISTS public.company_config (
  id INT PRIMARY KEY DEFAULT 1,
  nombre TEXT DEFAULT 'Mi Empresa',
  nit TEXT DEFAULT '000000000-0',
  direccion TEXT DEFAULT 'Ciudad',
  telefono TEXT DEFAULT '0000000',
  iva_porcentaje NUMERIC DEFAULT 19,
  resolucion TEXT DEFAULT 'PENDIENTE',
  giro TEXT DEFAULT 'perfumeria',
  formula_triple_aaa JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar configuración por defecto si no existe
INSERT INTO public.company_config (id, nombre, nit, direccion, telefono, iva_porcentaje, resolucion, giro)
VALUES (1, 'Perfumería Demo', '900.000.000-1', 'Calle Principal #123', '300 000 0000', 19, 'RES-12345', 'perfumeria')
ON CONFLICT (id) DO NOTHING;

-- Public Realtime Subscriptions (Para notificaciones en la app)
ALTER PUBLICATION supabase_realtime ADD TABLE public.clientes;
