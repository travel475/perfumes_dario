import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Pencil, Trash2, Search, Mail, Phone, MapPin, Building2, User, Eye, Calendar, Banknote, Link } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AlertBox } from '../components/ui/AlertBox';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import type { Cliente, TipoCliente } from '../types';

const EMPTY: any = {
  nombre: '', documento: '', tipo: 'persona', email: '', telefono: '', 
  ciudad: '', direccion: '', limite_credito: '', credito_usado: '', fecha_registro: new Date().toISOString().split('T')[0]
};

const FILTROS_CREDITO = [
  { valor: 'todos' as const, etiqueta: 'Todos' },
  { valor: 'con_deuda' as const, etiqueta: 'Con deuda' },
  { valor: 'al_dia' as const, etiqueta: 'Al día' },
  { valor: 'sin_credito' as const, etiqueta: 'Sin crédito' },
];

export function Clientes() {
  const { clientes, ventas, abonos, addCliente, updateCliente, deleteCliente, addAbono } = useAppData();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [filterCredito, setFilterCredito] = useState<'todos' | 'con_deuda' | 'al_dia' | 'sin_credito'>('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<Cliente | null>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [deleteConfirm, setDeleteConfirm] = useState<Cliente | null>(null);
  const [detailItem, setDetailItem] = useState<Cliente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 8;
  
  // Abonos
  const [abonoModalOpen, setAbonoModalOpen] = useState(false);
  const [abonoClient, setAbonoClient] = useState<Cliente | null>(null);
  const [abonoForm, setAbonoForm] = useState<{ monto: number, metodo_pago: 'efectivo'|'transferencia'|'tarjeta', notas: string }>({
    monto: 0, metodo_pago: 'efectivo', notas: ''
  });

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

  const formatNumberWithDots = (value: number | undefined) => {
    if (value === undefined || value === null) return '0';
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };

  const handlePriceChange = (field: 'limite_credito' | 'credito_usado', rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '');
    const numericValue = digits === '' ? '' : parseInt(digits, 10);
    setForm((f: any) => ({ ...f, [field]: numericValue }));
  };

  // Para un cliente el "estado" relevante es su situación de crédito, que es lo que se
  // consulta a diario: a quién hay que cobrarle y quién está al día.
  const filtered = useMemo(() =>
    clientes.filter(c => {
      const texto = search.toLowerCase();
      const coincideTexto =
        (c.nombre || '').toLowerCase().includes(texto) ||
        (c.email || '').toLowerCase().includes(texto) ||
        (c.ciudad || '').toLowerCase().includes(texto) ||
        (c.documento || '').includes(search);
      if (!coincideTexto) return false;

      const deuda = Number(c.credito_usado) || 0;
      const limite = Number(c.limite_credito) || 0;
      if (filterCredito === 'con_deuda') return deuda > 0;
      if (filterCredito === 'al_dia') return deuda === 0 && limite > 0;
      if (filterCredito === 'sin_credito') return limite === 0;
      return true;
    }), [clientes, search, filterCredito]
  );

  const ultimosAbonosMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!Array.isArray(abonos)) return map;
    const sorted = [...abonos].sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
    for (const a of sorted) {
      if (a.cliente_id) {
        map[a.cliente_id] = a.fecha;
      }
    }
    return map;
  }, [abonos]);

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

  const openCreate = () => { setEditItem(null); setForm(EMPTY); setError(null); setCurrentPage(1); setModalOpen(true); };
  const openEdit = (c: Cliente) => { setEditItem(c); setForm({ ...c }); setError(null); setCurrentPage(1); setModalOpen(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validar nombre único
    const nombreExiste = clientes.some(c => c.nombre.trim().toLowerCase() === form.nombre.trim().toLowerCase() && (!editItem || c.id !== editItem.id));
    if (nombreExiste) {
      setError(`Ya existe un cliente registrado con el nombre "${form.nombre}".`);
      return;
    }

    // Validar documento único, solo si se escribió uno: puede haber varios clientes sin documento.
    const documentoIngresado = (form.documento || '').trim();
    if (documentoIngresado) {
      const docExiste = clientes.some(c => (c.documento || '').trim() === documentoIngresado && (!editItem || c.id !== editItem.id));
      if (docExiste) {
        setError(`El documento o NIT "${documentoIngresado}" ya está registrado a nombre de otro cliente.`);
        return;
      }
    }

    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (form.email && !emailRegex.test(form.email.trim())) {
      setError("Por favor ingresa un correo electrónico válido.");
      return;
    }

    // Validar teléfono solo si se escribió uno
    const telDigitos = (form.telefono || '').replace(/\s+/g, '');
    if (telDigitos && !/^\+?\d+$/.test(telDigitos)) {
      setError("El número de teléfono debe contener únicamente dígitos numéricos.");
      return;
    }

    // Validar límite de crédito
    const limite = form.limite_credito === '' ? 0 : Number(form.limite_credito);
    const deuda = form.credito_usado === '' ? 0 : Number(form.credito_usado);
    if (deuda > limite && limite > 0) {
      setError(`La deuda actual (${formatCurrency(deuda)}) no puede ser mayor que el límite de crédito asignado (${formatCurrency(limite)}).`);
      return;
    }

    const payload = {
      ...form,
      limite_credito: limite,
      credito_usado: deuda
    };

    const uName = user?.name || 'Usuario';
    const uRole = user?.role || 'admin';
    if (editItem) {
      // La deuda se deriva de las ventas a crédito y los abonos: al editar no se envía,
      // porque cualquier cambio de datos de contacto la sobrescribía con el valor del formulario.
      const { credito_usado: _omitido, ...sinDeuda } = payload;
      updateCliente({ ...sinDeuda, id: editItem.id } as any, uName, uRole);
      setSuccessToast('¡Cliente actualizado con éxito!');
    } else {
      addCliente(payload, uName, uRole);
      setSuccessToast('¡Cliente registrado con éxito!');
    }
    setModalOpen(false);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  const handleAbonoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!abonoClient) return;

    if (abonoForm.monto <= 0) {
      setError("El monto a abonar debe ser mayor a cero.");
      return;
    }
    const deuda = abonoClient.credito_usado || 0;
    if (abonoForm.monto > deuda) {
      setError(`No puedes abonar más de la deuda actual (${formatCurrency(deuda)}).`);
      return;
    }

    addAbono({
      cliente_id: abonoClient.id,
      cliente_nombre: abonoClient.nombre,
      fecha: new Date().toISOString(),
      monto: abonoForm.monto,
      metodo_pago: abonoForm.metodo_pago,
      notas: abonoForm.notas,
      registrado_por: user?.name || 'Usuario'
    }, user?.name || 'Usuario', user?.id || '', user?.role || 'admin');

    setSuccessToast('¡Abono registrado con éxito!');
    setAbonoModalOpen(false);
    setTimeout(() => setSuccessToast(null), 3000);
  };

  const openAbono = (c: Cliente) => {
    setAbonoClient(c);
    setAbonoForm({ monto: 0, metodo_pago: 'efectivo', notas: '' });
    setError(null);
    setAbonoModalOpen(true);
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-colors bg-white';
  const field = (label: string, children: React.ReactNode) => (
    <div>
      <label className="block text-xs font-semibold text-zinc-600 mb-1.5">{label}</label>
      {children}
    </div>
  );

  return (
    <Layout
      title="Clientes"
      subtitle="Base de datos de clientes"
      action={
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Link size={16} />} onClick={() => {
            navigator.clipboard.writeText(window.location.origin + '/registro-cliente');
            setSuccessToast('Enlace de registro copiado al portapapeles');
            setTimeout(() => setSuccessToast(null), 3000);
          }}>Enlace Público</Button>
          <Button icon={<Plus size={16} />} onClick={openCreate}>Nuevo Cliente</Button>
        </div>
      }
    >
      {/* Search + filtro */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="relative w-full sm:max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
            placeholder="Buscar por nombre, documento, ciudad…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTROS_CREDITO.map(f => (
            <button
              key={f.valor}
              onClick={() => { setFilterCredito(f.valor); setCurrentPage(1); }}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                filterCredito === f.valor
                  ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
              }`}
            >
              {f.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* Table view & Mobile Cards */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        
        {/* Mobile Cards (Visible solo en pantallas pequeñas) */}
        <div className="md:hidden divide-y divide-zinc-100">
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <User size={32} className="mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-400 text-sm">No se encontraron clientes</p>
            </div>
          ) : paginated.map(c => {
            const fechaUltimoAbono = ultimosAbonosMap[c.id];
            const tieneCredito = (c.credito_usado || 0) > 0 || (c.limite_credito || 0) > 0;

            return (
              <div key={c.id} className="p-4 space-y-3 hover:bg-zinc-50/60 transition-colors">
                <div className="flex gap-3 items-start justify-between">
                  <div className="flex gap-3 items-center">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${c.tipo === 'empresa' ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-600'}`}>
                      {c.tipo === 'empresa' ? <Building2 size={16} /> : <User size={16} />}
                    </div>
                    <div>
                      <p className="font-bold text-zinc-800 text-sm leading-tight">{c.nombre}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{c.documento} · {c.ciudad}</p>
                    </div>
                  </div>
                  <button onClick={() => setDetailItem(c)} className="p-2 text-zinc-400 hover:text-amber-600 bg-zinc-50 rounded-lg">
                    <Eye size={16} />
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-2 bg-zinc-50 rounded-lg p-2.5 border border-zinc-100">
                  <div>
                    <span className="block text-[10px] text-zinc-400 uppercase font-bold">Deuda (Crédito)</span>
                    <span className={`font-bold text-sm ${c.credito_usado && c.credito_usado > 0 ? 'text-red-600' : 'text-zinc-600'}`}>
                      {c.credito_usado ? formatCurrency(c.credito_usado) : '$ 0'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-zinc-400 uppercase font-bold">Límite Crédito</span>
                    <span className="font-bold text-zinc-800 text-sm">
                      {c.limite_credito ? formatCurrency(c.limite_credito) : '$ 0'}
                    </span>
                  </div>
                  {tieneCredito && (
                    <div className="col-span-2 pt-2 border-t border-zinc-200/60 flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400 uppercase font-bold">Último Abono</span>
                      {fechaUltimoAbono ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <Calendar size={12} className="text-emerald-500" />
                          {new Date(fechaUltimoAbono).toLocaleDateString('es-CO')}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 italic font-normal">Sin abonos</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {(c.credito_usado || 0) > 0 && (
                    <button onClick={() => openAbono(c)} className="flex-1 py-2 flex items-center justify-center bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold transition-colors">
                      <Banknote size={14} className="mr-1.5" /> Abono
                    </button>
                  )}
                  <button onClick={() => openEdit(c)} className="flex-1 py-2 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-lg text-xs font-semibold transition-colors">
                    <Pencil size={14} className="mr-1.5" /> Editar
                  </button>
                  <button onClick={() => setDeleteConfirm(c)} className="px-3.5 py-2 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                {[
                  { label: 'Nombre / Razón Social', className: '' }, 
                  { label: 'Documento', className: 'hidden sm:table-cell' }, 
                  { label: 'Tipo', className: 'hidden md:table-cell' }, 
                  { label: 'Ciudad', className: 'hidden sm:table-cell' }, 
                  { label: 'Deuda (Crédito Usado)', className: '' }, 
                  { label: 'Último Abono', className: 'hidden lg:table-cell' },
                  { label: 'Límite de Crédito', className: 'hidden lg:table-cell' }, 
                  { label: 'Acciones', className: 'text-right' }
                ].map(h => (
                  <th key={h.label} className={`px-4 sm:px-5 py-3.5 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap ${h.className}`}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <User size={32} className="mx-auto text-zinc-300 mb-3" />
                    <p className="text-zinc-400 text-sm">No se encontraron clientes</p>
                  </td>
                </tr>
              ) : paginated.map(c => {
                const fechaUltimoAbono = ultimosAbonosMap[c.id];
                const tieneCredito = (c.credito_usado || 0) > 0 || (c.limite_credito || 0) > 0;

                return (
                  <tr key={c.id} className="hover:bg-zinc-50/60 transition-colors">
                    <td className="px-4 sm:px-5 py-3.5">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${c.tipo === 'empresa' ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-600'}`}>
                          {c.tipo === 'empresa' ? <Building2 size={14} /> : <User size={14} />}
                        </div>
                        <div className="min-w-0">
                          <span className="font-medium text-zinc-800 text-sm truncate max-w-30 sm:max-w-xs block">{c.nombre}</span>
                          <span className="text-[10px] sm:hidden text-zinc-500">{c.documento}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-5 py-3.5 font-mono text-xs text-zinc-500 hidden sm:table-cell">{c.documento}</td>
                    <td className="px-4 sm:px-5 py-3.5 hidden md:table-cell"><Badge variant={c.tipo} /></td>
                    <td className="px-4 sm:px-5 py-3.5 text-zinc-600 hidden sm:table-cell">{c.ciudad}</td>
                    <td className="px-4 sm:px-5 py-3.5">
                      {c.credito_usado && c.credito_usado > 0 ? (
                        <span className="font-semibold text-red-600 font-mono text-sm">
                          {formatCurrency(c.credito_usado)}
                        </span>
                      ) : (
                        <span className="text-zinc-450 font-mono text-sm">$ 0</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-5 py-3.5 hidden lg:table-cell whitespace-nowrap">
                      {tieneCredito ? (
                        fechaUltimoAbono ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200/60">
                            <Calendar size={12} className="text-emerald-600 shrink-0" />
                            {new Date(fechaUltimoAbono).toLocaleDateString('es-CO')}
                          </span>
                        ) : (
                          <span className="text-zinc-400 text-xs italic">Sin abonos</span>
                        )
                      ) : (
                        <span className="text-zinc-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 sm:px-5 py-3.5 font-mono text-zinc-600 hidden lg:table-cell">
                      {c.limite_credito ? formatCurrency(c.limite_credito) : '$ 0'}
                    </td>
                    <td className="px-4 sm:px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        {(c.credito_usado || 0) > 0 && (
                          <button onClick={() => openAbono(c)} className="p-1.5 rounded-lg hover:bg-emerald-50 text-zinc-400 hover:text-emerald-600 transition-colors cursor-pointer" title="Registrar Pago / Abono">
                            <Banknote size={16} />
                          </button>
                        )}
                        <button onClick={() => setDetailItem(c)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-amber-600 transition-colors cursor-pointer" title="Ver detalles">
                          <Eye size={16} />
                        </button>
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-amber-600 transition-colors cursor-pointer" title="Editar">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => setDeleteConfirm(c)} className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-600 transition-colors cursor-pointer" title="Eliminar">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3.5 border-t border-zinc-100 bg-zinc-50/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500 font-medium">
          <div>
            {filtered.length > 0 ? (
              <span>
                Mostrando <strong className="text-zinc-700">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> al <strong className="text-zinc-700">{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)}</strong> de <strong className="text-zinc-700">{filtered.length}</strong> clientes
              </span>
            ) : (
              <span>0 clientes encontrados</span>
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

      {/* Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'Editar Cliente' : 'Nuevo Cliente'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <AlertBox type="warning" title="Atención" className="mb-4">{error}</AlertBox>}
          {field('Nombre / Razón Social', <input required minLength={3} value={form.nombre} onChange={e => setForm((f: any) => ({ ...f, nombre: e.target.value }))} className={inp} />)}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Tipo', (
              <select value={form.tipo} onChange={e => setForm((f: any) => ({ ...f, tipo: e.target.value as TipoCliente }))} className={inp}>
                <option value="empresa">Empresa</option>
                <option value="persona">Persona Natural</option>
              </select>
            ))}
            {field('Documento (NIT / CC) — opcional', <input value={form.documento} onChange={e => setForm((f: any) => ({ ...f, documento: e.target.value }))} className={inp} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Email — opcional', <input type="email" value={form.email} onChange={e => setForm((f: any) => ({ ...f, email: e.target.value }))} className={inp} />)}
            {field('Teléfono — opcional', <input value={form.telefono} onChange={e => setForm((f: any) => ({ ...f, telefono: e.target.value }))} className={inp} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Ciudad — opcional', <input value={form.ciudad} onChange={e => setForm((f: any) => ({ ...f, ciudad: e.target.value }))} className={inp} />)}
            {field('Fecha de Registro', <input type="date" value={form.fecha_registro} onChange={e => setForm((f: any) => ({ ...f, fecha_registro: e.target.value }))} className={inp} />)}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('Límite de Crédito (COP)', <input value={formatNumberWithDots(form.limite_credito)} onChange={e => handlePriceChange('limite_credito', e.target.value)} className={inp} placeholder="0" />)}
            {editItem
              ? field('Crédito Usado / Deuda (COP)', (
                  <>
                    <input value={formatNumberWithDots(form.credito_usado)} readOnly disabled className={`${inp} bg-zinc-100 text-zinc-500 cursor-not-allowed`} />
                    <p className="text-[10px] text-zinc-400 mt-1">Se actualiza solo con las ventas a crédito y los abonos registrados.</p>
                  </>
                ))
              : field('Saldo Inicial / Deuda (COP)', (
                  <>
                    <input value={formatNumberWithDots(form.credito_usado)} onChange={e => handlePriceChange('credito_usado', e.target.value)} className={inp} placeholder="0" />
                    <p className="text-[10px] text-zinc-400 mt-1">Solo para cargar una deuda previa. Después se calcula automáticamente.</p>
                  </>
                ))}
          </div>
          {field('Dirección — opcional', <input value={form.direccion} onChange={e => setForm((f: any) => ({ ...f, direccion: e.target.value }))} className={inp} />)}
          <div className="flex justify-end gap-3 pt-2 border-t border-zinc-100">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button type="submit">{editItem ? 'Guardar' : 'Crear'}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Eliminar Cliente" size="sm">
        <AlertBox type="critical" title="Acción irreversible">
          ¿Eliminar a <strong>{deleteConfirm?.nombre}</strong>?
        </AlertBox>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-100">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { deleteCliente(deleteConfirm!.id, user?.name || 'Usuario', user?.role || 'admin'); setDeleteConfirm(null); }}>Eliminar</Button>
        </div>
      </Modal>

      {/* Abono Modal */}
      <Modal isOpen={abonoModalOpen} onClose={() => setAbonoModalOpen(false)} title="Registrar Pago / Abono" size="md">
        <form onSubmit={handleAbonoSubmit} className="space-y-4">
          {error && (
            <AlertBox type="critical" title="Error">
              {error}
            </AlertBox>
          )}
          <div className="bg-emerald-50 text-emerald-800 p-4 rounded-xl border border-emerald-100 flex items-center justify-between">
            <span className="text-sm font-semibold">Deuda Actual:</span>
            <span className="text-lg font-bold font-mono">{formatCurrency(abonoClient?.credito_usado || 0)}</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Monto a Abonar (COP)</label>
            <input 
              required
              value={formatNumberWithDots(abonoForm.monto)} 
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '');
                setAbonoForm(f => ({ ...f, monto: digits ? parseInt(digits, 10) : 0 }));
              }} 
              className={`${inp} text-lg font-bold text-zinc-800`} 
              placeholder="0" 
            />
          </div>

          {field('Método de Pago', (
            <select 
              value={abonoForm.metodo_pago} 
              onChange={e => setAbonoForm(f => ({ ...f, metodo_pago: e.target.value as any }))} 
              className={inp}
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia Bancaria</option>
              <option value="tarjeta">Tarjeta (Débito/Crédito)</option>
            </select>
          ))}

          {field('Notas (Opcional)', <textarea value={abonoForm.notas} onChange={e => setAbonoForm(f => ({ ...f, notas: e.target.value }))} className={inp} placeholder="Ref. de transferencia, etc." rows={2} />)}
          
          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
            <Button type="button" variant="secondary" onClick={() => setAbonoModalOpen(false)}>Cancelar</Button>
            <Button type="submit">Guardar Abono</Button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={!!detailItem} onClose={() => setDetailItem(null)} title="Detalles del Cliente" size="lg">
        {detailItem && (() => {
          const clientSales = ventas.filter(v => v.cliente_id === detailItem.id && v.estado === 'completada');
          const totalInverted = clientSales.reduce((sum, v) => sum + v.total, 0);
          const lastSale = clientSales.length > 0
            ? new Date(Math.max(...clientSales.map(v => new Date(v.fecha).getTime()))).toLocaleDateString('es-CO')
            : 'Ninguna';

          return (
            <div className="space-y-6 p-1">
              <div className="flex items-center gap-4 bg-zinc-50 p-4.5 rounded-2xl border border-zinc-200/60 shadow-inner">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${detailItem.tipo === 'empresa' ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-600'}`}>
                  {detailItem.tipo === 'empresa' ? <Building2 size={24} /> : <User size={24} />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-zinc-800 leading-tight">{detailItem.nombre}</h3>
                  <p className="text-xs font-mono text-zinc-400 mt-0.5">Doc: {detailItem.documento}</p>
                </div>
                <div className="ml-auto">
                  <Badge variant={detailItem.tipo} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="block text-[9px] uppercase font-bold text-zinc-400 tracking-wider">Dirección</span>
                  <div className="flex items-center gap-2 mt-1">
                    <MapPin size={13} className="text-zinc-400 shrink-0" />
                    <span className="text-sm font-semibold text-zinc-700">{detailItem.direccion}</span>
                  </div>
                </div>
                <div>
                  <span className="block text-[9px] uppercase font-bold text-zinc-400 tracking-wider">Ciudad</span>
                  <div className="flex items-center gap-2 mt-1">
                    <MapPin size={13} className="text-zinc-400 shrink-0" />
                    <span className="text-sm font-semibold text-zinc-700">{detailItem.ciudad}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="block text-[9px] uppercase font-bold text-zinc-400 tracking-wider">Teléfono</span>
                  <a href={`tel:${detailItem.telefono}`} className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-xl border border-zinc-100 hover:border-amber-200 hover:bg-amber-50/20 text-zinc-700 hover:text-amber-600 transition-all font-semibold text-xs w-fit">
                    <Phone size={13} className="shrink-0" />
                    {detailItem.telefono}
                  </a>
                </div>
                <div>
                  <span className="block text-[9px] uppercase font-bold text-zinc-400 tracking-wider">Correo Electrónico</span>
                  <a href={`mailto:${detailItem.email}`} className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-xl border border-zinc-100 hover:border-amber-200 hover:bg-amber-50/20 text-zinc-700 hover:text-amber-600 transition-all font-semibold text-xs w-fit">
                    <Mail size={13} className="shrink-0" />
                    {detailItem.email}
                  </a>
                </div>
              </div>

              {/* Línea de Crédito */}
              <div className="border-t border-zinc-100 pt-4">
                <span className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-2.5">Estado de la Línea de Crédito</span>
                {(() => {
                  const limit = detailItem.limite_credito || 0;
                  const used = detailItem.credito_usado || 0;
                  const available = Math.max(0, limit - used);
                  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-amber-500';

                  return (
                    <div className="space-y-3.5">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-2.5 bg-zinc-50 border border-zinc-100 rounded-xl">
                          <span className="block text-[8px] font-bold text-zinc-400 uppercase tracking-wider">Límite Permitido</span>
                          <p className="text-sm font-semibold text-zinc-700 mt-0.5 font-mono">{formatCurrency(limit)}</p>
                        </div>
                        <div className="p-2.5 bg-zinc-50 border border-zinc-100 rounded-xl">
                          <span className="block text-[8px] font-bold text-zinc-400 uppercase tracking-wider">Deuda Actual</span>
                          <p className={`text-sm font-bold mt-0.5 font-mono ${used > 0 ? 'text-red-600' : 'text-zinc-500'}`}>{formatCurrency(used)}</p>
                        </div>
                        <div className="p-2.5 bg-zinc-50 border border-zinc-100 rounded-xl">
                          <span className="block text-[8px] font-bold text-zinc-400 uppercase tracking-wider">Crédito Disponible</span>
                          <p className="text-sm font-semibold text-amber-600 mt-0.5 font-mono">{formatCurrency(available)}</p>
                        </div>
                      </div>

                      {limit > 0 && (
                        <div>
                          <div className="flex justify-between items-center text-[10px] font-semibold text-zinc-505 mb-1.5">
                            <span>Crédito Utilizado: {pct.toFixed(0)}%</span>
                            <span>{formatCurrency(used)} / {formatCurrency(limit)}</span>
                          </div>
                          <div className="w-full bg-zinc-150 h-2 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Estadísticas de Consumo (Métricas) */}
              <div className="border-t border-zinc-100 pt-4">
                <span className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-3">Métricas de Consumo</span>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-center">
                    <span className="block text-[8px] font-bold text-zinc-400 uppercase tracking-wider">Compras Realizadas</span>
                    <p className="text-lg font-extrabold text-zinc-700 mt-1 font-mono">{clientSales.length}</p>
                  </div>
                  <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-center">
                    <span className="block text-[8px] font-bold text-zinc-400 uppercase tracking-wider">Total Consumido</span>
                    <p className="text-sm font-bold text-amber-600 mt-1.5 font-mono">{formatCurrency(totalInverted)}</p>
                  </div>
                  <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-center">
                    <span className="block text-[8px] font-bold text-zinc-400 uppercase tracking-wider">Última Compra</span>
                    <p className="text-xs font-semibold text-zinc-600 mt-2">{lastSale}</p>
                  </div>
                </div>
              </div>

              {/* Historial de Compras (Ventas) */}
              <div className="border-t border-zinc-100 pt-4">
                <span className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-2.5">Historial de Facturas Emitidas</span>
                {(() => {
                  const allClientSales = ventas
                    .filter(v => v.cliente_id === detailItem.id)
                    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

                  if (allClientSales.length === 0) {
                    return <p className="text-xs text-zinc-400 italic">No se han registrado compras para este cliente.</p>;
                  }

                  return (
                    <div className="rounded-xl border border-zinc-200 overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-bold uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Factura</th>
                            <th className="py-2 px-3">Fecha</th>
                            <th className="py-2 px-3">Ítems</th>
                            <th className="py-2 px-3 text-right">Total</th>
                            <th className="py-2 px-3 text-center">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 text-zinc-600 bg-white">
                          {allClientSales.map(v => (
                            <tr key={v.id} className="hover:bg-zinc-50/50">
                              <td className="py-2 px-3 font-mono font-bold text-amber-600">{v.factura}</td>
                              <td className="py-2 px-3">{new Date(v.fecha).toLocaleDateString('es-CO')}</td>
                              <td className="py-2 px-3">{v.items.length} productos</td>
                              <td className="py-2 px-3 text-right font-semibold font-mono">{formatCurrency(v.total)}</td>
                              <td className="py-2 px-3 text-center">
                                <Badge variant={v.estado} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
              {/* Historial de Abonos (Pagos) */}
              <div className="border-t border-zinc-100 pt-4">
                <span className="block text-[10px] uppercase font-bold text-zinc-400 tracking-wider mb-2.5">Historial de Pagos / Abonos</span>
                {(() => {
                  const clientAbonos = abonos
                    .filter(a => a.cliente_id === detailItem.id)
                    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

                  if (clientAbonos.length === 0) {
                    return <p className="text-xs text-zinc-400 italic">No se han registrado abonos para este cliente.</p>;
                  }

                  return (
                    <div className="rounded-xl border border-zinc-200 overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-bold uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Fecha</th>
                            <th className="py-2 px-3">Método</th>
                            <th className="py-2 px-3 text-right">Monto</th>
                            <th className="py-2 px-3">Cajero</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 text-zinc-600 bg-white">
                          {clientAbonos.map(a => (
                            <tr key={a.id} className="hover:bg-zinc-50/50">
                              <td className="py-2 px-3">{new Date(a.fecha).toLocaleDateString('es-CO')} {new Date(a.fecha).toLocaleTimeString('es-CO', {hour: '2-digit', minute:'2-digit'})}</td>
                              <td className="py-2 px-3 capitalize">{a.metodo_pago}</td>
                              <td className="py-2 px-3 text-right font-semibold font-mono text-emerald-600">+{formatCurrency(a.monto)}</td>
                              <td className="py-2 px-3">{a.registrado_por}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}
        <div className="flex justify-end gap-3 mt-6 pt-3 border-t border-zinc-100">
          <Button variant="secondary" onClick={() => setDetailItem(null)}>Cerrar</Button>
        </div>
      </Modal>

      {/* Toast Animado */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl shadow-emerald-600/10 border border-emerald-500/20 animate-slide-in-right">
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center animate-bounce-short">
            <svg className="w-3.5 h-3.5 text-white stroke-[3.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-sm font-semibold tracking-wide">{successToast}</span>
        </div>
      )}
    </Layout>
  );
}
