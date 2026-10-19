import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, addDoc, getDoc, getDocs, deleteDoc, writeBatch, onSnapshot, query, where, orderBy, limit, documentId } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "LLAVE_API_DE_TU_PROYECTO",
  authDomain: "sabip-1953c.firebaseapp.com",
  projectId: "sabip-1953c",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ------------------------------------------------
// ESTADO GLOBAL
// ------------------------------------------------
let usuarioActual = null;
let rolActual = null;
let rutas = [];                   // [{ id: "Ruta_32", nombre: "Ruta 32" }] cargadas desde Firestore
let rutaAdminSeleccionada = null; // { id, nombre }
let unsubscribeAbordajes = null;
let unsubscribeRegistro = null;
let intervaloMedianoche = null;
let monitoreoToken = 0;           // invalida cargas de monitoreo que quedaron a medias
let direccionesParadas = {};      // { "Salida 1": "Punto, Calle, Municipio" } de la ruta elegida al asignar usuarios
let paradasAdmin = [];            // [{ id, nombre, direccion }] de la ruta abierta en Administrar Rutas
let modoEliminarParadas = false;  // true = cada parada muestra su botón de eliminar

const DIAS_SIN_ASISTENCIA_PARA_ELIMINAR = 14; // "2 semanas"

// ------------------------------------------------
// UTILIDADES
// ------------------------------------------------
const $ = (id) => document.getElementById(id);

// El ID de una ruta es su nombre con guiones bajos ("Ruta 32" -> "Ruta_32").
// Es el mismo valor que manda el ESP32 en el campo route del log.
const normalizarRuta = (s) => String(s || "").trim().replace(/\s+/g, "_");
const nombreDesdeId = (id) => String(id).replace(/_/g, " ");
// Los usuarios guardados antes del cambio tienen route: "Ruta 32" (con espacio).
// Con esto se siguen encontrando sin necesidad de migrarlos.
const variantesRuta = (id) => [...new Set([id, nombreDesdeId(id)])];

const pad = (n) => String(n).padStart(2, '0');
const fechaLocalISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function esc(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const views = document.querySelectorAll('.view');
const btnVolver = document.querySelectorAll('.btn-volver');

function cambiarVista(vistaId) {
    views.forEach(v => v.classList.remove('active-view'));
    $(vistaId).classList.add('active-view');
}

function detenerMonitoreo() {
    monitoreoToken++;
    if (unsubscribeAbordajes) { unsubscribeAbordajes(); unsubscribeAbordajes = null; }
    if (intervaloMedianoche) { clearInterval(intervaloMedianoche); intervaloMedianoche = null; }
}

function detenerRegistro() {
    if (unsubscribeRegistro) { unsubscribeRegistro(); unsubscribeRegistro = null; }
}

btnVolver.forEach(btn => {
    btn.addEventListener('click', (e) => {
        detenerMonitoreo();
        detenerRegistro();
        cambiarVista(e.currentTarget.dataset.target);
    });
});

// ------------------------------------------------
// RUTAS (fuente única: colección control_rutas)
// ------------------------------------------------
async function cargarRutas() {
    const snap = await getDocs(collection(db, "control_rutas"));
    rutas = snap.docs
        .map(d => ({ id: d.id, nombre: d.data().nombre || nombreDesdeId(d.id) }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
    renderRutas();
}

function llenarSelectRutas(selectId, placeholder) {
    const sel = $(selectId);
    const previo = sel.value;
    sel.innerHTML = '';
    sel.add(new Option(placeholder, ''));
    rutas.forEach(r => sel.add(new Option(r.nombre, r.id)));
    if (rutas.some(r => r.id === previo)) sel.value = previo;
}

function crearBotonRuta(ruta, onClick) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = ruta.nombre;
    btn.addEventListener('click', onClick);
    return btn;
}

function renderRutas() {
    // Administrar rutas -> elegir ruta para añadirle paradas
    const contAdmin = $('contenedor-rutas-admin');
    contAdmin.innerHTML = '';
    if (rutas.length === 0) {
        contAdmin.innerHTML = '<div class="sin-pasajeros">No hay rutas registradas. Usa "Añadir ruta".</div>';
    }
    rutas.forEach(r => {
        contAdmin.appendChild(crearBotonRuta(r, () => abrirDetalleRuta(r)));
    });

    // Monitoreo -> elegir ruta antes de ver nada
    const contMon = $('contenedor-rutas-monitoreo');
    contMon.innerHTML = '';
    if (rutas.length === 0) {
        contMon.innerHTML = '<div class="sin-pasajeros">No hay rutas registradas.</div>';
    }
    rutas.forEach(r => {
        contMon.appendChild(crearBotonRuta(r, () => {
            cambiarVista('view-monitoreo');
            iniciarMonitoreo(r);
        }));
    });

    // Selects de otras vistas
    llenarSelectRutas('select-ruta', 'Selecciona una ruta...');
    llenarSelectRutas('select-ruta-reporte', 'Selecciona una ruta...');
    llenarSelectRutas('select-ruta-eliminar', 'Selecciona una ruta...');
}

// ------------------------------------------------
// LOGIN / SESIÓN
// ------------------------------------------------
$('btn-login').addEventListener('click', async () => {
    const email = $('input-email').value;
    const pass = $('input-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        alert("Error al iniciar sesión. Verifica tus credenciales.");
        console.error(error);
    }
});

$('btn-logout').addEventListener('click', () => {
    detenerMonitoreo();
    detenerRegistro();
    signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        usuarioActual = user;
        const docRef = doc(db, "usuarios_roles", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            rolActual = docSnap.data().rol;
            $('user-role-display').innerText = `${rolActual.toUpperCase()}`;

            const btnRutas = $('btn-menu-rutas');
            const btnUsuarios = $('btn-menu-usuarios');
            const btnReportes = $('btn-menu-reportes');

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

            try {
                await cargarRutas();
            } catch (e) {
                console.error("Error al cargar las rutas", e);
            }
            cambiarVista('view-menu');
        } else {
            alert("Tu usuario no tiene un rol asignado en la base de datos.");
            signOut(auth);
        }
    } else {
        usuarioActual = null;
        rolActual = null;
        rutas = [];
        detenerMonitoreo();
        detenerRegistro();
        cambiarVista('view-login');
    }
});

// ------------------------------------------------
// NAVEGACIÓN DEL MENÚ
// (se refresca la lista de rutas por si otro coordinador hizo cambios)
// ------------------------------------------------
$('btn-menu-rutas').addEventListener('click', () => {
    cambiarVista('view-rutas-lista');
    cargarRutas().catch(console.error);
});

$('btn-menu-usuarios').addEventListener('click', () => {
    cambiarVista('view-usuarios');
    cargarRutas().catch(console.error);
    $('select-ruta').value = "";
    $('select-parada').innerHTML = '<option value="">Selecciona primero una ruta</option>';
    direccionesParadas = {};
    $('direccion-parada-seleccionada').textContent = "";
});

// Monitoreo: primero se elige la ruta, el monitoreo se abre al seleccionarla
$('btn-menu-monitorear').addEventListener('click', () => {
    cambiarVista('view-monitoreo-seleccion');
    cargarRutas().catch(console.error);
});

$('btn-menu-reportes').addEventListener('click', () => {
    cambiarVista('view-reportes');
    cargarRutas().catch(console.error);
    $('lista-reportes').innerHTML = ''; // Limpiar reportes previos
});

// ------------------------------------------------
// ADMINISTRAR RUTAS: AÑADIR
// ------------------------------------------------
$('btn-ruta-anadir').addEventListener('click', () => {
    $('input-nombre-ruta').value = "";
    cambiarVista('view-ruta-nueva');
});

$('btn-guardar-ruta').addEventListener('click', async () => {
    const nombre = $('input-nombre-ruta').value.trim().replace(/\s+/g, " ");
    if (!nombre) return alert("Escribe el nombre de la ruta.");
    if (!/^[\p{L}\p{N} _-]+$/u.test(nombre)) {
        return alert("El nombre solo puede tener letras, números, espacios, guiones y guiones bajos.");
    }

    const id = normalizarRuta(nombre);
    if (rutas.some(r => r.id.toLowerCase() === id.toLowerCase())) {
        return alert(`Ya existe una ruta llamada "${nombre}".`);
    }

    const btn = $('btn-guardar-ruta');
    btn.disabled = true;
    try {
        const ref = doc(db, "control_rutas", id);
        const existente = await getDoc(ref);
        if (existente.exists()) {
            await cargarRutas();
            return alert(`Ya existe una ruta llamada "${nombre}".`);
        }

        await setDoc(ref, { nombre: nombre, creada: new Date() });
        await cargarRutas();
        alert(`Ruta "${nombre}" creada.\n\nRecuerda: el ESP32 de esta ruta debe enviar route = "${id}".`);
        cambiarVista('view-rutas-lista');
    } catch (e) {
        console.error("Error al crear ruta: ", e);
        alert("Hubo un error al guardar la ruta en la base de datos.");
    } finally {
        btn.disabled = false;
    }
});

// ------------------------------------------------
// ADMINISTRAR RUTAS: ELIMINAR
// Solo si la ruta no tiene abordajes en las últimas 2 semanas
// ------------------------------------------------
$('btn-ruta-eliminar').addEventListener('click', () => {
    $('resultado-eliminar-ruta').innerHTML = '';
    $('select-ruta-eliminar').value = "";
    cambiarVista('view-ruta-eliminar');
});

$('btn-confirmar-eliminar-ruta').addEventListener('click', async () => {
    const id = $('select-ruta-eliminar').value;
    const resultado = $('resultado-eliminar-ruta');
    resultado.innerHTML = '';
    if (!id) return alert("Selecciona la ruta que quieres eliminar.");

    const ruta = rutas.find(r => r.id === id);
    const nombre = ruta ? ruta.nombre : nombreDesdeId(id);

    const btn = $('btn-confirmar-eliminar-ruta');
    btn.disabled = true;
    try {
        // 1. Abordajes de los últimos 14 días (el ID del log es "YYYY-MM-DD HH:MM:SS")
        const limiteFecha = new Date();
        limiteFecha.setDate(limiteFecha.getDate() - DIAS_SIN_ASISTENCIA_PARA_ELIMINAR);
        const desde = `${fechaLocalISO(limiteFecha)} 00:00:00`;

        const snapLog = await getDocs(query(collection(db, "log"), where(documentId(), ">=", desde)));
        const recientes = snapLog.docs
            .filter(d => normalizarRuta(d.data().route) === id)
            .map(d => d.id)
            .sort();

        if (recientes.length > 0) {
            const ultimo = recientes[recientes.length - 1];
            resultado.innerHTML = `
                <div class="aviso-error">
                    No se puede eliminar <strong>${esc(nombre)}</strong>: tiene ${recientes.length}
                    abordaje(s) registrado(s) en las últimas 2 semanas.<br>
                    Último abordaje: <strong>${esc(ultimo)}</strong>
                </div>`;
            return;
        }

        // 2. Paradas y pasajeros asociados, para avisar antes de borrar
        const snapParadas = await getDocs(collection(db, "control_rutas", id, "puntos_parada"));
        const snapUsers = await getDocs(query(collection(db, "users"), where("route", "in", variantesRuta(id))));

        let aviso = `¿Eliminar "${nombre}"?\n\nSe borrarán la ruta y sus ${snapParadas.size} parada(s).`;
        if (snapUsers.size > 0) {
            aviso += `\n\nHay ${snapUsers.size} pasajero(s) asignado(s) a esta ruta. No se borran, pero quedarán asignados a una ruta que ya no existe.`;
        }
        if (!confirm(aviso)) return;

        // 3. Borrar paradas y la ruta
        const batch = writeBatch(db);
        snapParadas.forEach(p => batch.delete(p.ref));
        batch.delete(doc(db, "control_rutas", id));
        await batch.commit();

        await cargarRutas();
        $('select-ruta-eliminar').value = "";
        alert(`Ruta "${nombre}" eliminada.`);
        cambiarVista('view-rutas-lista');
    } catch (e) {
        console.error("Error al eliminar ruta: ", e);
        resultado.innerHTML = '<div class="aviso-error">Ocurrió un error al eliminar la ruta. Intenta de nuevo.</div>';
    } finally {
        btn.disabled = false;
    }
});

// ------------------------------------------------
// ADMINISTRAR RUTAS: DETALLE DE RUTA (lista de paradas)
// ------------------------------------------------
function abrirDetalleRuta(ruta) {
    rutaAdminSeleccionada = ruta;
    modoEliminarParadas = false;
    paradasAdmin = [];
    $('titulo-ruta-detalle').textContent = ruta.nombre;
    $('lbl-ruta-actual').textContent = ruta.nombre;
    cambiarVista('view-ruta-detalle');
    cargarParadasAdmin();
}

async function cargarParadasAdmin() {
    const ruta = rutaAdminSeleccionada;
    if (!ruta) return;
    const cont = $('lista-paradas-admin');
    cont.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Cargando paradas...</p>';

    try {
        const snap = await getDocs(collection(db, "control_rutas", ruta.id, "puntos_parada"));
        // Si el usuario cambió de ruta mientras cargaba, no dibujamos nada
        if (rutaAdminSeleccionada !== ruta) return;

        paradasAdmin = snap.docs
            .map(d => ({ id: d.id, nombre: d.data().nombre || "", direccion: d.data().direccion || "" }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
        renderParadasAdmin();
    } catch (e) {
        console.error("Error al cargar las paradas:", e);
        if (rutaAdminSeleccionada === ruta) {
            cont.innerHTML = '<div class="aviso-error">No se pudieron cargar las paradas de esta ruta.</div>';
        }
    }
}

function renderParadasAdmin() {
    const cont = $('lista-paradas-admin');
    cont.innerHTML = '';

    const btnEliminar = $('btn-parada-eliminar');
    btnEliminar.textContent = modoEliminarParadas ? '✔ Terminar de eliminar' : '🗑 Eliminar paradas';
    btnEliminar.classList.toggle('btn-secondary', modoEliminarParadas);
    btnEliminar.classList.toggle('btn-danger', !modoEliminarParadas);

    if (paradasAdmin.length === 0) {
        cont.innerHTML = '<div class="sin-pasajeros">Esta ruta aún no tiene paradas registradas. Usa "Añadir parada".</div>';
        return;
    }

    paradasAdmin.forEach(p => {
        const card = document.createElement('div');
        card.className = 'card';

        const fila = document.createElement('div');
        fila.className = 'user-name';
        const nombre = document.createElement('span');
        nombre.textContent = p.nombre;
        fila.appendChild(nombre);

        if (modoEliminarParadas) {
            const btn = document.createElement('button');
            btn.className = 'btn-eliminar-parada';
            btn.textContent = 'Eliminar';
            btn.addEventListener('click', () => eliminarParada(p, btn));
            fila.appendChild(btn);
        }

        const direccion = document.createElement('div');
        direccion.className = 'parada-card-direccion';
        direccion.textContent = p.direccion ? `📍 ${p.direccion}` : 'Sin dirección registrada';

        card.appendChild(fila);
        card.appendChild(direccion);
        cont.appendChild(card);
    });
}

$('btn-parada-anadir').addEventListener('click', () => {
    modoEliminarParadas = false;
    renderParadasAdmin();
    $('input-nombre-parada').value = "";
    $('input-direccion-parada').value = "";
    cambiarVista('view-rutas-form');
});

$('btn-parada-eliminar').addEventListener('click', () => {
    modoEliminarParadas = !modoEliminarParadas;
    renderParadasAdmin();
});

async function eliminarParada(parada, btn) {
    const ruta = rutaAdminSeleccionada;
    if (!ruta) return;

    btn.disabled = true;
    try {
        // Avisar si hay pasajeros asignados a esta parada (se guardan por nombre de parada)
        const snapUsers = await getDocs(query(collection(db, "users"), where("route", "in", variantesRuta(ruta.id))));
        const afectados = snapUsers.docs.filter(d => d.data().punto_parada === parada.nombre).length;

        let aviso = `¿Eliminar la parada "${parada.nombre}" de ${ruta.nombre}?`;
        if (afectados > 0) {
            aviso += `\n\nHay ${afectados} pasajero(s) asignado(s) a esta parada. No se borran, pero quedarán asignados a una parada que ya no existe.`;
        }
        if (!confirm(aviso)) return;

        await deleteDoc(doc(db, "control_rutas", ruta.id, "puntos_parada", parada.id));
        await cargarParadasAdmin();
    } catch (e) {
        console.error("Error al eliminar parada: ", e);
        alert("Hubo un error al eliminar la parada.");
    } finally {
        btn.disabled = false;
    }
}

// ------------------------------------------------
// ADMINISTRAR RUTAS: AÑADIR PARADA
// ------------------------------------------------
$('btn-guardar-parada').addEventListener('click', async () => {
    const nombre = $('input-nombre-parada').value.trim();
    const direccion = $('input-direccion-parada').value.trim();

    if (!nombre || !direccion) return alert("Por favor completa el nombre y la dirección.");
    if (!rutaAdminSeleccionada) return alert("Selecciona primero una ruta.");

    // Los pasajeros se vinculan a la parada por su nombre, así que no puede repetirse en la ruta
    if (paradasAdmin.some(p => p.nombre.toLowerCase() === nombre.toLowerCase())) {
        return alert(`Ya existe una parada llamada "${nombre}" en ${rutaAdminSeleccionada.nombre}.`);
    }

    try {
        await addDoc(collection(db, "control_rutas", rutaAdminSeleccionada.id, "puntos_parada"), {
            nombre: nombre,
            direccion: direccion
        });
        alert(`Punto de parada "${nombre}" guardado con éxito en ${rutaAdminSeleccionada.nombre}.`);
        $('input-nombre-parada').value = "";
        $('input-direccion-parada').value = "";
        cambiarVista('view-ruta-detalle');
        cargarParadasAdmin();
    } catch (e) {
        console.error("Error al guardar parada: ", e);
        alert("Hubo un error al guardar en la base de datos.");
    }
});

// ------------------------------------------------
// ASIGNAR USUARIOS
// ------------------------------------------------
$('select-ruta').addEventListener('change', async (e) => {
    const rutaEscogida = e.target.value; // ID de la ruta
    const comboParada = $('select-parada');
    direccionesParadas = {};
    $('direccion-parada-seleccionada').textContent = "";

    if (rutaEscogida) {
        comboParada.innerHTML = '<option value="">Cargando paradas...</option>';
        try {
            const querySnapshot = await getDocs(collection(db, "control_rutas", rutaEscogida, "puntos_parada"));
            comboParada.innerHTML = '';
            comboParada.add(new Option('Selecciona una parada', ''));
            querySnapshot.forEach((d) => {
                const { nombre, direccion } = d.data();
                direccionesParadas[nombre] = direccion || "";
                comboParada.add(new Option(nombre, nombre));
            });
        } catch (error) {
            console.error("Error al cargar paradas", error);
            comboParada.innerHTML = '<option value="">Error al cargar paradas</option>';
        }
    } else {
        comboParada.innerHTML = '<option value="">Selecciona primero una ruta</option>';
    }
});

// Al elegir una parada se muestra su dirección debajo del selector
$('select-parada').addEventListener('change', (e) => {
    const direccion = direccionesParadas[e.target.value];
    $('direccion-parada-seleccionada').textContent = direccion ? `📍 ${direccion}` : "";
});

// --- LÓGICA DE REGISTRO DE NUEVA HUELLA ---
$('btn-pedir-huella').addEventListener('click', async () => {
    alert("Pon el ESP32 en modo registro (botón del dispositivo) y coloca el dedo en el sensor. Esperando lectura...");
    $('input-huella-id').value = "Esperando lectura del ESP32...";

    // Escuchamos SOLAMENTE las huellas que lleguen a partir de este momento
    const now = new Date();
    const q = query(
        collection(db, "nuevas_huellas"),
        where("timestamp", ">=", now),
        orderBy("timestamp", "desc"),
        limit(1)
    );

    detenerRegistro();
    unsubscribeRegistro = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            // Solo reaccionamos si se agregó un nuevo documento
            if (change.type === "added") {
                const data = change.doc.data();
                if (data.user_id) {
                    $('input-huella-id').value = data.user_id;
                    alert("¡Huella detectada exitosamente!");
                }
            }
        });
    });
});

$('btn-guardar-usuario').addEventListener('click', async () => {
    const huellaId = $('input-huella-id').value;
    const nombre = $('input-nombre').value.trim();
    const nomina = $('input-nomina').value.trim();
    const ruta = $('select-ruta').value; // ID de la ruta (ej. "Ruta_32")
    const parada = $('select-parada').value;

    if (!huellaId || huellaId === "Esperando lectura del ESP32...") return alert("Falta ingresar la huella desde el ESP32.");
    if (!nombre || !nomina || !ruta || !parada) return alert("Completa todos los campos y selecciones.");

    try {
        await setDoc(doc(db, "users", huellaId), {
            route: ruta,
            name: nombre,
            nomina: nomina,
            punto_parada: parada
        });

        const rutaInfo = rutas.find(r => r.id === ruta);
        alert(`Usuario ${nombre} vinculado exitosamente a ${rutaInfo ? rutaInfo.nombre : ruta}.`);
        $('input-huella-id').value = "";
        $('input-nombre').value = "";
        $('input-nomina').value = "";
        $('select-ruta').value = "";
        $('select-parada').innerHTML = '<option value="">Selecciona primero una ruta</option>';
        direccionesParadas = {};
        $('direccion-parada-seleccionada').textContent = "";

        detenerRegistro();
        cambiarVista('view-menu');
    } catch (e) {
        console.error("Error al guardar usuario: ", e);
        alert("Hubo un error al guardar al usuario.");
    }
});

// ------------------------------------------------
// MONITOREO DE UNA RUTA (solo abordajes del día de hoy)
// ------------------------------------------------
async function iniciarMonitoreo(ruta) {
    detenerMonitoreo();
    const token = monitoreoToken;
    const hoy = fechaLocalISO();

    $('titulo-monitoreo').textContent = `Monitoreo: ${ruta.nombre}`;
    $('subtitulo-monitoreo').textContent = `Abordajes del día ${hoy}`;

    const contenedor = $('lista-monitoreo');
    contenedor.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Descargando lista de pasajeros...</p>';

    try {
        // 1. Paradas oficiales de la ruta (se dibujan aunque estén vacías)
        const pasajerosPorParada = {};
        const direccionPorParada = {}; // nombre de parada -> dirección
        const snapParadas = await getDocs(collection(db, "control_rutas", ruta.id, "puntos_parada"));
        snapParadas.forEach(d => {
            const { nombre, direccion } = d.data();
            pasajerosPorParada[nombre] = [];
            direccionPorParada[nombre] = direccion || "";
        });

        // 2. Pasajeros de la ruta, acomodados en su parada
        const snapUsers = await getDocs(query(collection(db, "users"), where("route", "in", variantesRuta(ruta.id))));
        snapUsers.forEach(d => {
            const user = d.data();
            const parada = user.punto_parada || "Sin parada asignada";
            if (!pasajerosPorParada[parada]) pasajerosPorParada[parada] = [];
            pasajerosPorParada[parada].push({ id: d.id, ...user });
        });

        // Si el usuario salió de la pantalla mientras cargaba, no dibujamos nada
        if (token !== monitoreoToken) return;

        // 3. Dibujar bloques y pasajeros (todos inician como "Sin abordar")
        if (Object.keys(pasajerosPorParada).length === 0) {
            contenedor.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Esta ruta aún no tiene paradas ni pasajeros.</p>';
        } else {
            let html = '';
            for (const parada in pasajerosPorParada) {
                const direccion = direccionPorParada[parada];
                html += `<div class="parada-bloque">📍 Parada: ${esc(parada)}${direccion ? `<div class="parada-direccion">${esc(direccion)}</div>` : ''}</div>`;

                const pasajeros = pasajerosPorParada[parada]
                    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));

                if (pasajeros.length === 0) {
                    html += `<div class="sin-pasajeros">Sin pasajeros registrados en esta parada</div>`;
                } else {
                    pasajeros.forEach(p => {
                        html += `
                          <div class="card" id="card-${esc(p.id)}">
                            <div class="user-name">
                              ${esc(p.name)} (Nómina: ${esc(p.nomina)})
                              <span id="estado-${esc(p.id)}" class="estado sin-abordar">Sin abordar</span>
                            </div>
                            <div id="hora-${esc(p.id)}" class="date">Esperando validación biométrica...</div>
                          </div>
                        `;
                    });
                }
            }
            contenedor.innerHTML = html;
        }

        // 4. Escuchar SOLO los registros de hoy. El ID del documento es "YYYY-MM-DD HH:MM:SS",
        //    así que un rango de ID equivale a un rango de fecha. La ruta se filtra aquí en el
        //    cliente para no requerir un índice compuesto en Firestore.
        const qLog = query(
            collection(db, "log"),
            where(documentId(), ">=", `${hoy} 00:00:00`),
            where(documentId(), "<=", `${hoy} 23:59:59`)
        );

        const primerAbordaje = {}; // userId -> primera hora del día
        unsubscribeAbordajes = onSnapshot(qLog, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "removed") return;

                const data = change.doc.data();
                if (normalizarRuta(data.route) !== ruta.id) return;

                const userId = String(data.biometric_id);
                const hora = change.doc.id; // "YYYY-MM-DD HH:MM:SS" generado por el RTC

                // Si la persona escaneó varias veces, se queda con el primer abordaje del día
                if (primerAbordaje[userId] && primerAbordaje[userId] <= hora) return;
                primerAbordaje[userId] = hora;

                const spanEstado = $(`estado-${userId}`);
                const divHora = $(`hora-${userId}`);
                if (spanEstado) {
                    spanEstado.textContent = "✓ Abordó";
                    spanEstado.classList.remove("sin-abordar");
                    spanEstado.classList.add("abordo");
                    if (divHora) divHora.textContent = `Hora de abordaje (RTC): ${hora.split(" ")[1] || hora}`;
                }
            });
        }, (error) => {
            console.error("Error en la escucha de abordajes:", error);
        });

        // 5. Si la pantalla se queda abierta pasada la medianoche, se reinicia para el nuevo día
        intervaloMedianoche = setInterval(() => {
            if (fechaLocalISO() !== hoy) iniciarMonitoreo(ruta);
        }, 60000);

    } catch (e) {
        console.error("Error al iniciar el monitoreo:", e);
        if (token === monitoreoToken) {
            contenedor.innerHTML = '<div class="sin-pasajeros" style="color:var(--danger); border-color:var(--danger);">No se pudo cargar el monitoreo de esta ruta.</div>';
        }
    }
}

// ------------------------------------------------
// REPORTES DE ASISTENCIA
// ------------------------------------------------
$('btn-generar-reporte').addEventListener('click', async () => {
    const ruta = $('select-ruta-reporte').value; // ID de la ruta
    const fechaInicioStr = $('input-fecha-inicio').value;
    const fechaFinStr = $('input-fecha-fin').value;

    if (!ruta || !fechaInicioStr || !fechaFinStr) return alert("Completa todos los campos para generar el reporte.");

    // Parsear fechas de forma segura evitando problemas de zona horaria local
    const [anioInicio, mesInicio, diaInicio] = fechaInicioStr.split('-');
    const fechaInicio = new Date(anioInicio, mesInicio - 1, diaInicio);

    const [anioFin, mesFin, diaFin] = fechaFinStr.split('-');
    const fechaFin = new Date(anioFin, mesFin - 1, diaFin);

    if (fechaInicio > fechaFin) return alert("La fecha de inicio debe ser anterior o igual a la fecha de fin.");

    const contenedor = $('lista-reportes');
    contenedor.innerHTML = '<p style="color:var(--text-muted); font-size:14px;">Calculando inasistencias en base de datos...</p>';

    try {
        // 1. Obtener todos los días válidos en el rango (excluyendo domingos)
        const diasValidos = [];
        let fechaActual = new Date(fechaInicio);

        while (fechaActual <= fechaFin) {
            if (fechaActual.getDay() !== 0) { // 0 corresponde al domingo en JavaScript
                diasValidos.push(fechaLocalISO(fechaActual)); // Formato: YYYY-MM-DD
            }
            fechaActual.setDate(fechaActual.getDate() + 1);
        }

        if (diasValidos.length === 0) {
            contenedor.innerHTML = '<div class="sin-pasajeros">El rango seleccionado solo contiene domingos. Intenta otro rango.</div>';
            return;
        }

        // 2. Obtener lista de usuarios vinculados a la ruta seleccionada
        const qUsers = query(collection(db, "users"), where("route", "in", variantesRuta(ruta)));
        const snapUsers = await getDocs(qUsers);

        const usuarios = {};
        snapUsers.forEach(d => {
            const u = d.data();
            usuarios[d.id] = {
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

        // 3. Descargar solo el log del rango consultado (el ID del documento es la fecha y hora del RTC)
        const qLog = query(
            collection(db, "log"),
            where(documentId(), ">=", `${fechaInicioStr} 00:00:00`),
            where(documentId(), "<=", `${fechaFinStr} 23:59:59`)
        );
        const snapLog = await getDocs(qLog);

        snapLog.forEach(docLog => {
            const data = docLog.data();
            if (normalizarRuta(data.route) !== ruta) return;

            const fechaLog = docLog.id.split(" ")[0]; // Extraemos solo el "YYYY-MM-DD"
            const bioId = String(data.biometric_id);

            // Si el log ocurrió en un día válido y el usuario existe, registramos su asistencia
            if (diasValidos.includes(fechaLog) && usuarios[bioId]) {
                usuarios[bioId].asistenciasDetectadas.add(fechaLog);
            }
        });

        // 4. Calcular faltas cruzando los días laborables vs las asistencias del usuario
        let htmlResultado = '';
        for (const bioId in usuarios) {
            const u = usuarios[bioId];

            diasValidos.forEach(dia => {
                if (!u.asistenciasDetectadas.has(dia)) {
                    u.faltasTotales.push(dia);
                }
            });

            // 5. Construir y dibujar la tarjeta del usuario
            const colorBorde = u.faltasTotales.length > 0 ? 'var(--danger)' : 'var(--success)';
            const claseEstado = u.faltasTotales.length > 0 ? 'sin-abordar' : 'abordo';

            htmlResultado += `
                <div class="card" style="border-left: 5px solid ${colorBorde};">
                    <div class="user-name">
                        ${esc(u.nombre)} (Nómina: ${esc(u.nomina)})
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

    } catch (e) {
        console.error("Error al procesar el reporte:", e);
        contenedor.innerHTML = '<div class="sin-pasajeros" style="color:var(--danger); border-color:var(--danger);">Ocurrió un error al procesar la base de datos.</div>';
    }
});