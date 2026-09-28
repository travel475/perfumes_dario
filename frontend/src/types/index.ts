// ─── Auth ───────────────────────────────────────────────────────────────────
export type Role = 'admin' | 'vendedor';

export interface User {
  id: string;
  name: string;
  role: Role;
  email: string;
}

// ─── Productos ───────────────────────────────────────────────────────────────
export type ProductStatus = 'activo' | 'inactivo' | 'stock_bajo';

export interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  proveedor_id?: string | null;
  precio_costo: number;
  precio_venta: number;
  stock: number;
  stock_minimo: number;
  estado: ProductStatus;
  unidad: string;
  descripcion: string;
  imagen?: string;      // URL de la imagen del producto
  tipo_producto?: 'perfume' | 'otro';
  es_por_encargo?: boolean;
  // Campos dinámicos para giros específicos (Multitenant)
  calidad?: string;    // Perfumería: Original, 1.1, Réplica AAA, etc.
  mililitros?: number; // Perfumería: 50ml, 100ml, etc.
  genero?: 'Masculino' | 'Femenino' | 'Unisex'; // Perfumería: Masculino, Femenino, Unisex
  familia_olfativa?: string; // Perfumería: Amaderada, Cítrica, Floral, etc.
  talla?: string;      // Ropa: S, M, L, XL, etc.
  color?: string;      // Ropa: Negro, Rojo, etc.
}

// ─── Proveedores ─────────────────────────────────────────────────────────────
export type ProveedorEstado = 'activo' | 'inactivo';

export interface Proveedor {
  id: string;
  nombre: string;
  nit: string;
  contacto: string;
  telefono: string;
  email: string;
  ciudad: string;
  estado: ProveedorEstado;
}

// ─── Clientes ────────────────────────────────────────────────────────────────
export type TipoCliente = 'empresa' | 'persona';

export interface Cliente {
  id: string;
  nombre: string;
  tipo: TipoCliente;
  documento: string;
  email: string;
  telefono: string;
  ciudad: string;
  direccion: string;
  fecha_registro: string;
  limite_credito?: number;
  credito_usado?: number;
}

// ─── Ventas ──────────────────────────────────────────────────────────────────
export type VentaEstado = 'completada' | 'pendiente' | 'anulada';

export interface VentaItem {
  producto_id: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  /** Solo se usa en el carrito: guarda el precio antes de marcar la línea como obsequio,
   *  para poder restaurarlo al desmarcarla. No se persiste. */
  precio_original?: number;
  es_preparado?: boolean;
  receta?: {
    materia_prima_id: string;
    cantidad: number;
  }[];
}

export interface Venta {
  id: string;
  factura: string;
  cliente_id: string;
  cliente_nombre: string;
  vendedor_id: string;
  vendedor_nombre: string;
  fecha: string;
  items: VentaItem[];
  total: number;
  estado: VentaEstado;
  notas?: string;
  metodo_pago?: 'contado' | 'credito';
}

// ─── Compras a Proveedores ───────────────────────────────────────────────────
export type CompraEstado = 'completada' | 'anulada';

export interface CompraItem {
  producto_id?: string;
  materia_prima_id?: string;
  tipo_item?: 'producto' | 'materia_prima';
  nombre: string;
  cantidad: number;
  precio_costo: number;
  precio_venta?: number; // Precio de venta actualizado en catálogo
  subtotal: number;
}

export interface Compra {
  id: string;
  factura_compra: string;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  items: CompraItem[];
  total: number;
  estado: CompraEstado;
  comprador_id: string;
  comprador_nombre: string;
  notas?: string;
}

// ─── Chart data ──────────────────────────────────────────────────────────────
export interface SalesDataPoint {
  fecha: string;
  total: number;
  cantidad: number;
}

// ─── Auditoría e Historial de Actividades ─────────────────────────────────────
export interface ActivityLog {
  id: string;
  usuario_nombre: string;
  rol: string;
  accion: string;
  fecha: string;
  modulo: 'productos' | 'proveedores' | 'clientes' | 'ventas' | 'configuracion' | 'compras';
}

// ─── Configuración de la Empresa ──────────────────────────────────────────────
export type BusinessGiro = 'general' | 'perfumeria' | 'moda';

export interface CompanyConfig {
  nombre: string;
  nit: string;
  direccion: string;
  telefono: string;
  iva_porcentaje: number;
  resolucion: string;
  giro: BusinessGiro; // Giro o rubro comercial de la empresa
  formula_triple_aaa?: { materia_prima_id: string; cantidad: number }[];
}

export interface Abono {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  monto: number;
  fecha: string; // ISO string
  registrado_por: string;
  metodo_pago?: 'efectivo' | 'transferencia' | 'tarjeta' | 'contado';
  notas?: string;
}

export interface Gasto {
  id: string;
  descripcion: string;
  categoria?: string;
  monto: number;
  fecha: string; // ISO string
  registrado_por: string;
  observaciones?: string;
}



export type MovimientoTipo = 'entrada' | 'salida' | 'ajuste_entrada' | 'ajuste_salida';

export interface MovimientoKardex {
  id: string;
  producto_id: string;
  producto_nombre: string;
  fecha: string;
  tipo: MovimientoTipo;
  cantidad: number;
  stock_anterior: number;
  stock_nuevo: number;
  referencia: string;
  notas?: string;
  registrado_por: string;
}

// ─── Materias Primas ───────────────────────────────────────────────────────────
export type MateriaPrimaEstado = 'activo' | 'inactivo' | 'stock_bajo';

export interface MateriaPrima {
  id: string;
  nombre: string;
  tipo: string; // 'esencia', 'alcohol', 'envase', etc.
  unidad_medida: string; // 'ml', 'g', 'ud'
  stock: number;
  stock_minimo: number;
  costo_unitario: number;
  estado: MateriaPrimaEstado;
  imagen?: string; // URL of the essence image
}

export type MovimientoMateriaPrimaTipo = 'entrada' | 'salida' | 'ajuste_entrada' | 'ajuste_salida';

export interface MovimientoMateriaPrima {
  id: string;
  materia_prima_id: string;
  materia_prima_nombre: string;
  fecha: string;
  tipo: MovimientoMateriaPrimaTipo;
  cantidad: number;
  stock_anterior: number;
  stock_nuevo: number;
  referencia: string;
  notas?: string;
  registrado_por: string;
}

// ─── Notificaciones ─────────────────────────────────────────────────────────────
export interface AppNotification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  date: string;
}
