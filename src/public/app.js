import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, addDoc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBltq0ltBNY6ZvgiTlvOg0jMdaNBC9gcd8",
  authDomain: "sabip-1953c.firebaseapp.com",
  projectId: "sabip-1953c",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let usuarioActual = null;
let rolActual = null;
let rutaAdminSeleccionada = "";
let unsubscribeAbordajes = null;
let unsubscribeRegistro = null;

const views = document.querySelectorAll('.view');
const btnVolver = document.querySelectorAll('.btn-volver');

function cambiarVista(vistaId) {
    views.forEach(v => v.classList.remove('active-view'));
    document.getElementById(vistaId).classList.add('active-view');
}

btnVolver.forEach(btn => {
    btn.addEventListener('click', (e) => {
        cambiarVista(e.target.dataset.target);
        if (unsubscribeAbordajes) unsubscribeAbordajes();
        if (unsubscribeRegistro) unsubscribeRegistro();
    });
});

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

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
    if (user) {
        usuarioActual = user;
        const docRef = doc(db, "usuarios_roles", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            rolActual = docSnap.data().rol;
            document.getElementById('user-role-display').innerText = `${rolActual.toUpperCase()}`;

            const btnRutas = document.getElementById('btn-menu-rutas');
            const btnUsuarios = document.getElementById('btn-menu-usuarios');
            const btnReportes = document.getElementById('btn-menu-reportes');

            // Lógica de permisos por roles
            if (rolActual === "coordinador") {
                btnRutas.style.display = "block";
                btnUsuarios.style.display = "block";
                btnReportes.style.display = "block";
            } else if (rolActual === "monitor") {
                btnRutas.style.display = "none";
                btnUsuarios.style.display = "none";
                btnReportes.style.display = "block";
            } else {
                btnRutas.style.display = "none";
                btnUsuarios.style.display = "none";
                btnReportes.style.display = "none";
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

document.getElementById('btn-menu-rutas').addEventListener('click', () => cambiarVista('view-rutas-lista'));

document.getElementById('btn-menu-usuarios').addEventListener('click', () => {
    cambiarVista('view-usuarios');
    document.getElementById('select-ruta').value = "";
    document.getElementById('select-parada').innerHTML = '<option value="">Selecciona primero una ruta</option>';
});

document.getElementById('btn-menu-monitorear').addEventListener('click', () => {
    cambiarVista('view-monitoreo');
    iniciarMonitoreo();
});

document.getElementById('btn-menu-reportes').addEventListener('click', () => {
    cambiarVista('view-reportes');
    document.getElementById('lista-reportes').innerHTML = ''; // Limpiar reportes previos
});

document.querySelectorAll('.btn-ruta-admin').forEach(btn => {
    btn.addEventListener('click', (e) => {
        rutaAdminSeleccionada = e.target.dataset.ruta;
        document.getElementById('lbl-ruta-actual').innerText = rutaAdminSeleccionada;
        cambiarVista('view-rutas-form');
    });
});

document.getElementById('btn-guardar-parada').addEventListener('click', async () => {
    const nombre = document.getElementById('input-nombre-parada').value;
    const direccion = document.getElementById('input-direccion-parada').value;

    if(!nombre || !direccion) return alert("Por favor completa el nombre y la dirección.");

    try {
        const coleccionRuta = rutaAdminSeleccionada.replace(" ", "_");
        await addDoc(collection(db, "control_rutas", coleccionRuta, "puntos_parada"), {
            nombre: nombre,
            direccion: direccion
        });
        alert(`Punto de parada "${nombre}" guardado con éxito en ${rutaAdminSeleccionada}.`);
        document.getElementById('input-nombre-parada').value = "";
        document.getElementById('input-direccion-parada').value = "";
        cambiarVista('view-rutas-lista');
    } catch (e) {
        console.error("Error al guardar parada: ", e);
        alert("Hubo un error al guardar en la base de datos.");
    }
});

document.getElementById('select-ruta').addEventListener('change', async (e) => {
    const rutaEscogida = e.target.value;
    const comboParada = document.getElementById('select-parada');

    if(rutaEscogida) {
        comboParada.innerHTML = '<option value="">Cargando paradas...</option>';
        try {
            const coleccionRuta = rutaEscogida.replace(" ", "_");
            const querySnapshot = await getDocs(collection(db, "control_rutas", coleccionRuta, "puntos_parada"));
            comboParada.innerHTML = '<option value="">Selecciona una parada</option>';
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                comboParada.innerHTML += `<option value="${data.nombre}">${data.nombre}</option>`;
            });
        } catch (error) {
            console.error("Error al cargar paradas", error);
            comboParada.innerHTML = '<option value="">Error al cargar paradas</option>';
        }
    } else {
        comboParada.innerHTML = '<option value="">Selecciona primero una ruta</option>';
    }
});

// --- LÓGICA DE REGISTRO DE NUEVA HUELLA ---
document.getElementById('btn-pedir-huella').addEventListener('click', async () => {
    alert("Asegúrate de que el ESP32 esté en Modo 1 (Nuevo usuario) desde el monitor serie. Esperando lectura...");
    document.getElementById('input-huella-id').value = "Esperando lectura del ESP32...";

    // Obtenemos la fecha actual para escuchar SOLAMENTE las huellas que lleguen a partir de este momento
    const now = new Date();
    const q = query(
        collection(db, "nuevas_huellas"),
        where("timestamp", ">=", now),
        orderBy("timestamp", "desc"),
        limit(1)
    );

    if(unsubscribeRegistro) unsubscribeRegistro();
    unsubscribeRegistro = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            // Solo reaccionamos si se agregó un nuevo documento
            if (change.type === "added") {
                const data = change.doc.data();
                if(data.user_id) {
                    document.getElementById('input-huella-id').value = data.user_id;
                    alert("¡Huella detectada exitosamente!");
                }
            }
        });
    });
});

document.getElementById('btn-guardar-usuario').addEventListener('click', async () => {
    const huellaId = document.getElementById('input-huella-id').value;
    const nombre = document.getElementById('input-nombre').value;
    const nomina = document.getElementById('input-nomina').value;
    const ruta = document.getElementById('select-ruta').value;
    const parada = document.getElementById('select-parada').value;

    if(!huellaId || huellaId === "Esperando lectura del ESP32...") return alert("Falta ingresar la huella desde el ESP32.");
    if(!nombre || !nomina || !ruta || !parada) return alert("Completa todos los campos y selecciones.");

    try {
        await setDoc(doc(db, "users", huellaId), {
            route: ruta,
            name: nombre,
            nomina: nomina,
            punto_parada: parada
        });

        alert(`Usuario ${nombre} vinculado exitosamente a ${ruta}.`);
        document.getElementById('input-huella-id').value = "";
        document.getElementById('input-nombre').value = "";
        document.getElementById('input-nomina').value = "";
        document.getElementById('select-ruta').value = "";
        document.getElementById('select-parada').innerHTML = '<option value="">Selecciona primero una ruta</option>';

        if (unsubscribeRegistro) unsubscribeRegistro();
        cambiarVista('view-menu');
    } catch (e) {
        console.error("Error al guardar usuario: ", e);
        alert("Hubo un error al guardar al usuario.");
    }
});

// --- LÓGICA DE MONITOREO Y PASE DE LISTA AUTOMÁTICO ---
async function iniciarMonitoreo() {
    const contenedor = document.getElementById('lista-monitoreo');
    contenedor.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Descargando lista de pasajeros...</p>';

    // 1. Descargamos primero el catálogo oficial de paradas para dibujarlas aunque estén vacías
    const pasajerosPorParada = {};
    const qParadas = await getDocs(collection(db, "control_rutas", "Ruta_32", "puntos_parada"));
    qParadas.forEach(docSnap => {
        const nombreParada = docSnap.data().nombre;
        pasajerosPorParada[nombreParada] = [];
    });

    // 2. Obtenemos a los usuarios y los acomodamos en su parada correspondiente
    const qUsers = query(collection(db, "users"), where("route", "==", "Ruta 32"));
    const snapshotUsers = await getDocs(qUsers);

    snapshotUsers.forEach(docSnap => {
        const user = docSnap.data();
        const parada = user.punto_parada || "Sin parada asignada";
        if(!pasajerosPorParada[parada]) pasajerosPorParada[parada] = [];
        pasajerosPorParada[parada].push({ id: docSnap.id, ...user });
    });

    // 3. Dibujamos los bloques visuales y los pasajeros
    contenedor.innerHTML = '';
    if(Object.keys(pasajerosPorParada).length === 0) {
        contenedor.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">No hay paradas configuradas en esta ruta.</p>';
        return;
    }

    for (const parada in pasajerosPorParada) {
        // Imprime el bloque azul corporativo
        contenedor.innerHTML += `<div class="parada-bloque">📍 Parada: ${parada}</div>`;

        const pasajeros = pasajerosPorParada[parada];

        // Verifica si hay pasajeros en esa parada
        if (pasajeros.length === 0) {
            contenedor.innerHTML += `<div class="sin-pasajeros">Sin pasajeros registrados en esta parada</div>`;
        } else {
            pasajeros.forEach(p => {
                contenedor.innerHTML += `
                  <div class="card" id="card-${p.id}">
                    <div class="user-name">
                      ${p.name} (Nómina: ${p.nomina})
                      <span id="estado-${p.id}" class="estado sin-abordar">Sin abordar</span>
                    </div>
                    <div id="hora-${p.id}" class="date">Esperando validación biométrica...</div>
                  </div>
                `;
            });
        }
    }

    // 4. Escuchar el pase de lista proveniente del hardware ESP32 a través de Firebase en tiempo real
    const qLog = query(collection(db, "log"), where("route", "==", "Ruta 32"));
    if(unsubscribeAbordajes) unsubscribeAbordajes();

    unsubscribeAbordajes = onSnapshot(qLog, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added" || change.type === "modified") {
                const data = change.doc.data();
                const userId = data.biometric_id;
                const time = change.doc.id;

                const spanEstado = document.getElementById(`estado-${userId}`);
                const divHora = document.getElementById(`hora-${userId}`);

                if(spanEstado) {
                    spanEstado.textContent = "✓ Abordó";
                    spanEstado.classList.remove("sin-abordar");
                    spanEstado.classList.add("abordo");
                    // Modifica la hora utilizando la marca temporal provista por el RTC DS1307
                    if(divHora) divHora.textContent = `Hora de abordaje (RTC): ${time}`;
                }
            }
        });
    });
}

// --- LÓGICA DE REPORTES DE ASISTENCIA ---
document.getElementById('btn-generar-reporte').addEventListener('click', async () => {
    const ruta = document.getElementById('select-ruta-reporte').value;
    const fechaInicioStr = document.getElementById('input-fecha-inicio').value;
    const fechaFinStr = document.getElementById('input-fecha-fin').value;

    if(!ruta || !fechaInicioStr || !fechaFinStr) return alert("Completa todos los campos para generar el reporte.");

    // Parsear fechas de forma segura evitando problemas de zona horaria local
    const [anioInicio, mesInicio, diaInicio] = fechaInicioStr.split('-');
    const fechaInicio = new Date(anioInicio, mesInicio - 1, diaInicio);

    const [anioFin, mesFin, diaFin] = fechaFinStr.split('-');
    const fechaFin = new Date(anioFin, mesFin - 1, diaFin);

    if(fechaInicio > fechaFin) return alert("La fecha de inicio debe ser anterior o igual a la fecha de fin.");

    const contenedor = document.getElementById('lista-reportes');
    contenedor.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Calculando inasistencias en base de datos...</p>';

    try {
        // 1. Obtener todos los días válidos en el rango (excluyendo domingos)
        const diasValidos = [];
        let fechaActual = new Date(fechaInicio);

        while(fechaActual <= fechaFin) {
            if(fechaActual.getDay() !== 0) { // 0 corresponde al domingo en JavaScript
                const anio = fechaActual.getFullYear();
                const mes = String(fechaActual.getMonth() + 1).padStart(2, '0');
                const dia = String(fechaActual.getDate()).padStart(2, '0');
                diasValidos.push(`${anio}-${mes}-${dia}`); // Formato: YYYY-MM-DD
            }
            fechaActual.setDate(fechaActual.getDate() + 1);
        }

        if(diasValidos.length === 0) {
            contenedor.innerHTML = '<div class="sin-pasajeros">El rango seleccionado solo contiene domingos. Intenta otro rango.</div>';
            return;
        }

        // 2. Obtener lista de usuarios vinculados a la ruta seleccionada
        const qUsers = query(collection(db, "users"), where("route", "==", ruta));
        const snapUsers = await getDocs(qUsers);

        const usuarios = {};
        snapUsers.forEach(doc => {
            const u = doc.data();
            usuarios[doc.id] = {
                nombre: u.name,
                nomina: u.nomina,
                asistenciasDetectadas: new Set(),
                faltasTotales: []
            };
        });

        if (Object.keys(usuarios).length === 0) {
            contenedor.innerHTML = '<div class="sin-pasajeros">No hay pasajeros registrados en esta ruta.</div>';
            return;
        }

        // 3. Descargar el log de abordajes de esa ruta
        const qLog = query(collection(db, "log"), where("route", "==", ruta));
        const snapLog = await getDocs(qLog);

        snapLog.forEach(docLog => {
            // El ID del documento del log viene del ESP32 RTC, formato: "YYYY-MM-DD HH:MM:SS"
            const idDoc = docLog.id;
            const fechaLog = idDoc.split(" ")[0]; // Extraemos solo el "YYYY-MM-DD"
            const bioId = docLog.data().biometric_id;

            // Si el log ocurrió en un día válido y el usuario existe, registramos su asistencia
            if(diasValidos.includes(fechaLog) && usuarios[bioId]) {
                usuarios[bioId].asistenciasDetectadas.add(fechaLog);
            }
        });

        // 4. Calcular faltas cruzando los días laborables vs las asistencias del usuario
        let htmlResultado = '';
        for(const bioId in usuarios) {
            const u = usuarios[bioId];

            diasValidos.forEach(dia => {
                if(!u.asistenciasDetectadas.has(dia)) {
                    u.faltasTotales.push(dia);
                }
            });

            // 5. Construir y dibujar la tarjeta del usuario
            const colorBorde = u.faltasTotales.length > 0 ? 'var(--danger)' : 'var(--success)';
            const claseEstado = u.faltasTotales.length > 0 ? 'sin-abordar' : 'abordo';

            htmlResultado += `
                <div class="card" style="border-left: 5px solid ${colorBorde};">
                    <div class="user-name">
                        ${u.nombre} (Nómina: ${u.nomina})
                        <span class="estado ${claseEstado}">
                            Faltas: ${u.faltasTotales.length}
                        </span>
                    </div>
                    <div class="date" style="margin-top: 10px;">
                        ${u.faltasTotales.length > 0
                            ? `<strong>Días de inasistencia detectados:</strong><br>${u.faltasTotales.join(', ')}`
                            : `<em>Asistencia perfecta durante el periodo consultado.</em>`}
                    </div>
                </div>
            `;
        }

        contenedor.innerHTML = htmlResultado;

    } catch(e) {
        console.error("Error al procesar el reporte:", e);
        contenedor.innerHTML = '<div class="sin-pasajeros" style="color:var(--danger); border-color:var(--danger);">Ocurrió un error al procesar la base de datos.</div>';
    }
});
