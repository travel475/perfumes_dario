import React, { useState, useMemo, useEffect } from 'react';
import {
  Plus, Search, ShoppingCart, Trash2, XCircle,
  FileText, ChevronRight, CheckCircle2, Package, FileDown, Download,
  RotateCcw, Printer
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AlertBox } from '../components/ui/AlertBox';
import { PrepararTripleAaaModal } from '../components/ui/PrepararTripleAaaModal';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { calcularSaldosCredito } from '../utils/creditoFifo';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportToCSV as downloadCSV } from '../utils/exportToCSV';
import type { Venta, VentaItem, Cliente } from '../types';

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

const formatNumberWithDots = (val: number | undefined) => {
  if (!val) return '';
  return new Intl.NumberFormat('es-CO').format(val);
};

// ── Nueva Venta Wizard ────────────────────────────────────────────────────────
type WizardStep = 'cliente' | 'productos' | 'confirmar';

function NuevaVentaModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { clientes, productos, addVenta, configuracion, materiasPrimas } = useAppData();
  const { user } = useAuth();

  const [step, setStep] = useState<WizardStep>('cliente');
  const [clienteId, setClienteId] = useState('');
  const [carrito, setCarrito] = useState<VentaItem[]>([]);
  const [tripleAaaModalOpen, setTripleAaaModalOpen] = useState(false);
  const [searchProd, setSearchProd] = useState('');
  const [searchCliente, setSearchCliente] = useState('');
  const [metodoPago, setMetodoPago] = useState<'contado' | 'credito'>('contado');
  const [abonoInicial, setAbonoInicial] = useState<number>(0);
  const [descuentoTipo, setDescuentoTipo] = useState<'porcentaje' | 'monto'>('porcentaje');
  const [descuentoValor, setDescuentoValor] = useState<number>(0);
  const [descuentoMotivo, setDescuentoMotivo] = useState<string>('');
  const [descuentoAbierto, setDescuentoAbierto] = useState(false);
  const [abonoMetodoPago, setAbonoMetodoPago] = useState<'efectivo' | 'transferencia' | 'tarjeta'>('efectivo');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('cliente');
    setClienteId('');
    setCarrito([]);
    setSearchProd('');
    setSearchCliente('');
    setMetodoPago('contado');
    setAbonoInicial(0);
    setDescuentoTipo('porcentaje');
    setDescuentoValor(0);
    setDescuentoMotivo('');
    setDescuentoAbierto(false);
    setAbonoMetodoPago('efectivo');
    setSuccess(false);
    setError(null);
  };

  const handleClose = () => {
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      reset();
    }
  }, [isOpen]);

  useEffect(() => {
    if (clienteId === 'walk-in' && metodoPago === 'credito') {
      setMetodoPago('contado');
    }
  }, [clienteId, metodoPago]);

  const productosDisponibles = useMemo(() =>
    productos.filter(p =>
      (p.stock > 0 || p.es_por_encargo) &&
      (p.nombre.toLowerCase().includes(searchProd.toLowerCase()) ||
       p.codigo.toLowerCase().includes(searchProd.toLowerCase()))
    ), [productos, searchProd]
  );

  const agregarProducto = (prod: typeof productos[0]) => {
    setCarrito(prev => {
      const existing = prev.find(i => i.producto_id === prod.id);
      if (existing) {
        return prev.map(i => {
          if (i.producto_id !== prod.id) return i;
          // Se usa el precio de la linea y no el del catalogo: si esta marcada como
          // obsequio vale 0 y debe seguir valiendo 0 al sumar unidades.
          const cantidad = Math.min(i.cantidad + 1, prod.es_por_encargo ? 9999 : prod.stock);
          return { ...i, cantidad, subtotal: cantidad * i.precio_unitario };
        });
      }
      return [...prev, {
        producto_id: prod.id,
        nombre: prod.nombre,
        cantidad: 1,
        precio_unitario: prod.precio_venta,
        subtotal: prod.precio_venta,
      }];
    });
  };

  const agregarPreparado = (item: VentaItem) => {
    setCarrito(prev => [...prev, item]);
  };

  const cambiarCantidad = (prodId: string, cantidad: number, maxStock: number) => {
    if (cantidad < 1) return;
    const qty = Math.min(cantidad, maxStock);
    setCarrito(prev =>
      prev.map(i => i.producto_id === prodId
        ? { ...i, cantidad: qty, subtotal: qty * i.precio_unitario }
        : i
      )
    );
  };

  const quitarProducto = (prodId: string) =>
    setCarrito(prev => prev.filter(i => i.producto_id !== prodId));

  // Un obsequio es una linea a precio 0: descuenta stock igual, no cobra, y su costo
  // se sigue restando de la ganancia porque la mercancia salio del inventario.
  const esObsequio = (item: VentaItem) => Number(item.precio_unitario) === 0;

  const toggleObsequio = (prodId: string) => {
    setCarrito(prev => prev.map(i => {
      if (i.producto_id !== prodId) return i;
      if (esObsequio(i)) {
        const precio = i.precio_original ?? 0;
        return { ...i, precio_unitario: precio, subtotal: i.cantidad * precio, precio_original: undefined };
      }
      return { ...i, precio_original: i.precio_unitario, precio_unitario: 0, subtotal: 0 };
    }));
  };

  const subtotalBruto = carrito.reduce((s, i) => s + i.subtotal, 0);

  // El descuento nunca puede superar el subtotal: el total jamás debe quedar negativo.
  const descuentoMonto = subtotalBruto <= 0 ? 0 : Math.min(
    subtotalBruto,
    Math.max(0, descuentoTipo === 'porcentaje'
      ? Math.round(subtotalBruto * (Math.min(descuentoValor, 100) / 100))
      : Math.round(descuentoValor))
  );
  const descuentoPct = subtotalBruto > 0 ? (descuentoMonto / subtotalBruto) * 100 : 0;

  // De aquí en adelante "total" es el neto ya descontado: es lo que se cobra, lo que se
  // adeuda y lo que queda guardado en la venta.
  const total = subtotalBruto - descuentoMonto;

  const MOTIVOS_DESCUENTO = ['Cumpleaños', 'Cliente frecuente', 'Promoción', 'Mayorista'];

  const WALK_IN_ID = 'walk-in';
  const clienteSeleccionado = clienteId === 'walk-in'
    ? { id: 'walk-in', nombre: 'Consumidor Final', tipo: 'persona' as const, documento: 'N/A', ciudad: 'N/A', email: '', telefono: '', direccion: '', fecha_registro: '', limite_credito: 0, credito_usado: 0 } as Cliente
    : clientes.find(c => c.id === clienteId);

  const handleConfirm = () => {
    if (!user) return;
    setError(null);

    if (!clienteId) {
      setError("Por favor selecciona un cliente para la venta.");
      return;
    }

    if (carrito.length === 0) {
      setError("El carrito está vacío. Debes agregar al menos un producto.");
      return;
    }

    for (const item of carrito) {
      if (item.es_preparado) continue; // No validamos stock de productos para los preparados (se validará materias primas en backend)
      const prod = productos.find(p => p.id === item.producto_id);
      if (prod && !prod.es_por_encargo && item.cantidad > prod.stock) {
        setError(`El producto "${item.nombre}" supera el stock disponible (${prod.stock}).`);
        return;
      }
    }

    if (descuentoMonto > 0 && !descuentoMotivo.trim()) {
      setError('Indica el motivo del descuento. Elige uno de los botones o escríbelo.');
      return;
    }

    // Una venta que se entrega completa como obsequio no genera cobro: no tiene
    // sentido registrarla a crédito ni sumarle deuda al cliente.
    const metodoPagoFinal = total === 0 ? 'contado' : metodoPago;

    if (metodoPagoFinal === 'credito' && clienteSeleccionado && clienteSeleccionado.id !== 'walk-in') {
      const limite = clienteSeleccionado.limite_credito || 0;
      const deuda = clienteSeleccionado.credito_usado || 0;
      const deudaNetaVenta = Math.max(0, total - (abonoInicial || 0));
      if (deuda + deudaNetaVenta > limite && limite > 0) {
        setError(`El cliente no tiene suficiente límite de crédito disponible. (Límite: ${formatCurrency(limite)}, Deuda actual: ${formatCurrency(deuda)}, Nueva deuda: ${formatCurrency(deudaNetaVenta)})`);
        return;
      }
    }

    // El descuento viaja como una línea negativa más: addVenta calcula el total sumando
    // los subtotales, así que el total guardado ya sale descontado sin tocar el backend.
    const itemsFinales = descuentoMonto > 0
      ? [...carrito, {
          producto_id: '',
          nombre: `Descuento · ${descuentoMotivo.trim()}`,
          cantidad: 1,
          precio_unitario: -descuentoMonto,
          subtotal: -descuentoMonto,
        }]
      : carrito;

    addVenta(itemsFinales, clienteId, user.id, user.name, user.role, metodoPagoFinal, total === 0 ? 0 : abonoInicial, abonoMetodoPago);
    setSuccess(true);
  };

  const clientesFiltrados = useMemo(() => {
    if (!searchCliente) return clientes;
    const q = searchCliente.toLowerCase();
    return clientes.filter(c =>
      c.nombre.toLowerCase().includes(q) ||
      c.documento.toLowerCase().includes(q) ||
      c.ciudad.toLowerCase().includes(q)
    );
  }, [clientes, searchCliente]);

  const stepLabels: Record<WizardStep, string> = {
    cliente: '1. Cliente',
    productos: '2. Productos',
    confirmar: '3. Confirmar',
  };
  const steps: WizardStep[] = ['cliente', 'productos', 'confirmar'];
  const currentIdx = steps.indexOf(step);

  return (
    <>
    <Modal isOpen={isOpen} onClose={handleClose} title="Nueva Venta" size="xl"
      headerAction={
        <button
          onClick={reset}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Limpiar formulario"
        >
          <RotateCcw size={16} />
        </button>
      }
    >
      {success ? (
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-emerald-500" />
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-zinc-800">¡Venta registrada!</p>
            <p className="text-sm text-zinc-500 mt-1">El stock ha sido descontado correctamente.</p>
          </div>
          <Button onClick={reset} className="mt-4">Nueva Venta</Button>
        </div>
      ) : (
        <>
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {steps.map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${i <= currentIdx ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-400'}`}>
                  {stepLabels[s]}
                </div>
                {i < steps.length - 1 && <ChevronRight size={14} className="text-zinc-300" />}
              </React.Fragment>
            ))}
          </div>

          {/* Step: Cliente */}
          {step === 'cliente' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm font-medium text-zinc-600">Selecciona el cliente para esta venta:</p>
                <div className="relative w-full sm:w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={searchCliente}
                    onChange={e => setSearchCliente(e.target.value)}
                    placeholder="Buscar cliente por nombre, doc. o ciudad..."
                    className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-colors bg-white"
                  />
                </div>
              </div>

              {/* Walk-in option */}
              <button
                onClick={() => setClienteId(WALK_IN_ID)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer ${
                  clienteId === WALK_IN_ID
                    ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-500/10'
                    : 'border-dashed border-zinc-300 hover:border-amber-400 hover:bg-amber-50/30'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${clienteId === WALK_IN_ID ? 'bg-amber-500' : 'bg-zinc-100'}`}>
                  <span className={`text-xs font-bold ${clienteId === WALK_IN_ID ? 'text-white' : 'text-zinc-500'}`}>
                    <ShoppingCart size={14} />
                  </span>
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${clienteId === WALK_IN_ID ? 'text-amber-700' : 'text-zinc-700'}`}>Cliente No Registrado</p>
                  <p className="text-xs text-zinc-400">Venta sin identificación de cliente · No afecta cartera</p>
                </div>
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-zinc-400 font-medium">o clientes registrados</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-1">
                {clientesFiltrados.length === 0 ? (
                  <p className="py-6 text-center text-xs text-zinc-400">No se encontraron clientes con esa búsqueda.</p>
                ) : clientesFiltrados.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setClienteId(c.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer ${
                      clienteId === c.id
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${clienteId === c.id ? 'bg-amber-500' : 'bg-zinc-100'}`}>
                      <span className={`text-xs font-bold ${clienteId === c.id ? 'text-white' : 'text-zinc-500'}`}>
                        {c.nombre[0]}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${clienteId === c.id ? 'text-amber-700' : 'text-zinc-700'}`}>{c.nombre}</p>
                      <p className="text-xs text-zinc-400">{c.tipo === 'empresa' ? 'NIT' : 'CC'}: {c.documento} · {c.ciudad}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex justify-end pt-2 border-t border-zinc-100">
                <Button disabled={!clienteId} onClick={() => setStep('productos')}>
                  Siguiente <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {/* Step: Productos */}
          {step === 'productos' && (
            <div className="space-y-4">
              <div className="flex justify-end mb-2">
                 <Button type="button" onClick={() => setTripleAaaModalOpen(true)} variant="secondary" size="sm" className="bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100">
                   Preparar Triple AAA
                 </Button>
              </div>
              <div className="flex gap-4">
                {/* Product picker */}
                <div className="flex-1 min-w-0">
                  <div className="relative mb-2">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      value={searchProd}
                      onChange={e => setSearchProd(e.target.value)}
                      placeholder="Buscar producto…"
                      className="w-full pl-8 pr-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
                    />
                  </div>
                  <div className="border border-zinc-200 rounded-lg divide-y divide-zinc-100 max-h-64 overflow-y-auto">
                    {productosDisponibles.length === 0 ? (
                      <div className="py-6 text-center">
                        <Package size={24} className="mx-auto text-zinc-300 mb-2" />
                        <p className="text-xs text-zinc-400">Sin resultados</p>
                      </div>
                    ) : productosDisponibles.map(p => (
                      <button
                        key={p.id}
                        onClick={() => agregarProducto(p)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-amber-50 text-left transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-8 h-8 rounded-md overflow-hidden bg-zinc-100 border border-zinc-200/60 shrink-0 flex items-center justify-center">
                            {p.imagen ? (
                              <img src={p.imagen} alt={p.nombre} className="w-full h-full object-cover" />
                            ) : (
                              <Package size={14} className="text-zinc-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-700 truncate">{p.nombre}</p>
                            <p className="text-xs text-zinc-400">{p.codigo} · {p.es_por_encargo && p.stock <= 0 ? 'Sin stock (Por encargo)' : `stock: ${p.stock}`} {p.mililitros ? `· ${p.mililitros}ml` : ''}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-amber-600">{formatCurrency(p.precio_venta)}</p>
                          <p className="text-xs text-zinc-300 group-hover:text-amber-400 transition-colors">+ agregar</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Cart */}
                <div className="w-64 shrink-0">
                  <div className="flex items-center gap-2 mb-2">
                    <ShoppingCart size={14} className="text-zinc-500" />
                    <span className="text-sm font-semibold text-zinc-600">Carrito ({carrito.length})</span>
                  </div>
                  <div className="border border-zinc-200 rounded-lg divide-y divide-zinc-100 min-h-32 max-h-64 overflow-y-auto">
                    {carrito.length === 0 ? (
                      <div className="py-8 text-center">
                        <ShoppingCart size={20} className="mx-auto text-zinc-300 mb-1" />
                        <p className="text-xs text-zinc-400">Carrito vacío</p>
                      </div>
                    ) : carrito.map(item => {
                      const prod = productos.find(p => p.id === item.producto_id)!;
                      return (
                        <div key={item.producto_id} className="p-2.5">
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-xs font-medium text-zinc-700 leading-tight">{item.nombre} {prod?.mililitros ? `(${prod.mililitros}ml)` : ''}</p>
                            <button onClick={() => quitarProducto(item.producto_id)} className="text-zinc-300 hover:text-red-500 transition-colors shrink-0 cursor-pointer">
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => cambiarCantidad(item.producto_id, item.cantidad - 1, prod?.stock ?? 99)}
                                className="w-5 h-5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs font-bold cursor-pointer"
                              >−</button>
                              <span className="text-xs font-semibold text-zinc-700 w-5 text-center">{item.cantidad}</span>
                              <button
                                onClick={() => cambiarCantidad(item.producto_id, item.cantidad + 1, prod?.es_por_encargo ? 9999 : (prod?.stock ?? 0))}
                                className="w-5 h-5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-600 flex items-center justify-center text-xs font-bold cursor-pointer"
                              >+</button>
                            </div>
                            {esObsequio(item) ? (
                              <span className="text-[10px] font-extrabold text-emerald-600 tracking-wide">OBSEQUIO</span>
                            ) : (
                              <span className="text-xs font-bold text-amber-600">{formatCurrency(item.subtotal)}</span>
                            )}
                          </div>
                          {!item.es_preparado && (
                            <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none w-fit">
                              <input
                                type="checkbox"
                                checked={esObsequio(item)}
                                onChange={() => toggleObsequio(item.producto_id)}
                                className="w-3.5 h-3.5 rounded border-zinc-300 accent-emerald-600 cursor-pointer"
                              />
                              <span className={`text-[10px] font-semibold ${esObsequio(item) ? 'text-emerald-700' : 'text-zinc-400'}`}>
                                Obsequio
                              </span>
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {carrito.length > 0 && (
                    <div className="mt-2 p-2.5 bg-zinc-50 rounded-lg border border-zinc-200 space-y-2">
                      {descuentoMonto > 0 && (
                        <div className="flex items-center justify-between text-xs text-zinc-500">
                          <span>Subtotal</span>
                          <span className="font-mono">{formatCurrency(subtotalBruto)}</span>
                        </div>
                      )}

                      {subtotalBruto > 0 && !descuentoAbierto && descuentoMonto === 0 && (
                        <button
                          type="button"
                          onClick={() => setDescuentoAbierto(true)}
                          className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer"
                        >
                          + Aplicar descuento
                        </button>
                      )}

                      {subtotalBruto > 0 && (descuentoAbierto || descuentoMonto > 0) && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-amber-800 tracking-wider">Descuento</span>
                            <button
                              type="button"
                              onClick={() => { setDescuentoAbierto(false); setDescuentoValor(0); setDescuentoMotivo(''); }}
                              className="text-[10px] font-semibold text-zinc-400 hover:text-red-500 cursor-pointer"
                            >Quitar</button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <div className="flex rounded-md overflow-hidden border border-amber-300 shrink-0">
                              <button
                                type="button"
                                onClick={() => setDescuentoTipo('porcentaje')}
                                className={`px-2 py-1 text-[11px] font-bold cursor-pointer transition-colors ${descuentoTipo === 'porcentaje' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
                              >%</button>
                              <button
                                type="button"
                                onClick={() => setDescuentoTipo('monto')}
                                className={`px-2 py-1 text-[11px] font-bold cursor-pointer transition-colors ${descuentoTipo === 'monto' ? 'bg-amber-500 text-white' : 'bg-white text-amber-700 hover:bg-amber-100'}`}
                              >COP</button>
                            </div>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={descuentoValor === 0 ? '' : descuentoValor}
                              onChange={e => {
                                const v = e.target.value.replace(/\D/g, '');
                                setDescuentoValor(v === '' ? 0 : Number(v));
                              }}
                              placeholder={descuentoTipo === 'porcentaje' ? '10' : '90.000'}
                              className="flex-1 min-w-0 px-2 py-1 rounded-md border border-amber-300 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400"
                            />
                          </div>

                          {descuentoMonto > 0 && (
                            <p className="text-[10px] text-amber-800 font-semibold">
                              {descuentoTipo === 'porcentaje'
                                ? `Equivale a ${formatCurrency(descuentoMonto)}`
                                : `Equivale al ${descuentoPct.toFixed(1)}% del subtotal`}
                            </p>
                          )}

                          <div className="flex flex-wrap gap-1">
                            {MOTIVOS_DESCUENTO.map(m => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setDescuentoMotivo(descuentoMotivo === m ? '' : m)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors ${descuentoMotivo === m ? 'bg-amber-600 text-white' : 'bg-white text-zinc-600 border border-zinc-200 hover:border-amber-300'}`}
                              >{m}</button>
                            ))}
                          </div>
                          <input
                            type="text"
                            value={MOTIVOS_DESCUENTO.includes(descuentoMotivo) ? '' : descuentoMotivo}
                            onChange={e => setDescuentoMotivo(e.target.value)}
                            placeholder="U otro motivo…"
                            className={`w-full px-2 py-1 rounded-md text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400 ${descuentoMonto > 0 && !descuentoMotivo.trim() ? 'border border-red-300 bg-red-50/50' : 'border border-zinc-200'}`}
                          />
                          {descuentoMonto > 0 && !descuentoMotivo.trim() && (
                            <p className="text-[10px] font-semibold text-red-600">El motivo es obligatorio.</p>
                          )}
                        </div>
                      )}

                      {descuentoMonto > 0 && (
                        <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold">
                          <span className="truncate pr-2">Descuento{descuentoMotivo ? ` · ${descuentoMotivo}` : ''}</span>
                          <span className="font-mono shrink-0">−{formatCurrency(descuentoMonto)}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1.5 border-t border-zinc-200">
                        <span className="text-xs text-zinc-500 font-medium">Total</span>
                        <span className="text-base font-bold text-amber-600">{formatCurrency(total)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between pt-2 border-t border-zinc-100">
                <Button variant="secondary" onClick={() => setStep('cliente')}>Atrás</Button>
                <Button disabled={carrito.length === 0} onClick={() => setStep('confirmar')}>
                  Revisar <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {/* Step: Confirmar */}
          {step === 'confirmar' && (
            <div className="space-y-4">
              <AlertBox type="note" title="Revisa antes de confirmar">
                Al confirmar se descuenta el stock de cada producto automáticamente.
              </AlertBox>

              <div className="bg-zinc-50 rounded-lg border border-zinc-200 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Cliente</span>
                  <span className="font-semibold text-zinc-800">{clienteSeleccionado?.nombre}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Vendedor</span>
                  <span className="font-semibold text-zinc-800">{user?.name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Fecha</span>
                  <span className="font-semibold text-zinc-800">{new Date().toLocaleDateString('es-CO')}</span>
                </div>
              </div>

              {/* Método de Pago */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-700">Método de Pago</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input 
                      type="radio" 
                      name="metodoPago" 
                      value="contado" 
                      checked={metodoPago === 'contado'} 
                      onChange={() => setMetodoPago('contado')}
                      className="text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-zinc-700">De Contado</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input 
                      type="radio" 
                      name="metodoPago" 
                      value="credito" 
                      disabled={clienteId === 'walk-in'}
                      checked={metodoPago === 'credito'} 
                      onChange={() => setMetodoPago('credito')}
                      className="text-amber-600 focus:ring-amber-500 disabled:opacity-50"
                    />
                    <span className={`text-sm ${clienteId === 'walk-in' ? 'text-zinc-400' : 'text-zinc-700'}`}>A Crédito</span>
                  </label>
                </div>
                
                {metodoPago === 'credito' && clienteId === 'walk-in' && (
                  <p className="text-xs text-red-600 mt-1 font-medium">Debe seleccionar un cliente registrado para usar crédito.</p>
                )}
                
                {metodoPago === 'credito' && clienteId !== 'walk-in' && clienteSeleccionado && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-blue-700 font-medium">Cupo Disponible del Cliente:</span>
                      <span className="text-blue-700 font-bold">
                        {formatCurrency((clienteSeleccionado.limite_credito || 0) - (clienteSeleccionado.credito_usado || 0))}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-blue-200/60 space-y-2">
                      <label className="block text-xs font-bold text-blue-900 uppercase tracking-wider">
                        Abono / Pago Inicial (Opcional)
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <span className="block text-[11px] text-zinc-500 mb-1">Monto a abonar hoy</span>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-bold">$</span>
                            <input
                              type="text"
                              placeholder="0"
                              value={formatNumberWithDots(abonoInicial)}
                              onChange={e => {
                                const digits = e.target.value.replace(/\D/g, '');
                                const val = digits ? parseInt(digits, 10) : 0;
                                setAbonoInicial(Math.min(val, total));
                              }}
                              className="w-full pl-6 pr-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-semibold text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                            />
                          </div>
                        </div>
                        <div>
                          <span className="block text-[11px] text-zinc-500 mb-1">Método de pago del abono</span>
                          <select
                            value={abonoMetodoPago}
                            onChange={e => setAbonoMetodoPago(e.target.value as any)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 cursor-pointer"
                          >
                            <option value="efectivo">Efectivo</option>
                            <option value="transferencia">Transferencia</option>
                            <option value="tarjeta">Tarjeta</option>
                          </select>
                        </div>
                      </div>

                      {abonoInicial > 0 && (
                        <div className="mt-2 text-xs p-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 space-y-1">
                          <div className="flex justify-between">
                            <span>Abono pagado inmediatamente:</span>
                            <span className="font-bold">{formatCurrency(abonoInicial)}</span>
                          </div>
                          <div className="flex justify-between font-bold border-t border-emerald-200/60 pt-1 text-emerald-900">
                            <span>Saldo pendiente a crédito (Deuda):</span>
                            <span>{formatCurrency(Math.max(0, total - abonoInicial))}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {Math.max(0, total - abonoInicial) > ((clienteSeleccionado.limite_credito || 0) - (clienteSeleccionado.credito_usado || 0)) && (
                      <p className="text-xs text-red-600 font-medium">El cliente no tiene suficiente cupo para la deuda restante.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-zinc-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-500">Producto</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-zinc-500">Cant.</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500">P. Unit.</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-500">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {carrito.map(item => (
                      <tr key={item.producto_id}>
                        <td className="px-4 py-2.5 text-zinc-700 truncate max-w-0" title={item.nombre}>{item.nombre}</td>
                        <td className="px-4 py-2.5 text-center text-zinc-600">{item.cantidad}</td>
                        <td className="px-4 py-2.5 text-right text-zinc-600">{esObsequio(item) ? '—' : formatCurrency(item.precio_unitario)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          {esObsequio(item)
                            ? <span className="text-emerald-600 font-extrabold text-xs">OBSEQUIO</span>
                            : <span className="text-zinc-800">{formatCurrency(item.subtotal)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-zinc-200 bg-zinc-50">
                    {metodoPago === 'credito' && abonoInicial > 0 && (
                      <>
                        <tr>
                          <td colSpan={3} className="px-4 py-1.5 text-right text-xs text-zinc-500 font-medium">Abono Inicial (Pagado hoy):</td>
                          <td className="px-4 py-1.5 text-right text-xs font-bold text-emerald-600 font-mono">-{formatCurrency(abonoInicial)}</td>
                        </tr>
                        <tr className="bg-amber-50/50 border-t border-zinc-200">
                          <td colSpan={3} className="px-4 py-1.5 text-right text-xs font-semibold text-amber-900">Saldo a Crédito (Deuda):</td>
                          <td className="px-4 py-1.5 text-right text-xs font-bold text-amber-900 font-mono">{formatCurrency(Math.max(0, total - abonoInicial))}</td>
                        </tr>
                      </>
                    )}
                    {descuentoMonto > 0 && (
                      <>
                        <tr>
                          <td colSpan={3} className="px-4 py-1.5 text-right text-xs text-zinc-500 font-medium">Subtotal:</td>
                          <td className="px-4 py-1.5 text-right text-xs text-zinc-600 font-mono">{formatCurrency(subtotalBruto)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="px-4 py-1.5 text-right text-xs text-emerald-700 font-semibold">
                            Descuento{descuentoMotivo ? ` · ${descuentoMotivo}` : ''}:
                          </td>
                          <td className="px-4 py-1.5 text-right text-xs font-bold text-emerald-600 font-mono">−{formatCurrency(descuentoMonto)}</td>
                        </tr>
                      </>
                    )}
                    <tr className="bg-amber-50 border-t-2 border-amber-200">
                      <td colSpan={3} className="px-4 py-2.5 text-right font-bold text-amber-700">TOTAL VENTA</td>
                      <td className="px-4 py-2.5 text-right font-bold text-amber-700 text-base font-mono">{formatCurrency(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700">
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2 border-t border-zinc-100">
                <Button variant="secondary" onClick={() => setStep('productos')}>Atrás</Button>
                <Button 
                  onClick={handleConfirm}
                  disabled={
                    (metodoPago === 'credito' && clienteId === 'walk-in') || 
                    (metodoPago === 'credito' && clienteSeleccionado && Math.max(0, total - abonoInicial) > ((clienteSeleccionado.limite_credito || 0) - (clienteSeleccionado.credito_usado || 0)))
                  }
                >
                  <CheckCircle2 size={15} />
                  Confirmar Venta
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      </Modal>
      <PrepararTripleAaaModal 
        isOpen={tripleAaaModalOpen} 
        onClose={() => setTripleAaaModalOpen(false)} 
        onAdd={agregarPreparado} 
      />
    </>
  );
}

// ── Main Ventas Page ──────────────────────────────────────────────────────────
export function Ventas() {
  const { ventas, abonos, anularVenta, configuracion } = useAppData();
  const { isAdmin, user } = useAuth();
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState<Venta['estado'] | 'todos'>('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [detailVenta, setDetailVenta] = useState<Venta | null>(null);
  const [anularConfirm, setAnularConfirm] = useState<Venta | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const saldosPorVenta = useMemo(() => calcularSaldosCredito(ventas, abonos), [ventas, abonos]);

  const filtered = useMemo(() => ventas.filter(v => {
    const matchSearch = (v.factura || '').toLowerCase().includes(search.toLowerCase()) ||
      (v.cliente_nombre || '').toLowerCase().includes(search.toLowerCase()) ||
      (v.vendedor_nombre || '').toLowerCase().includes(search.toLowerCase());
    const matchEstado = filterEstado === 'todos' || v.estado === filterEstado;
    return matchSearch && matchEstado;
  }), [ventas, search, filterEstado]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [filtered.length, totalPages, currentPage]);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  const totalVisibles = filtered.filter(v => v.estado === 'completada').reduce((s, v) => s + v.total, 0);

  const exportToCSV = () => {
    const headers = {
      factura: 'Factura',
      cliente_nombre: 'Cliente',
      vendedor_nombre: 'Vendedor',
      fecha: 'Fecha',
      total: 'Total Venta',
      estado: 'Estado',
      items_count: 'Cantidad Items'
    };

    const dataToExport = filtered.map(v => ({
      ...v,
      items_count: v.items.length
    }));

    downloadCSV(dataToExport, `Registro_Ventas_${new Date().toISOString().slice(0, 10)}`, headers);
  };

  const handleDownloadTirillaPOS = async (venta?: Venta) => {
    try {
      const v = venta || detailVenta;
      if (!v) return;

      const itemHeight = (v.items || []).length * 8;
      const totalHeight = Math.max(120, 85 + itemHeight);

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [80, totalHeight]
      });

      const pageWidth = 80;
      let y = 8;

      // Header logo
      try {
        const response = await fetch('/logo.png');
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          pdf.addImage(base64, 'JPEG', (pageWidth - 16) / 2, y, 16, 16);
          y += 18;
        }
      } catch (e) {
        console.warn('Could not load logo for POS PDF', e);
      }

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(0, 0, 0);
      pdf.text(configuracion.nombre, pageWidth / 2, y, { align: 'center' });
      y += 5;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      if (configuracion.nit) {
        pdf.text(`NIT: ${configuracion.nit}`, pageWidth / 2, y, { align: 'center' });
        y += 4;
      }
      if (configuracion.direccion) {
        pdf.text(configuracion.direccion, pageWidth / 2, y, { align: 'center' });
        y += 4;
      }
      if (configuracion.telefono) {
        pdf.text(`Tel: ${configuracion.telefono}`, pageWidth / 2, y, { align: 'center' });
        y += 5;
      }

      pdf.setDrawColor(0, 0, 0);
      pdf.setLineDashPattern([1, 1], 0);
      pdf.line(4, y, pageWidth - 4, y);
      y += 5;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10.5);
      pdf.text(`FACTURA: ${v.factura}`, 4, y);
      y += 5;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.text(`Fecha: ${new Date(v.fecha).toLocaleDateString('es-CO')}`, 4, y);
      y += 4;
      pdf.text(`Adquiriente: ${v.cliente_nombre}`, 4, y);
      y += 4;
      pdf.text(`Vendedor: ${v.vendedor_nombre}`, 4, y);
      y += 4;
      if (v.metodo_pago) {
        pdf.text(`Método de Pago: ${v.metodo_pago.toUpperCase()}`, 4, y);
        y += 4;
      }

      pdf.line(4, y, pageWidth - 4, y);
      y += 5;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.text('Cant  Producto', 4, y);
      pdf.text('Total', pageWidth - 4, y, { align: 'right' });
      y += 4;

      for (const item of v.items) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        const lines = pdf.splitTextToSize(item.nombre, 44);
        pdf.text(`${item.cantidad}x`, 4, y);
        pdf.text(lines[0], 14, y);
        pdf.text(Number(item.precio_unitario) === 0 ? 'OBSEQUIO' : formatCurrency(item.subtotal), pageWidth - 4, y, { align: 'right' });
        y += 4;

        if (lines.length > 1) {
          pdf.setFont('helvetica', 'normal');
          for (let i = 1; i < lines.length; i++) {
            pdf.text(lines[i], 14, y);
            y += 3.5;
          }
        }
      }

      y += 1;
      pdf.line(4, y, pageWidth - 4, y);
      y += 6;

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('TOTAL NETO:', 4, y);
      pdf.text(formatCurrency(v.total), pageWidth - 4, y, { align: 'right' });
      y += 8;

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.text('¡Gracias por su preferencia!', pageWidth / 2, y, { align: 'center' });

      pdf.save(`Tirilla-${v.factura}.pdf`);
    } catch (err: any) {
      console.error('Error al generar Tirilla POS:', err);
      alert('Error al generar tirilla: ' + (err.message || err.toString()));
    }
  };

  const handleDownloadPDF = async (venta?: Venta) => {
    try {
      const v = venta || detailVenta;
      if (!v) return;

      const pdf = new jsPDF('portrait', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      
      // Header
      try {
        const response = await fetch('/logo.png');
        if (response.ok) {
          const blob = await response.blob();
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          pdf.addImage(base64, 'JPEG', 14, 12, 20, 20);
        }
      } catch (e) {
        console.warn('Could not load logo for PDF', e);
      }

      pdf.setFontSize(20);
      pdf.setTextColor(13, 148, 136); // Teal 600
      pdf.text(configuracion.nombre, 38, 20);
      
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139); // Slate 500
      pdf.text(`NIT: ${configuracion.nit}`, 38, 26);
      pdf.text(configuracion.direccion, 38, 31);
      pdf.text(`Tel: ${configuracion.telefono}`, 38, 36);

      // Invoice info
      pdf.setFontSize(12);
      pdf.setTextColor(15, 23, 42); // Slate 900
      pdf.text('FACTURA DE VENTA', pageWidth - 14, 22, { align: 'right' });
      pdf.setFontSize(14);
      pdf.setTextColor(13, 148, 136); // Teal 600
      pdf.text(v.factura, pageWidth - 14, 29, { align: 'right' });
      
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139); // Slate 500
      pdf.text(`Fecha: ${new Date(v.fecha).toLocaleDateString('es-CO')}`, pageWidth - 14, 35, { align: 'right' });
      pdf.text(`Estado: ${v.estado.toUpperCase()}`, pageWidth - 14, 40, { align: 'right' });
      pdf.setTextColor(17, 94, 89);
      pdf.setFont('helvetica', 'bold');
      pdf.text(`MÉTODO DE PAGO: ${v.metodo_pago ? v.metodo_pago.toUpperCase() : 'CONTADO'}`, pageWidth - 14, 46, { align: 'right' });
      pdf.setFont('helvetica', 'normal');

      // Parties (No outer rectangle box)
      pdf.setFontSize(9);
      pdf.setTextColor(148, 163, 184); // Slate 400
      pdf.text('ADQUIRIENTE', 14, 57);
      pdf.text('CAJERO / VENDEDOR', pageWidth / 2, 57);
      
      pdf.setFontSize(11);
      pdf.setTextColor(30, 41, 59); // Slate 800
      pdf.setFont('helvetica', 'bold');
      pdf.text(v.cliente_nombre, 14, 64);
      pdf.text(v.vendedor_nombre, pageWidth / 2, 64);

      // Table
      const tableData = v.items.map(item => [
        item.nombre,
        item.cantidad.toString(),
        Number(item.precio_unitario) === 0 ? '—' : formatCurrency(item.precio_unitario),
        Number(item.precio_unitario) === 0 ? 'OBSEQUIO' : formatCurrency(item.subtotal)
      ]);

      autoTable(pdf, {
        startY: 72,
        head: [['Descripción del Producto', 'Cant.', 'P. Unit.', 'Subtotal']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [241, 245, 249], textColor: [71, 85, 105], fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 4 },
        columnStyles: {
          1: { halign: 'center' },
          2: { halign: 'right' },
          3: { halign: 'right', fontStyle: 'bold' }
        },
      });

      const finalY = (pdf as any).lastAutoTable.finalY + 10;

      // Totals
      pdf.setFontSize(12);
      pdf.setTextColor(17, 94, 89); // Teal 800
      pdf.setFont('helvetica', 'bold');
      pdf.text('TOTAL NETO:', pageWidth - 60, finalY + 5, { align: 'right' });
      pdf.text(formatCurrency(v.total), pageWidth - 14, finalY + 5, { align: 'right' });

      // Footer message (No DIAN!)
      pdf.setFontSize(9);
      pdf.setTextColor(100, 116, 139);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`¡Gracias por su compra en ${configuracion.nombre}!`, pageWidth / 2, finalY + 25, { align: 'center' });

      pdf.save(`Factura-${v.factura}.pdf`);
    } catch (err: any) {
      console.error('Error al generar PDF de venta:', err);
      alert('Error al generar PDF: ' + (err.message || err.toString()));
    }
  };

  return (
    <Layout
      title="Ventas"
      subtitle="Historial y gestión de ventas"
      action={<Button icon={<Plus size={16} />} onClick={() => setModalOpen(true)}>Nueva Venta</Button>}
    >
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
            placeholder="Buscar por factura, cliente o vendedor…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
          />
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {(['todos', 'completada', 'pendiente', 'anulada'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setFilterEstado(s); setCurrentPage(1); }}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                filterEstado === s
                  ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
              }`}
            >
              {s === 'todos' ? 'Todos' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <Button variant="secondary" size="sm" icon={<FileDown size={14} />} onClick={exportToCSV}>
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* Summary */}
      {filtered.length > 0 && (
        <div className="mb-4 text-sm text-zinc-500">
          Total completadas en filtro: <span className="font-bold text-amber-600">{formatCurrency(totalVisibles)}</span>
        </div>
      )}

      {/* Table & Mobile Cards */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        
        {/* Mobile Cards */}
        <div className="md:hidden divide-y divide-zinc-100">
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <ShoppingCart size={32} className="mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-400 text-sm">No se encontraron ventas</p>
            </div>
          ) : paginated.map(v => (
            <div key={v.id} className={`p-4 space-y-3 hover:bg-zinc-50/60 transition-colors ${v.estado === 'anulada' ? 'opacity-60' : ''}`}>
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-bold text-zinc-800 text-sm">{v.cliente_nombre}</p>
                  <p className="text-xs text-amber-600 font-mono font-semibold">{v.factura} <span className="text-zinc-400 font-sans font-normal">· {new Date(v.fecha).toLocaleDateString('es-CO')}</span></p>
                </div>
                <Badge variant={v.estado} />
              </div>

              <div className="bg-zinc-50 rounded-lg p-2.5 border border-zinc-100 text-xs text-zinc-600 flex justify-between items-center">
                <div>
                  <p className="text-zinc-400 text-[10px] uppercase font-bold">Vendedor</p>
                  <p className="font-medium text-zinc-700">{v.vendedor_nombre}</p>
                </div>
                <div className="text-right">
                  <p className="text-zinc-400 text-[10px] uppercase font-bold">{v.items.length} Ítems</p>
                  <p className="font-bold text-zinc-800 text-sm">{formatCurrency(v.total)}</p>
                </div>
              </div>

              {saldosPorVenta.has(v.id) && (
                <div className="bg-amber-50/60 rounded-lg p-2.5 border border-amber-100 text-xs flex justify-between items-center">
                  <div>
                    <p className="text-zinc-400 text-[10px] uppercase font-bold">Abonado</p>
                    <p className="font-semibold text-emerald-600 font-mono">{formatCurrency(saldosPorVenta.get(v.id)!.abonado)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-zinc-400 text-[10px] uppercase font-bold">Saldo</p>
                    <p className={`font-bold font-mono ${saldosPorVenta.get(v.id)!.saldo > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatCurrency(saldosPorVenta.get(v.id)!.saldo)}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setDetailVenta(v)}
                  className="flex-1 py-2 flex items-center justify-center bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold transition-colors"
                >
                  <FileText size={14} className="mr-1.5" /> Detalle
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownloadPDF(v); }}
                  className="flex-1 py-2 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-xs font-semibold transition-colors"
                >
                  <Download size={14} className="mr-1.5" /> PDF
                </button>
                {isAdmin && v.estado !== 'anulada' && (
                  <button
                    onClick={() => setAnularConfirm(v)}
                    className="px-3.5 py-2 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                  >
                    <XCircle size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                {['Factura', 'Cliente', 'Vendedor', 'Fecha', 'Ítems', 'Total', 'Saldo', 'Estado', 'Acciones'].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center">
                    <ShoppingCart size={32} className="mx-auto text-zinc-300 mb-3" />
                    <p className="text-zinc-400 text-sm">No se encontraron ventas</p>
                  </td>
                </tr>
              ) : paginated.map(v => (
                <tr key={v.id} className={`hover:bg-zinc-50/60 transition-colors ${v.estado === 'anulada' ? 'opacity-60' : ''}`}>
                  <td className="px-5 py-3.5 font-mono text-xs text-amber-600 font-semibold">{v.factura}</td>
                  <td className="px-5 py-3.5 font-medium text-zinc-800">{v.cliente_nombre}</td>
                  <td className="px-5 py-3.5 text-zinc-600">{v.vendedor_nombre}</td>
                  <td className="px-5 py-3.5 text-zinc-600 whitespace-nowrap">{new Date(v.fecha).toLocaleDateString('es-CO')}</td>
                  <td className="px-5 py-3.5 text-zinc-500">{v.items.length} ítem(s)</td>
                  <td className="px-5 py-3.5 font-semibold text-zinc-800 whitespace-nowrap">{formatCurrency(v.total)}</td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {saldosPorVenta.has(v.id) ? (
                      <div className="leading-tight">
                        <span className={`font-bold font-mono text-sm ${saldosPorVenta.get(v.id)!.saldo > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatCurrency(saldosPorVenta.get(v.id)!.saldo)}
                        </span>
                        {saldosPorVenta.get(v.id)!.abonado > 0 && (
                          <span className="block text-[10px] text-emerald-600 font-mono">
                            abonado {formatCurrency(saldosPorVenta.get(v.id)!.abonado)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-zinc-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5"><Badge variant={v.estado} /></td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDetailVenta(v)}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-amber-600 transition-colors cursor-pointer"
                        title="Ver detalle"
                      >
                        <FileText size={16} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadPDF(v);
                        }}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-amber-600 transition-colors cursor-pointer"
                        title="Descargar comprobante"
                      >
                        <Download size={16} />
                      </button>
                      {isAdmin && v.estado !== 'anulada' && (
                        <button
                          onClick={() => setAnularConfirm(v)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-600 transition-colors cursor-pointer"
                          title="Anular venta"
                        >
                          <XCircle size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3.5 border-t border-zinc-100 bg-zinc-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500 font-medium">
          <div>
            {filtered.length > 0 ? (
              <span>
                Mostrando <strong className="text-zinc-700">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> al <strong className="text-zinc-700">{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)}</strong> de <strong className="text-zinc-700">{filtered.length}</strong> ventas
              </span>
            ) : (
              <span>0 ventas registradas</span>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2.5">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                className="px-2.5 py-1 rounded-md border border-zinc-200 bg-white text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                Anterior
              </button>
              <span className="font-semibold text-zinc-500">
                Pág. {currentPage} de {totalPages}
              </span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                className="px-2.5 py-1 rounded-md border border-zinc-200 bg-white text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Nueva Venta Modal */}
      <NuevaVentaModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />

      {/* Detail Modal */}
      <Modal isOpen={!!detailVenta} onClose={() => setDetailVenta(null)} title={`Factura — ${detailVenta?.factura}`} size="xl">
        {detailVenta && (() => {
          const ivaFactor = 1 + (configuracion.iva_porcentaje / 100);
          const subtotalSinIva = detailVenta.total / ivaFactor;
          const ivaCalculado = detailVenta.total - subtotalSinIva;

          return (
            <div className="space-y-6">
              {/* Printable Invoice Container */}
              <div id="printable-invoice" className="bg-white border border-zinc-200 rounded-xl p-5 sm:p-6 space-y-4 print:border-0 print:p-0 print:shadow-none print:w-full print:max-w-none">
                
                {/* Invoice Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-200 pb-4 print:border-b-2 print:border-black print:pb-3">
                  <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="Logo" className="w-16 h-16 object-contain print:w-14 print:h-14 shrink-0" onError={(e) => e.currentTarget.style.display = 'none'} />
                    <div>
                      <h3 className="font-extrabold text-zinc-900 text-lg sm:text-xl print:text-base print:text-black leading-tight">{configuracion.nombre}</h3>
                      <p className="text-xs text-zinc-600 print:text-black font-medium mt-0.5">NIT: {configuracion.nit}</p>
                      <p className="text-xs text-zinc-500 print:text-black">{configuracion.direccion}</p>
                      <p className="text-xs text-zinc-500 print:text-black">Tel: {configuracion.telefono}</p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right space-y-1 shrink-0 print:text-left print:mt-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 print:text-black block">Factura de Venta</span>
                    <h4 className="text-xl font-mono font-bold text-amber-600 print:text-black print:text-lg">{detailVenta.factura}</h4>
                    <p className="text-xs text-zinc-600 print:text-black font-medium">Fecha: {new Date(detailVenta.fecha).toLocaleDateString('es-CO')}</p>
                    <div className="print:hidden">
                      <Badge variant={detailVenta.estado} className="mt-1" />
                    </div>
                  </div>
                </div>

                {/* Cliente / Vendedor Metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-zinc-50 p-3 rounded-lg border border-zinc-100 print:bg-transparent print:border-0 print:p-0 print:gap-1 print:my-2">
                  <div>
                    <span className="text-zinc-400 print:text-black font-bold uppercase tracking-wider text-[10px] sm:text-xs">ADQUIRIENTE: </span>
                    <span className="font-bold text-zinc-800 print:text-black text-xs sm:text-sm">{detailVenta.cliente_nombre}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 print:text-black font-bold uppercase tracking-wider text-[10px] sm:text-xs">CAJERO / VENDEDOR: </span>
                    <span className="font-bold text-zinc-800 print:text-black text-xs sm:text-sm">{detailVenta.vendedor_nombre}</span>
                  </div>
                  {detailVenta.metodo_pago && (
                    <div>
                      <span className="text-zinc-400 print:text-black font-bold uppercase tracking-wider text-[10px] sm:text-xs">MÉTODO DE PAGO: </span>
                      <span className="font-bold text-zinc-800 print:text-black text-xs sm:text-sm uppercase">{detailVenta.metodo_pago}</span>
                    </div>
                  )}
                </div>

                {/* Items Table */}
                <div className="rounded-lg border border-zinc-200 overflow-hidden print:border-0 print:rounded-none">
                  <table className="w-full text-xs print:text-sm print:font-sans">
                    <thead className="bg-zinc-50 border-b border-zinc-200 print:bg-transparent print:border-y print:border-black">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold text-zinc-700 print:text-black print:px-0">Producto</th>
                        <th className="px-3 py-2 text-center font-bold text-zinc-700 print:text-black print:px-0">Cant.</th>
                        <th className="px-3 py-2 text-right font-bold text-zinc-700 print:text-black print:px-0">P. Unit</th>
                        <th className="px-3 py-2 text-right font-bold text-zinc-700 print:text-black print:px-0">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 print:divide-y-0">
                      {detailVenta.items.map(item => (
                        <tr key={item.producto_id} className="hover:bg-zinc-50/20 print:border-b print:border-zinc-200">
                          <td className="px-3 py-2 text-zinc-800 font-medium print:text-black print:px-0 print:py-1.5" title={item.nombre}>{item.nombre}</td>
                          <td className="px-3 py-2 text-center text-zinc-600 font-mono print:text-black print:px-0 print:py-1.5">{item.cantidad}</td>
                          <td className="px-3 py-2 text-right text-zinc-600 font-mono print:text-black print:px-0 print:py-1.5">{Number(item.precio_unitario) === 0 ? '—' : formatCurrency(item.precio_unitario)}</td>
                          <td className="px-3 py-2 text-right font-bold font-mono print:text-black print:px-0 print:py-1.5">
                            {Number(item.precio_unitario) === 0
                              ? <span className="text-emerald-600">OBSEQUIO</span>
                              : <span className="text-zinc-900">{formatCurrency(item.subtotal)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-zinc-200 bg-zinc-50/50 print:bg-transparent print:border-t-2 print:border-black">
                      <tr className="bg-amber-50/50 print:bg-transparent">
                        <td colSpan={3} className="px-3 py-2.5 text-right font-extrabold text-amber-900 print:text-black text-sm print:text-base">TOTAL NETO</td>
                        <td className="px-3 py-2.5 text-right font-extrabold text-amber-900 print:text-black text-sm print:text-base font-mono">{formatCurrency(detailVenta.total)}</td>
                      </tr>
                      {saldosPorVenta.has(detailVenta.id) && (
                        <>
                          <tr>
                            <td colSpan={3} className="px-3 py-1.5 text-right text-emerald-700 print:text-black font-semibold">Abonado</td>
                            <td className="px-3 py-1.5 text-right text-emerald-700 print:text-black font-bold font-mono">
                              −{formatCurrency(saldosPorVenta.get(detailVenta.id)!.abonado)}
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={3} className="px-3 py-1.5 text-right font-extrabold text-zinc-800 print:text-black">SALDO PENDIENTE</td>
                            <td className={`px-3 py-1.5 text-right font-extrabold font-mono print:text-black ${saldosPorVenta.get(detailVenta.id)!.saldo > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                              {formatCurrency(saldosPorVenta.get(detailVenta.id)!.saldo)}
                            </td>
                          </tr>
                        </>
                      )}
                    </tfoot>
                  </table>
                </div>

                {/* Footer message (No DIAN) */}
                <div className="pt-2 text-center text-xs text-zinc-400 print:text-black print:pt-4 print:text-xs border-t border-dashed border-zinc-200 print:border-black">
                  <p className="font-semibold print:font-bold">¡Gracias por su preferencia!</p>
                </div>
              </div>

              {/* Detail Buttons (Hidden on Print) */}
              <div className="flex flex-wrap justify-between items-center gap-3 pt-2 border-t border-zinc-100 print:hidden">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" icon={<Printer size={15} />} onClick={() => window.print()}>
                    Imprimir Tirilla POS
                  </Button>
                  <Button variant="secondary" icon={<Download size={15} />} onClick={() => handleDownloadTirillaPOS()}>
                    Descargar Tirilla (80mm)
                  </Button>
                  <Button variant="ghost" icon={<FileDown size={15} />} onClick={() => handleDownloadPDF()}>
                    Factura A4
                  </Button>
                </div>
                <Button variant="ghost" onClick={() => setDetailVenta(null)}>
                  Cerrar
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Anular Confirm */}
      <Modal isOpen={!!anularConfirm} onClose={() => setAnularConfirm(null)} title="Anular Venta" size="sm">
        <AlertBox type="warning" title="Anular venta">
          ¿Anular la venta <strong>{anularConfirm?.factura}</strong> de {formatCurrency(anularConfirm?.total ?? 0)}?
          Esta acción devolverá automáticamente los productos y materias primas al inventario.
        </AlertBox>
        <div className="flex justify-end gap-3 mt-5">
          <Button variant="secondary" onClick={() => setAnularConfirm(null)}>Cancelar</Button>
          <Button variant="warning" onClick={() => { anularVenta(anularConfirm!.id, user?.name || 'Usuario', user?.id || '', user?.role || 'admin'); setAnularConfirm(null); }}>
            Sí, Anular Venta
          </Button>
        </div>
      </Modal>
    </Layout>
  );
}
