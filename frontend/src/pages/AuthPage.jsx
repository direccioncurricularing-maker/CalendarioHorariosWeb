import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import '../styles/Auth.css';

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    nombre: '',
    mail: '',
    password: '',
    confirmPassword: '',
    adminPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, login } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(formData.mail, formData.password);
      } else {
        if (formData.password !== formData.confirmPassword) {
          setError('Las contraseñas no coinciden');
          setLoading(false);
          return;
        }

        await register(formData.nombre, formData.mail, formData.password, formData.adminPassword);
      }
      navigate('/dashboards');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError('');
    setFormData({
      nombre: '',
      mail: '',
      password: '',
      confirmPassword: '',
      adminPassword: ''
    });
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1>{isLogin ? 'Iniciar Sesion' : 'Registrarse'}</h1>
        
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <input
              type="text"
              name="nombre"
              placeholder="Nombre completo"
              value={formData.nombre}
              onChange={handleChange}
              required
            />
          )}

          <input
            type="email"
            name="mail"
            placeholder="Correo electrónico"
            value={formData.mail}
            onChange={handleChange}
            required
          />
          
          <input
            type="password"
            name="password"
            placeholder="Contraseña"
            value={formData.password}
            onChange={handleChange}
            required
          />

          {!isLogin && (
            <input
              type="password"
              name="confirmPassword"
              placeholder="Confirmar contraseña"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
            />
          )}

          {!isLogin && (
            <input
              type="password"
              name="adminPassword"
              placeholder="Clave admin"
              value={formData.adminPassword}
              onChange={handleChange}
              required
            />
          )}
          
          <button type="submit" disabled={loading}>
            {loading ? 'Cargando...' : (isLogin ? 'Iniciar Sesion' : 'Registrarse')}
          </button>
        </form>

        <p className="toggle-mode">
          {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          <button type="button" onClick={toggleMode} className="link-button">
            {isLogin ? 'Registrate' : 'Inicia sesion'}
          </button>
        </p>
      </div>
    </div>
  );
}
