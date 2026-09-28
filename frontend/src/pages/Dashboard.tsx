import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  TrendingUp, Package, AlertTriangle, ShoppingCart, Activity,
  Award, Wallet, FileDown
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useAppData } from '../context/AppDataContext';
import { calcularSaldosCredito } from '../utils/creditoFifo';
import { exportToCSV as downloadCSV } from '../utils/exportToCSV';

function KpiCard({ title, value, subtitle, icon, trend, color, delayClass = '' }: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  trend?: string;
  color: string;
  delayClass?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-zinc-200 p-6 shadow-xs hover:shadow-lg hover:-translate-y-1 hover:border-amber-100 transition-all duration-300 group cursor-pointer ${delayClass}`}>
      <div className="flex items-start justify-between">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-transform duration-300 group-hover:scale-110 ${color}`}>
          {icon}
        </div>
        {trend && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100/50 px-2 py-0.5 rounded-full">
            <Activity size={10} className="animate-pulse" />
            {trend}
          </span>
        )}
      </div>
      <div className="mt-5">
        <p className="text-xs text-zinc-400 font-bold uppercase tracking-wider">{title}</p>
        <p className="text-3xl font-extrabold text-zinc-900 mt-1 tracking-tight">{value}</p>
        <p className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 group-hover:bg-amber-500 transition-colors" />
          {subtitle}
        </p>
      </div>
    </div>
  );
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

const formatFecha = (dateStr: string) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-zinc-200 rounded-lg shadow-lg p-3">
        <p className="text-xs font-semibold text-zinc-600 mb-1">{label}</p>
        <p className="text-sm font-bold text-amber-600">{formatCurrency(payload[0].value)}</p>
        <p className="text-xs text-zinc-400">{payload[1]?.value ?? 0} venta(s)</p>
      </div>
    );
  }
  return null;
};

export function Dashboard() {
  const { productos, ventas, clientes, logs, compras, gastos, materiasPrimas, movimientosMateriasPrimas, abonos } = useAppData();

  const getLocalDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const [startDate, setStartDate] = useState(getLocalDate());
  const [endDate, setEndDate] = useState(getLocalDate());

  // Convierte fecha UTC a YYYY-MM-DD en la zona horaria local
  const getLocalIsoDate = (dateStr: string) => {
    if (!dateStr) return '';
    if (dateStr.length === 10) return dateStr;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr.substring(0, 10);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const productosStockBajo = productos.filter(p => p.estado === 'stock_bajo' || p.stock <= p.stock_minimo);
  const materiasPrimasStockBajo = materiasPrimas.filter(m => m.estado === 'stock_bajo' || Number(m.stock) <= Number(m.stock_minimo));
  const totalStockBajo = productosStockBajo.length + materiasPrimasStockBajo.length;

  // Rango de fechas. Un input de fecha vacío se trata como "sin límite" en vez de
  // excluirlo todo, que dejaba el tablero entero en $0 sin explicación.
  const desde = startDate || '0000-01-01';
  const hasta = endDate || '9999-12-31';

  const isBetweenDates = (dateStr: string) => {
    const dateOnly = getLocalIsoDate(dateStr);
    return dateOnly >= desde && dateOnly <= hasta;
  };

  // Ventas activas (todas menos anuladas) para costos y causación
  const ventasActivas = ventas.filter(v => v.estado !== 'anulada' && isBetweenDates(v.fecha));

  const comprasFiltradas = compras.filter(c => c.estado === 'completada' && isBetweenDates(c.fecha));
  const gastosFiltrados = gastos.filter(g => isBetweenDates(g.fecha));

  // El crédito pendiente es global y refleja la deuda total actual de los clientes
  const clientesConDeuda = clientes.filter(c => c.credito_usado && c.credito_usado > 0);
  const totalCreditoPendiente = clientes.reduce((sum, c) => sum + (Number(c.credito_usado) || 0), 0);

  // ── CÁLCULOS FINANCIEROS Y DE NEGOCIO REAL ─────────────────────────────────
  // 1. Facturación Total (Causación)
  const totalFacturado = ventasActivas.reduce((s, v) => s + (Number(v.total) || 0), 0);

  // 2. Costo de Ventas Real (COGS - Cost of Goods Sold)
  // Se calcula sobre TODAS las ventas activas, porque la mercancía salió.
  // El costo de los perfumes preparados no se puede leer del ítem: el backend no persiste
  // `receta` en venta_detalles. Se reconstruye desde los movimientos de materias primas,
  // que sí registran la receta consumida con referencia "Venta {factura}". Las de anulación
  // llevan "Anulación de Venta ..." y tipo 'entrada', por eso no entran.
  //
  // Solo se cuentan los insumos cuyo costo ya quedó confirmado por una compra registrada.
  // Los demás conservan un costo cargado a mano que suele ser el precio del envase entero,
  // y computarlo daría una pérdida falsa. Cada compra que se registre suma su insumo aquí.
  const idsConCostoDeCompra = new Set<string>();
  for (const c of compras) {
    if (c.estado === 'anulada') continue;
    for (const it of c.items || []) if (it.materia_prima_id) idsConCostoDeCompra.add(it.materia_prima_id);
  }

  const costoRecetaPorFactura = new Map<string, number>();
  const insumosPendientes = new Set<string>();
  for (const m of movimientosMateriasPrimas) {
    if (m.tipo !== 'salida' || !m.referencia?.startsWith('Venta ')) continue;
    if (!idsConCostoDeCompra.has(m.materia_prima_id)) {
      insumosPendientes.add(m.materia_prima_id);
      continue;
    }
    const factura = m.referencia.slice('Venta '.length).trim();
    const mp = materiasPrimas.find(x => x.id === m.materia_prima_id);
    const costo = (Number(m.cantidad) || 0) * (Number(mp?.costo_unitario) || 0);
    costoRecetaPorFactura.set(factura, (costoRecetaPorFactura.get(factura) || 0) + costo);
  }
  const insumosSinVerificar = insumosPendientes.size;

  // Las dos naturalezas del negocio se miden por separado: los productos de catálogo se
  // compran y se revenden tal cual, mientras que los preparados se fabrican consumiendo
  // materias primas. Mezclarlas impide saber de dónde sale realmente la ganancia.
  const catalogo = { vendido: 0, costo: 0 };
  const preparados = { vendido: 0, costo: 0 };
  // Una línea a precio 0 sobre un producto del catálogo es un obsequio: no deja ingreso,
  // pero su costo sí salió del inventario y por eso se sigue restando de la ganancia.
  // Se contabiliza aparte para que el margen no baje sin explicación visible.
  const obsequios = { unidades: 0, costo: 0 };
  // Un descuento se registra como una línea negativa de la venta. No es mercancía, así que
  // no entra en el reparto por naturaleza; se acumula aparte y agrupado por su motivo.
  const descuentos = { total: 0, ventas: 0, porMotivo: new Map<string, number>() };

  for (const v of ventasActivas) {
    let tuvoDescuento = false;
    for (const item of v.items) {
      const cantidadVendida = Number(item.cantidad) || 1;
      const subtotalLinea = Number(item.subtotal) || 0;

      if (subtotalLinea < 0) {
        const motivo = (item.nombre || '').split('·')[1]?.trim() || 'sin motivo';
        descuentos.total += Math.abs(subtotalLinea);
        descuentos.porMotivo.set(motivo, (descuentos.porMotivo.get(motivo) || 0) + Math.abs(subtotalLinea));
        tuvoDescuento = true;
        continue;
      }

      const p = productos.find(prod => prod.id === item.producto_id);
      if (p) {
        const costoLinea = cantidadVendida * (Number(p.precio_costo) || 0);
        catalogo.vendido += Number(item.subtotal) || 0;
        catalogo.costo += costoLinea;
        if (Number(item.precio_unitario) === 0) {
          obsequios.unidades += cantidadVendida;
          obsequios.costo += costoLinea;
        }
      } else {
        preparados.vendido += Number(item.subtotal) || 0;
      }
    }
    if (tuvoDescuento) descuentos.ventas++;
    preparados.costo += costoRecetaPorFactura.get(v.factura) || 0;
  }

  const costoVentas = catalogo.costo + preparados.costo;

  // Facturación según el estado de cobro, que es como el usuario lee el tablero.
  const ventasCompletadas = ventasActivas.filter(v => v.estado === 'completada');
  const ventasACredito = ventasActivas.filter(v => v.estado !== 'completada');
  const totalCompletadas = ventasCompletadas.reduce((s, v) => s + (Number(v.total) || 0), 0);
  const totalACredito = ventasACredito.reduce((s, v) => s + (Number(v.total) || 0), 0);

  // De las ventas todavía pendientes, cuánto llevan abonado y cuánto falta realmente.
  // El reparto FIFO es el mismo que usa el backend para decidir si una venta ya está pagada.
  const saldosCredito = calcularSaldosCredito(ventasActivas, abonos);
  const abonadoPendientes = ventasACredito.reduce((s, v) => s + (saldosCredito.get(v.id)?.abonado || 0), 0);
  const saldoPorCobrar = ventasACredito.reduce(
    (s, v) => s + (saldosCredito.get(v.id)?.saldo ?? (Number(v.total) || 0)),
    0
  );
  const contadoCompletadas = ventasCompletadas.filter(v => v.metodo_pago !== 'credito').length;

  // Pagado a proveedores (Compras de inventario dentro del rango seleccionado), separando
  // mercancía de reventa de insumos de fabricación. "sinDetalle" es la diferencia entre el
  // total de la factura y la suma de sus líneas: aparece en compras viejas que perdieron
  // líneas por un insert sin verificar, y se muestra aparte para no inventar a qué tipo van.
  const costoTotalCompras = comprasFiltradas.reduce((sum, c) => sum + (Number(c.total) || 0), 0);
  const comprasPorTipo = comprasFiltradas.reduce((acc, c) => {
    let sumaLineas = 0;
    for (const it of c.items || []) {
      const sub = Number(it.subtotal) || 0;
      sumaLineas += sub;
      if (it.materia_prima_id) acc.materiasPrimas += sub;
      else acc.productos += sub;
    }
    acc.sinDetalle += (Number(c.total) || 0) - sumaLineas;
    return acc;
  }, { productos: 0, materiasPrimas: 0, sinDetalle: 0 });

  // Gastos Operativos
  const totalGastos = gastosFiltrados.reduce((sum, g) => sum + (Number(g.monto) || 0), 0);

  // Ganancias (Margen Neto Real de la Operación basado en Causación)
  const gananciaTotal = totalFacturado - costoVentas - totalGastos;

  // ── CHART DATA (Dinámico basado en el rango) ──────────────────────────────
  const chartDataMap: Record<string, { fecha: string; total: number; cantidad: number }> = {};
  
  const curDate = new Date(`${desde}T12:00:00`);
  const enDate = new Date(`${hasta}T12:00:00`);
  let daysCount = 0;

  // Rellena el rango con ceros (tope de un año para no generar miles de puntos)
  while (!isNaN(curDate.getTime()) && !isNaN(enDate.getTime()) && curDate <= enDate && daysCount <= 366) {
    const isoDate = `${curDate.getFullYear()}-${String(curDate.getMonth() + 1).padStart(2, '0')}-${String(curDate.getDate()).padStart(2, '0')}`;
    const shortDate = curDate.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
    chartDataMap[isoDate] = { fecha: shortDate, total: 0, cantidad: 0 };
    curDate.setDate(curDate.getDate() + 1);
    daysCount++;
  }

  ventasActivas.forEach(v => {
    const isoDate = getLocalIsoDate(v.fecha);
    if (chartDataMap[isoDate]) {
      chartDataMap[isoDate].total += Number(v.total) || 0;
      chartDataMap[isoDate].cantidad += 1;
    } else {
      const d = new Date(`${isoDate}T12:00:00`);
      if (!isNaN(d.getTime())) {
        chartDataMap[isoDate] = {
          fecha: d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }),
          total: Number(v.total) || 0,
          cantidad: 1
        };
      }
    }
  });

  const chartData = Object.keys(chartDataMap).sort().map(k => chartDataMap[k]);

  // Producto más vendido
  const ventasPorProducto: Record<string, { nombre: string; cantidad: number; codigo: string }> = {};
  ventasActivas.forEach(v => {
    v.items.forEach(item => {
      const cantidadVendida = Number(item.cantidad) || 1;
      const keyId = item.producto_id || item.nombre; // fallback a nombre si es un preparado sin id
      const prod = productos.find(p => p.id === item.producto_id);
      const codigo = prod ? prod.codigo : 'PREP'; // Código PREP para preparados sin id
      
      if (!ventasPorProducto[keyId]) {
        ventasPorProducto[keyId] = { nombre: item.nombre, cantidad: 0, codigo };
      }
      ventasPorProducto[keyId].cantidad += cantidadVendida;
    });
  });
  
  let productoMasVendido = { nombre: 'Ninguno', cantidad: 0, codigo: 'N/A' };
  Object.values(ventasPorProducto).forEach(p => {
    if (p.cantidad > productoMasVendido.cantidad) {
      productoMasVendido = p;
    }
  });

  // Vendedor estrella (más ventas en COP)
  const ventasPorVendedor: Record<string, { nombre: string; total: number; cantidad: number }> = {};
  ventasActivas.forEach(v => {
    if (!ventasPorVendedor[v.vendedor_id]) {
      ventasPorVendedor[v.vendedor_id] = { nombre: v.vendedor_nombre, total: 0, cantidad: 0 };
    }
    ventasPorVendedor[v.vendedor_id].total += Number(v.total) || 0;
    ventasPorVendedor[v.vendedor_id].cantidad += 1;
  });
  let vendedorEstrella = { nombre: 'Ninguno', total: 0, cantidad: 0 };
  Object.values(ventasPorVendedor).forEach(v => {
    if (v.total > vendedorEstrella.total) {
      vendedorEstrella = v;
    }
  });

  const exportReporte = () => {
    const headers = {
      rango: 'Rango de Fechas',
      total_facturado: 'Total Vendido (Contado + Crédito)',
      costos_ventas: 'Costo de Ventas (Mercancía Entregada)',
      inversion_inventario: 'Inversión en Inventario (Compras a Proveedores)',
      gastos: 'Gastos Operativos',
      ganancia: 'Ganancia Neta'
    };

    const data = [{
      rango: `${startDate} al ${endDate}`,
      total_facturado: totalFacturado,
      costos_ventas: costoVentas,
      inversion_inventario: costoTotalCompras,
      gastos: totalGastos,
      ganancia: gananciaTotal
    }];

    downloadCSV(data, `Reporte_Financiero_${startDate}_al_${endDate}`, headers);
  };

  return (
    <Layout
      title="Panel de Control"
      subtitle={`Bienvenido — Mostrando datos desde ${startDate} hasta ${endDate}`}
      action={
        <Button variant="secondary" onClick={exportReporte} icon={<FileDown size={14} />}>
          Exportar Excel
        </Button>
      }
    >
      {/* Date Filter */}
      <div className="flex flex-col sm:flex-row items-center gap-3 mb-6 bg-white p-3 rounded-xl border border-zinc-200 w-full sm:w-max shadow-sm">
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          <label className="text-xs font-semibold text-zinc-500">Desde</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm border-none bg-zinc-50 px-2 py-1 rounded outline-none focus:ring-2 focus:ring-amber-500/50 flex-1 sm:flex-none text-right sm:text-left" />
        </div>
        <div className="text-zinc-300 hidden sm:block">-</div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          <label className="text-xs font-semibold text-zinc-500">Hasta</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm border-none bg-zinc-50 px-2 py-1 rounded outline-none focus:ring-2 focus:ring-amber-500/50 flex-1 sm:flex-none text-right sm:text-left" />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5 mb-8">
        <KpiCard
          title="Ventas Totales"
          value={formatCurrency(totalFacturado)}
          subtitle={`Completadas ${formatCurrency(totalCompletadas)} · Crédito ${formatCurrency(totalACredito)}`}
          icon={<TrendingUp size={22} className="text-amber-600 animate-pulse" />}
          color="bg-amber-50"
          delayClass="animate-fade-in-up"
        />
        <KpiCard
          title="Costo de Ventas"
          value={formatCurrency(costoVentas)}
          subtitle={`Catálogo ${formatCurrency(catalogo.costo)} · Insumos ${formatCurrency(preparados.costo)}`}
          icon={<ShoppingCart size={22} className="text-amber-600" />}
          color="bg-amber-50"
          delayClass="animate-fade-in-up animation-delay-100"
        />
        <KpiCard
          title="Ganancia Neta"
          value={formatCurrency(gananciaTotal)}
          subtitle={gananciaTotal < 0 ? 'Pérdidas' : 'Facturado - Costos - Gastos'}
          icon={<Award size={22} className={gananciaTotal < 0 ? 'text-red-600' : 'text-emerald-600'} />}
          color={gananciaTotal < 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50'}
          delayClass="animate-fade-in-up animation-delay-200"
        />
        <KpiCard
          title="Por Cobrar (Crédito)"
          value={formatCurrency(totalCreditoPendiente)}
          subtitle={`${clientesConDeuda.length} cliente(s) con deuda`}
          icon={<Wallet size={22} className="text-blue-600" />}
          color="bg-blue-50"
          delayClass="animate-fade-in-up animation-delay-300"
        />
        <KpiCard
          title="Inv. en Inventario"
          value={formatCurrency(costoTotalCompras)}
          subtitle={
            `Productos ${formatCurrency(comprasPorTipo.productos)} · Insumos ${formatCurrency(comprasPorTipo.materiasPrimas)}` +
            (Math.abs(comprasPorTipo.sinDetalle) > 1 ? ` · Sin detalle ${formatCurrency(comprasPorTipo.sinDetalle)}` : '')
          }
          icon={<Package size={22} className="text-purple-600" />}
          color="bg-purple-50"
          delayClass="animate-fade-in-up animation-delay-300"
        />
        <KpiCard
          title="Stock Crítico"
          value={totalStockBajo}
          subtitle={totalStockBajo > 0 ? `${productosStockBajo.length} producto(s) · ${materiasPrimasStockBajo.length} insumo(s)` : "Inventario óptimo"}
          icon={
            <div className="relative">
              <AlertTriangle size={22} className={totalStockBajo > 0 ? "text-red-600" : "text-amber-600"} />
              {totalStockBajo > 0 && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
            </div>
          }
          color={totalStockBajo > 0 ? "bg-red-50/80 border border-red-100" : "bg-amber-50"}
          delayClass="animate-fade-in-up animation-delay-300"
        />
      </div>

      {/* Estado de cobro de las ventas */}
      <div className="bg-white rounded-xl border border-zinc-200 p-6 shadow-sm mb-6">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-800">Estado de Cobro</h2>
          <span className="text-xs text-zinc-400">Ventas del período seleccionado</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">Completadas</span>
              <span className="text-[10px] text-emerald-600 font-semibold">{ventasCompletadas.length} factura(s)</span>
            </div>
            <p className="text-2xl font-extrabold text-emerald-700 font-mono mt-1">{formatCurrency(totalCompletadas)}</p>
            <p className="text-[11px] text-emerald-600 mt-1">
              Ya cobradas{contadoCompletadas > 0 ? ` · ${contadoCompletadas} de contado` : ''}
            </p>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">A Crédito · pendientes</span>
              <span className="text-[10px] text-amber-600 font-semibold">{ventasACredito.length} factura(s)</span>
            </div>
            <p className="text-2xl font-extrabold text-amber-700 font-mono mt-1">{formatCurrency(totalACredito)}</p>
            <div className="mt-2 pt-2 border-t border-amber-200/70 space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-500">Ya abonado</span>
                <span className="font-mono font-semibold text-emerald-600">{formatCurrency(abonadoPendientes)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-zinc-600 font-semibold">Falta por cobrar</span>
                <span className="font-mono font-bold text-red-600">{formatCurrency(saldoPorCobrar)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {descuentos.total > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-6 shadow-sm mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-zinc-800">Descuentos Otorgados</h2>
            <span className="text-xs text-zinc-400">Rebajas aplicadas sobre el precio de venta</span>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-2xl font-extrabold text-emerald-700 font-mono">{formatCurrency(descuentos.total)}</p>
                <p className="text-[11px] text-emerald-600 mt-0.5">
                  en {descuentos.ventas} venta{descuentos.ventas === 1 ? '' : 's'} · ya descontado de la facturación
                </p>
              </div>
              <div className="text-right space-y-0.5">
                {[...descuentos.porMotivo.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([motivo, monto]) => (
                    <div key={motivo} className="flex items-baseline justify-end gap-2">
                      <span className="text-[11px] text-zinc-500 capitalize">{motivo}</span>
                      <span className="text-[11px] font-mono font-semibold text-zinc-700 w-20 text-right">{formatCurrency(monto)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {obsequios.unidades > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-6 shadow-sm mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold text-zinc-800">Obsequios Entregados</h2>
            <span className="text-xs text-zinc-400">Productos que salieron sin cobrarse</span>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 flex items-center justify-between">
            <div>
              <p className="text-2xl font-extrabold text-emerald-700 font-mono">{obsequios.unidades}</p>
              <p className="text-[11px] text-emerald-600 mt-0.5">unidad(es) obsequiada(s)</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Costo que representan</p>
              <p className="text-xl font-extrabold text-zinc-700 font-mono mt-0.5">{formatCurrency(obsequios.costo)}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">ya descontado de la ganancia</p>
            </div>
          </div>
        </div>
      )}

      {/* Desglose por naturaleza del negocio */}
      <div className="bg-white rounded-xl border border-zinc-200 p-6 shadow-sm mb-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-base font-semibold text-zinc-800">Resultado por Naturaleza</h2>
          <span className="text-xs text-zinc-400">Reventa de catálogo frente a fabricación propia</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="py-2 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider"></th>
                <th className="py-2 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wider">Productos de Catálogo</th>
                <th className="py-2 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wider">Perfumes Preparados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              <tr>
                <td className="py-2.5 text-zinc-500 text-xs font-semibold uppercase">Vendido</td>
                <td className="py-2.5 text-right font-mono font-semibold text-zinc-800">{formatCurrency(catalogo.vendido)}</td>
                <td className="py-2.5 text-right font-mono font-semibold text-zinc-800">{formatCurrency(preparados.vendido)}</td>
              </tr>
              <tr>
                <td className="py-2.5 text-zinc-500 text-xs font-semibold uppercase">Costo</td>
                <td className="py-2.5 text-right font-mono text-zinc-600">{formatCurrency(catalogo.costo)}</td>
                <td className="py-2.5 text-right font-mono text-zinc-600">{formatCurrency(preparados.costo)}</td>
              </tr>
              {obsequios.costo > 0 && (
                <tr>
                  <td className="py-1.5 pl-3 text-zinc-400 text-[11px]">· de eso, obsequios</td>
                  <td className="py-1.5 text-right font-mono text-[11px] text-emerald-600">{formatCurrency(obsequios.costo)}</td>
                  <td className="py-1.5 text-right font-mono text-[11px] text-zinc-300">—</td>
                </tr>
              )}
              {descuentos.total > 0 && (
                <tr>
                  <td className="py-1.5 text-zinc-400 text-[11px]">menos descuentos otorgados</td>
                  <td colSpan={2} className="py-1.5 text-right font-mono text-[11px] text-emerald-600">−{formatCurrency(descuentos.total)}</td>
                </tr>
              )}
              <tr className="bg-zinc-50/60">
                <td className="py-2.5 text-zinc-700 text-xs font-bold uppercase">Ganancia</td>
                {[catalogo, preparados].map((d, i) => {
                  const g = d.vendido - d.costo;
                  const margen = d.vendido > 0 ? (g / d.vendido) * 100 : 0;
                  return (
                    <td key={i} className="py-2.5 text-right">
                      <span className={`font-mono font-extrabold ${g < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {formatCurrency(g)}
                      </span>
                      <span className={`block text-[10px] font-semibold ${g < 0 ? 'text-red-400' : 'text-emerald-500'}`}>
                        {margen.toFixed(1)}% de margen
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        {insumosSinVerificar > 0 && (
          <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            El costo de los preparados aún está incompleto: {insumosSinVerificar} insumo(s) usados en recetas todavía
            no tienen su costo confirmado por una compra, así que por ahora no se suman. Cada compra que registres
            incorpora su insumo a este cálculo.
          </p>
        )}
      </div>

      {/* Sales Chart + Recent Sales */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-zinc-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-zinc-800">Ventas Diarias</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {startDate && startDate === endDate
                  ? formatFecha(startDate)
                  : `${startDate ? formatFecha(startDate) : 'Sin límite'} — ${endDate ? formatFecha(endDate) : 'Sin límite'}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-xs text-zinc-500">Ingresos (COP)</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c5a32a" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#c5a32a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={v => v === 0 ? '' : `${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="total" stroke="#c5a32a" strokeWidth={2.5} fill="url(#salesGrad)" dot={{ r: 4, fill: '#c5a32a', strokeWidth: 0 }} activeDot={{ r: 5, fill: '#c5a32a' }} />
              <Area type="monotone" dataKey="cantidad" stroke="transparent" fill="transparent" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Right Sidebar: Performance Leaders & Recent Sales */}
        <div className="bg-white rounded-xl border border-zinc-200 p-6 shadow-sm flex flex-col space-y-6">
          
          {/* Section 1: Performance Leaders */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-zinc-100">
              <Award size={16} className="text-amber-600 animate-pulse" />
              <h2 className="text-sm font-bold text-zinc-800">Líderes de Desempeño</h2>
            </div>
            
            <div className="space-y-3">
              {/* Top Seller */}
              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                  ★
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Vendedor Estrella</p>
                  <p className="text-xs font-bold text-zinc-800 truncate mt-0.5">{vendedorEstrella.nombre}</p>
                  <p className="text-[10px] text-zinc-400 font-medium">Facturado: {formatCurrency(vendedorEstrella.total)} · {vendedorEstrella.cantidad} ventas</p>
                </div>
              </div>

              {/* Most Sold Product */}
              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                  ⚡
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Producto Más Vendido</p>
                  <p className="text-xs font-bold text-zinc-800 truncate mt-0.5">{productoMasVendido.nombre}</p>
                  <p className="text-[10px] text-zinc-400 font-medium">{productoMasVendido.codigo} · {productoMasVendido.cantidad} unidades vendidas</p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Recent Sales */}
          <div className="space-y-3 flex-1">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <ShoppingCart size={15} className="text-zinc-400" />
                <h2 className="text-sm font-bold text-zinc-800">Ventas Recientes</h2>
              </div>
            </div>
            <div className="space-y-2.5">
              {ventasActivas.slice(0, 4).map(v => (
                <div key={v.id} className="flex items-start justify-between gap-3 pb-2.5 border-b border-zinc-100 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-zinc-800 truncate">{v.cliente_nombre}</p>
                    <p className="text-[10px] text-zinc-400 font-mono mt-0.5">{v.factura} · {formatFecha(v.fecha)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-zinc-800">{formatCurrency(v.total)}</p>
                    <Badge variant={v.estado} className="scale-90 mt-0.5" />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Bottom panels: Low Stock & Audit Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        
        {/* Low Stock Panel */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 flex flex-col">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                <AlertTriangle size={15} className="animate-pulse" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-800">Alertas de Inventario</h2>
                <p className="text-[10px] text-zinc-400">Productos críticos bajo el mínimo</p>
              </div>
            </div>
            {productosStockBajo.length > 0 && (
              <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                {productosStockBajo.length} producto(s)
              </span>
            )}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto max-h-75 pr-1">
            {productosStockBajo.length === 0 ? (
              <div className="py-12 text-center text-zinc-400 text-xs">
                <p className="font-medium text-emerald-600">✓ Todos los stocks están en niveles óptimos</p>
              </div>
            ) : productosStockBajo.map(p => {
              const porcentaje = p.stock_minimo > 0 ? Math.min((p.stock / p.stock_minimo) * 100, 100) : 100;
              const esCritico = p.stock === 0;

              return (
                <div key={p.id} className="p-3.5 rounded-xl border border-zinc-100 bg-zinc-50/50 hover:bg-white hover:shadow-xs transition-all duration-200">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <span className="font-semibold text-zinc-800 text-xs truncate max-w-42.5">{p.nombre}</span>
                    <Badge variant={esCritico ? 'inactivo' : 'stock_bajo'} className="scale-90" />
                  </div>
                  <div className="space-y-1.5 text-[10px] text-zinc-500">
                    <div className="flex justify-between">
                      <span>Stock: <strong>{p.stock}</strong> / Mínimo: {p.stock_minimo}</span>
                      <span>{porcentaje.toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${porcentaje}%` }}
                        className={`h-full rounded-full ${esCritico ? 'bg-red-500' : 'bg-amber-500'}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Audit Log Panel */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 flex flex-col">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Activity size={15} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-800">Bitácora de Auditoría</h2>
                <p className="text-[10px] text-zinc-400">Historial reciente de actividades</p>
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto max-h-75 pr-1">
            {logs.slice(0, 6).map(log => (
              <div key={log.id} className="p-3 rounded-lg bg-zinc-50/50 border border-zinc-100 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-bold text-zinc-700 truncate">{log.usuario_nombre} ({log.rol})</span>
                    <span className="text-[9px] text-zinc-400 shrink-0">{log.fecha}</span>
                  </div>
                  <p className="text-xs text-zinc-600 leading-normal">{log.accion}</p>
                  <span className="inline-block text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-100/50 px-1.5 py-0.2 rounded-md mt-1 uppercase tracking-wider">
                    {log.modulo}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Layout>
  );
}
