import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { dashboardService } from '../services/api';
import { parseFechaLocal } from '../utils/filtros';
import '../styles/Dashboards.css';

export function DashboardsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newDashboardName, setNewDashboardName] = useState('');
  const [newDashboardStartDate, setNewDashboardStartDate] = useState('');
  const [newDashboardEndDate, setNewDashboardEndDate] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    const loadDashboards = async () => {
      try {
        setLoading(true);
        const data = await dashboardService.getDashboards(user.id);
        setDashboards(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadDashboards();
  }, [user.id]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newDashboardName.trim()) return;

    try {
      const newDashboard = await dashboardService.createDashboard(
        newDashboardName,
        user.id,
        newDashboardStartDate || null,
        newDashboardEndDate || null
      );
      setDashboards([...dashboards, newDashboard]);
      setNewDashboardName('');
      setNewDashboardStartDate('');
      setNewDashboardEndDate('');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (dashboardId) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este dashboard?')) return;

    try {
      await dashboardService.deleteDashboard(dashboardId);
      setDashboards(dashboards.filter(d => d.id !== dashboardId));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEdit = async (dashboardId) => {
    if (!editName.trim()) return;

    try {
      const dashboardActual = dashboards.find(d => d.id === dashboardId);
      await dashboardService.updateDashboard(
        dashboardId,
        editName,
        dashboardActual?.fecha_inicio || null,
        dashboardActual?.fecha_fin || null
      );
      setDashboards(dashboards.map(d =>
        d.id === dashboardId ? { ...d, nombre: editName } : d
      ));
      setEditingId(null);
      setEditName('');
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (dashboard) => {
    setEditingId(dashboard.id);
    setEditName(dashboard.nombre);
  };

  const handleDashboardClick = (dashboardId) => {
    navigate(`/dashboards/${dashboardId}`);
  };

  return (
    <div className="dashboards-container">
      <header className="dashboards-header">
        <div>
          <h1>Mis Dashboards</h1>
          <p>Bienvenido, {user?.nombre}</p>
        </div>
        <button onClick={logout} className="logout-btn">Cerrar Sesión</button>
      </header>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleCreate} className="create-dashboard-form">
        <input
          type="text"
          placeholder="Nombre del nuevo dashboard"
          value={newDashboardName}
          onChange={(e) => setNewDashboardName(e.target.value)}
        />
        <input
          type="date"
          value={newDashboardStartDate}
          onChange={(e) => setNewDashboardStartDate(e.target.value)}
          placeholder="Fecha inicio"
        />
        <input
          type="date"
          value={newDashboardEndDate}
          onChange={(e) => setNewDashboardEndDate(e.target.value)}
          placeholder="Fecha fin"
        />
        <button type="submit">Crear Dashboard</button>
      </form>

      {loading ? (
        <div className="loading">Cargando dashboards...</div>
      ) : dashboards.length === 0 ? (
        <div className="empty-state">
          <p>No tienes dashboards aún. ¡Crea uno para comenzar!</p>
        </div>
      ) : (
        <div className="dashboards-grid">
          {dashboards.map(dashboard => (
            <div key={dashboard.id} className="dashboard-card">
              {editingId === dashboard.id ? (
                <div className="edit-mode">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                  />
                  <div className="edit-actions">
                    <button onClick={() => handleEdit(dashboard.id)} className="save-btn">Guardar</button>
                    <button onClick={() => setEditingId(null)} className="cancel-btn">Cancelar</button>
                  </div>
                </div>
              ) : (
                <>
                  <h3 onClick={() => handleDashboardClick(dashboard.id)} className="dashboard-title">
                    {dashboard.nombre}
                  </h3>
                  <p className="dashboard-date">
                    Creado: {new Date(dashboard.created_at).toLocaleDateString()}
                  </p>
                  {dashboard.fecha_inicio && dashboard.fecha_fin && (
                    <p className="dashboard-range">
                      Rango: {parseFechaLocal(dashboard.fecha_inicio)?.toLocaleDateString()} - {parseFechaLocal(dashboard.fecha_fin)?.toLocaleDateString()}
                    </p>
                  )}
                  <div className="dashboard-actions">
                    <button 
                      onClick={() => handleDashboardClick(dashboard.id)} 
                      className="open-btn"
                    >
                      Abrir
                    </button>
                    <button 
                      onClick={() => startEdit(dashboard)} 
                      className="edit-btn"
                    >
                      Editar
                    </button>
                    <button 
                      onClick={() => handleDelete(dashboard.id)} 
                      className="delete-btn"
                    >
                      Eliminar
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
