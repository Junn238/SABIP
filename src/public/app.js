import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDoc, onSnapshot, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

// 1. REEMPLAZA ESTO CON LOS DATOS DE TU PROYECTO FIREBASE
// Son los mismos que pusiste en tu archivo .env para el Node.js
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Variables globales de estado
let usuarioActual = null;
let rolActual = null;
let modoActual = ""; 
let rutaSeleccionada = "";
let unsubscribeAbordajes = null;
let unsubscribeRegistro = null;
let diccionarioUsuarios = {}; // Para guardar temporalmente los nombres y no mostrar solo números

// --- LÓGICA DE NAVEGACIÓN ---
const views = document.querySelectorAll('.view');
const btnVolver = document.querySelectorAll('.btn-volver');

function cambiarVista(vistaId) {
    views.forEach(v => v.classList.remove('active-view'));
    document.getElementById(vistaId).classList.add('active-view');
}

btnVolver.forEach(btn => {
    btn.addEventListener('click', (e) => {
        cambiarVista(e.target.dataset.target);
        // Si salimos de monitoreo, detenemos la escucha en tiempo real para no gastar datos
        if (unsubscribeAbordajes) unsubscribeAbordajes();
        if (unsubscribeRegistro) unsubscribeRegistro();
    });
});

// --- AUTENTICACIÓN Y ROLES ---
document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('input-email').value;
    const pass = document.getElementById('input-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        alert("Error al iniciar sesión. Verifica tus credenciales.");
        console.error(error);
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    signOut(auth);
});

// Escuchador de sesión: detecta cuando entras o sales
onAuthStateChanged(auth, async (user) => {
    if (user) {
        usuarioActual = user;
        // Busca el rol del usuario en la colección "usuarios_roles"
        const docRef = doc(db, "usuarios_roles", user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            rolActual = docSnap.data().rol;
            document.getElementById('user-role-display').innerText = `Rol: ${rolActual.toUpperCase()}`;
            
            // Adaptar interfaz según rol
            const btnRegistrar = document.getElementById('btn-menu-registrar');
            const controlesRutas = document.getElementById('controles-rutas-admin');
            const btnActivarSensor = document.getElementById('btn-activar-sensor');
            
            if (rolActual === "coordinador") {
                btnRegistrar.style.display = "block";
                controlesRutas.style.display = "flex";
                btnActivarSensor.style.display = "block";
            } else {
                // Modo Monitor (solo lectura)
                btnRegistrar.style.display = "none";
                controlesRutas.style.display = "none";
                btnActivarSensor.style.display = "none";
            }
            cambiarVista('view-menu');
        } else {
            alert("Tu usuario no tiene un rol asignado en la base de datos.");
            signOut(auth);
        }
    } else {
        cambiarVista('view-login');
    }
});

// --- MENÚ PRINCIPAL ---
document.getElementById('btn-menu-monitorear').addEventListener('click', () => {
    modoActual = "monitoreo";
    document.getElementById('titulo-rutas').innerText = "Selecciona Ruta a Monitorear";
    cambiarVista('view-rutas');
});

document.getElementById('btn-menu-registrar').addEventListener('click', () => {
    modoActual = "registro";
    document.getElementById('titulo-rutas').innerText = "Selecciona Ruta para Asignar Usuario";
    cambiarVista('view-rutas');
});

// --- SELECCIÓN DE RUTAS ---
document.querySelectorAll('.ruta-item').forEach(item => {
    item.addEventListener('click', async (e) => {
        rutaSeleccionada = e.target.dataset.rutaId;
        const nombreRuta = e.target.innerText;
        
        if(modoActual === "monitoreo") {
            document.getElementById('titulo-registros-ruta').innerText = `Abordajes: ${nombreRuta}`;
            cambiarVista('view-registros');
            await cargarDiccionarioUsuarios(rutaSeleccionada);
            iniciarMonitoreoAbordajes(rutaSeleccionada);
        } else if (modoActual === "registro") {
            document.getElementById('lbl-ruta-registro').innerText = nombreRuta;
            cambiarVista('view-formulario-registro');
        }
    });
});

// --- MODO MONITOREO ---
// Primero descargamos los nombres de los usuarios de esta ruta
async function cargarDiccionarioUsuarios(rutaId) {
    diccionarioUsuarios = {};
    const qUsers = query(collection(db, "users"), where("route", "==", rutaId));
    // Podemos hacer fetch a tu propia API REST o usar Firebase directo (aquí usamos Firebase)
    onSnapshot(qUsers, (snapshot) => {
        snapshot.forEach(doc => {
            diccionarioUsuarios[doc.id] = doc.data().name;
        });
    });
}

function iniciarMonitoreoAbordajes(rutaId) {
    const lista = document.getElementById('lista-pasajeros');
    lista.innerHTML = '<p>Sincronizando con el ESP32...</p>';
    
    // Consulta a la colección "log" (donde tu Node.js guarda los datos)
    const qLog = query(collection(db, "log"), where("route", "==", rutaId));

    if(unsubscribeAbordajes) unsubscribeAbordajes();

    unsubscribeAbordajes = onSnapshot(qLog, (snapshot) => {
        lista.innerHTML = ''; 
        let registros = [];
        
        // Guardar en arreglo para poder ordenarlos por fecha (el ID del documento es la fecha)
        snapshot.forEach((documento) => {
            registros.push({
                fecha: documento.id, 
                biometric_id: documento.data().biometric_id
            });
        });

        // Ordenar del más reciente al más antiguo
        registros.sort((a, b) => b.fecha.localeCompare(a.fecha));

        if(registros.length === 0) lista.innerHTML = '<p>No hay abordajes registrados hoy.</p>';

        registros.forEach(data => {
            const nombreEmpleado = diccionarioUsuarios[data.biometric_id] || "Usuario Desconocido";
            lista.innerHTML += `
              <div class="card">
                <div class="user-id">${nombreEmpleado} (ID: ${data.biometric_id})</div>
                <div class="date">Hora de abordaje: ${data.fecha}</div>
              </div>
            `;
        });
    });
}

document.getElementById('btn-activar-sensor').addEventListener('click', async () => {
    // Le avisa al ESP32 que empiece a leer en modo normal
    await setDoc(doc(db, "control_rutas", "estado_actual"), {
      registro_activo: true,
      tipo_lectura: "abordaje" 
    });
    alert("Sensor activado para monitoreo.");
});

// --- MODO REGISTRO DE USUARIOS ---
document.getElementById('btn-pedir-huella').addEventListener('click', async () => {
    // 1. Le avisa al ESP32 (mediante Firestore) que está en modo "Enrolar"
    await setDoc(doc(db, "control_rutas", "estado_actual"), {
        registro_activo: true,
        tipo_lectura: "nueva_huella"
    });
    alert("Coloca el dedo en el sensor del ESP32...");
    document.getElementById('input-huella-id').value = "Esperando lectura...";

    // 2. Escuchar la colección "nuevas_huellas" donde el Node.js guardará el nuevo ID
    const q = query(collection(db, "nuevas_huellas"), orderBy("timestamp", "desc"), limit(1));
    
    if(unsubscribeRegistro) unsubscribeRegistro();
    
    unsubscribeRegistro = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
            const data = snapshot.docs[0].data();
            if(data.user_id) {
                document.getElementById('input-huella-id').value = data.user_id;
            }
        }
    });
});

document.getElementById('btn-guardar-usuario').addEventListener('click', async () => {
    const huellaId = document.getElementById('input-huella-id').value;
    const nombre = document.getElementById('input-nombre').value;
    const nomina = document.getElementById('input-nomina').value;

    if(!huellaId || huellaId === "Esperando lectura...") {
        alert("Falta ingresar la huella desde el dispositivo ESP32.");
        return;
    }
    if(!nombre || !nomina) {
        alert("Por favor completa el nombre y nómina.");
        return;
    }

    try {
        // Guarda al usuario en la colección "users" usando la misma estructura de tu backend Node.js
        await setDoc(doc(db, "users", huellaId), {
            route: rutaSeleccionada,
            name: nombre,
            nomina: nomina
        });
        
        alert(`Usuario ${nombre} vinculado a la huella ID: ${huellaId} exitosamente.`);
        
        // Limpiar formulario y volver
        document.getElementById('input-huella-id').value = "";
        document.getElementById('input-nombre').value = "";
        document.getElementById('input-nomina').value = "";
        
        if (unsubscribeRegistro) unsubscribeRegistro();
        cambiarVista('view-rutas'); 
    } catch (e) {
        console.error("Error al guardar usuario: ", e);
        alert("Hubo un error al guardar en la base de datos.");
    }
});