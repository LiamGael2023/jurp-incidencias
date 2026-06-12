import { useState } from 'react';
import './Login.css';

function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); 
    setError(null);     
    setIsLoading(true); 

    const datosLogin = {
      username: username,
      password: password
    };

    try {
      const respuesta = await fetch('/api/v1/mobile/auth/login/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datosLogin)
      });

      const resultado = await respuesta.json();

      if (respuesta.ok) {
        const token = resultado.token || resultado.key || resultado.auth_token;
        
        if(token) {
            // 1. Guardamos el token
            localStorage.setItem('userToken', token);
            // 2. GUARDAMOS EL NOMBRE DE USUARIO
            localStorage.setItem('userName', username); 
            
            // 3. Le pasamos AMBOS datos a App.jsx
            onLoginSuccess(token, username);
        } else {
            setError('Error de servidor: No se recibió un token válido.');
        }

      } else {
        setError(resultado.non_field_errors || resultado.detail || 'Usuario o contraseña incorrectos.');
      }
    } catch (err) {
      console.error('Error de red:', err);
      setError('Error de conexión. Intente nuevamente más tarde.');
    } finally {
      setIsLoading(false); 
    }
  };

  return (
    <div className="login-completo">
      <div className="login-formulario-seccion">
        <img 
          src="http://jriegopresurizado.org.pe/wp-content/uploads/2022/03/logo1.png" 
          alt="Logo J Riego Presurizado" 
          className="login-logo"
        />
        <div className="login-titulo">Sistema de Monitoreo</div>

        <form className="formulario" onSubmit={handleSubmit}>
          <div className="input-grupo">
            <label htmlFor="username">Usuario</label>
            <input 
              type="text" 
              id="username"
              className="input-formulario"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ingrese su usuario"
              required 
              disabled={isLoading}
            />
          </div>

          <div className="input-grupo">
            <label htmlFor="password">Contraseña</label>
            <input 
              type="password" 
              id="password"
              className="input-formulario"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Ingrese su contraseña"
              required
              disabled={isLoading}
            />
          </div>

          <button type="submit" className="boton-login" disabled={isLoading}>
            {isLoading ? 'Verificando...' : 'INICIAR SESIÓN'}
          </button>

          {error && <div className="error-mensaje">{error}</div>}
        </form>
      </div>
      <div className="login-imagen-portada"></div>
    </div>
  );
}

export default Login;