import { useState } from 'react';
import './Login.css';
import logo from './assets/logo1.png';
import portadaPortada from './assets/Portada-Pagina-Web-Julio.png';
import { marcarEntrada } from './sesion';

/*
 * CADA APP TIENE SU PROPIO PADRÓN DE USUARIOS, y no son el mismo.
 *
 * PLUVIRA nació con las cuentas del sistema de riego, en el servidor de
 * JURP. Para SENTRIA no nos dieron acceso a ese padrón, así que sus
 * vigilantes viven en una tabla aparte, la del backend de vigilancia.
 *
 * Por eso el login no puede tener una sola dirección: un vigilante que
 * escriba sus datos correctos recibiría un 401 si se le pregunta al
 * servidor equivocado, y el mensaje diría «usuario o contraseña
 * incorrectos» —que es mentira y manda a buscar el problema donde no está.
 *
 * `/api/` y `/vigapi/` son los dos reenvíos de vercel.json; cada uno sale a
 * un servidor distinto.
 */
const LOGIN_POR_APP = {
  pluvira: '/api/v1/mobile/auth/login/',
  sentria: '/vigapi/mobile/auth/login/',
};

function Login({ onLoginSuccess, app }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Sin `app` definida se usa el padrón de PLUVIRA, que es el histórico y el
  // que cubre a casi todo el mundo.
  const urlLogin = LOGIN_POR_APP[app] || LOGIN_POR_APP.pluvira;

  const handleSubmit = async (e) => {
    e.preventDefault(); 
    setError(null);     
    setIsLoading(true); 

    const datosLogin = {
      username: username,
      password: password,
      /* QUE ES LA WEB, Y POR QUE HAY QUE DECIRLO. En PLUVIRA cada cuenta
       * queda atada al celular desde el que entra, para que prestar la clave
       * no sirva. El navegador no tiene un identificador de equipo que valga
       * la pena enlazar, asi que va exento —pero el servidor solo exime a
       * quien dice 'web' de forma explicita: si la ausencia contara, la app
       * vieja, que tampoco manda plataforma, quedaria exenta tambien y el
       * bloqueo no morderia a nadie.
       *
       * Sin esta linea, el dia que se encienda el bloqueo la web deja de
       * entrar para todos. */
      plataforma: 'web',
    };

    try {
      const respuesta = await fetch(urlLogin, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(datosLogin)
      });

      const resultado = await respuesta.json();

      if (respuesta.ok) {
        const token = resultado.token || resultado.key || resultado.auth_token;
        
        if(token) {
            // 1. Guardamos el token
            localStorage.setItem('userToken', token);
            // Cuando empezo esta sesion. Si algun dia el servidor la
            // rechaza, el aviso puede decir cuanto llevaba abierta: si el
            // token caduca ese numero se repite, y si es el servidor que
            // falla a ratos sale cualquiera.
            marcarEntrada();
            // 2. GUARDAMOS EL NOMBRE DE USUARIO
            localStorage.setItem('userName', username); 
            // 3. GUARDAMOS LOS GRUPOS DEL USUARIO (para permisos, ej. subir reportes)
            const grupos = resultado.user?.groups || [];
            localStorage.setItem('userGroups', JSON.stringify(grupos));
            // 4. GUARDAMOS EL ID DEL USUARIO
            if (resultado.user?.id != null) {
              localStorage.setItem('userId', String(resultado.user.id));
            }
            /* 4b. SI ES ADMINISTRADOR, CUANDO EL SERVIDOR LO DIGA. Sirve
             * para no ofrecer en el menú pantallas que van a responder 403.
             * Se guardan tres estados y no dos: 'si', 'no', y la ausencia
             * —que es "el servidor no lo dijo"—. Tomar la ausencia por 'no'
             * esconderia el panel a los administradores de verdad si algún
             * día el login deja de mandar el campo; tomarla por 'si' deja
             * el menú como está hoy, que es lo malo conocido. */
            const adm = resultado.user?.is_staff ?? resultado.user?.is_superuser;
            if (adm === true || adm === false) {
              localStorage.setItem('userEsAdmin', adm ? 'si' : 'no');
            } else {
              localStorage.removeItem('userEsAdmin');
            }
            // 5. De qué padrón salió el token. Las pantallas que llaman a los
            //    dos servidores lo necesitan: el token de uno no vale en el
            //    otro, y sin esta marca no hay manera de saber cuál es cuál.
            localStorage.setItem('authOrigen', app === 'sentria' ? 'sentria' : 'pluvira');
            
            // 6. Le pasamos los datos a App.jsx
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
          src={logo}
          alt="Logo J Riego Presurizado" 
          className="login-logo"
        />
        <div className="login-titulo">
          {app === 'sentria' ? 'SENTRIA · Vigilancia' : 'Sistema de Monitoreo'}
        </div>

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
      <div className="login-imagen-contenedor">
        <img 
          src={portadaPortada} 
          alt="Portada" 
          className="login-imagen-portada" 
        />
      </div>
    </div>
  );
}

export default Login;