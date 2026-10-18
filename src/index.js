import 'dotenv/config'
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, where, doc, setDoc, getDoc, getDocs, writeBatch } from "firebase/firestore/lite";
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuracion Firebase
const firebaseConfig = {
  apiKey: process.env.API_KEY,
  authDomain: process.env.AUTH_DOMAIN,
  projectId: process.env.PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  messagingSenderId: process.env.MSSG_SENDER_ID, // Corregido: "messagingSenderId" en lugar de "messasingSenderId"
  appId: process.env.APP_ID,
};

// Inicializacion de componentes necesarios
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const xpress = express();

xpress.use(express.json());

// ------------------------------------------------
// CONFIGURACIÓN PARA SERVIR LA PWA (FRONTEND)
// ------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sirve todos los archivos estáticos (index.html, app.js, css, etc.) desde la carpeta public
xpress.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------
// METODOS PARA EL ESP32
// ------------------------------------------------

// NUEVO MÉTODO GET: El ESP32 consulta este endpoint periódicamente para saber qué hacer
xpress.get('/api/status', async (req, res) => {
  try {
    const docRef = doc(db, "control_rutas", "estado_actual");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      // Devuelve { registro_activo: true/false, tipo_lectura: "abordaje" o "nueva_huella" }
      res.json(docSnap.data()); 
    } else {
      // Valor por defecto si el documento no existe en Firebase
      res.json({ registro_activo: false, tipo_lectura: "abordaje" });
    }
  } catch (e) {
    console.error("Error al obtener estado:", e);
    res.status(500).end();
  }
});

// NUEVO MÉTODO POST: Para cuando el ESP32 enrola una huella nueva
xpress.post('/api/enroll', async (req, res) => {
  const { biometric_id } = req.body;
  if (!biometric_id) return res.status(400).end();

  try {
    // Guarda temporalmente el ID de la huella recién creada
    // Se usa timestamp como ID del documento para ordenar cronológicamente
    const timestamp = Date.now().toString(); 
    await setDoc(doc(db, "nuevas_huellas", timestamp), {
      user_id: biometric_id,
      timestamp: new Date()
    });
    console.log(`Nueva huella enrolada: ${biometric_id}`);
    
    // Una vez enrolada, regresamos el estado general a modo abordaje
    await setDoc(doc(db, "control_rutas", "estado_actual"), {
      registro_activo: true,
      tipo_lectura: "abordaje"
    });

    return res.status(201).end();
  } catch (e) {
    console.error("Error al registrar nueva huella", e);
    return res.status(500).end();
  }
});

// Metodo POST para agregar/actualizar registros de abordaje de usuarios
xpress.post('/api/log', async (req, res) => {
  try {
    const userList = req.body;

    if (!userList || (Array.isArray(userList) && userList.length == 0))
      return res.status(400).end();

    // Si se envia una lista de usuarios para registrar (Vaciando la cola)
    if (Array.isArray(userList)) {
      const batch = writeBatch(db);

      for (const item of userList) {
        const { date, biometric_id, route } = item;

        if (!biometric_id)
          return res.status(400).end();

        const docRef = doc(db, "log", date); // Usa la fecha como ID del documento
        batch.set(docRef, { biometric_id, route });
        console.log(`Objeto registrado en batch: ${JSON.stringify(item)}`);
      }

      await batch.commit();
      return res.status(201).end();
    } else {
      // Si se envia un solo usuario para registrar
      const { date, biometric_id, route } = userList;

      if (!biometric_id)
        return res.status(400).end();

      await setDoc(doc(db, "log", date), {
        biometric_id,
        route
      });

      console.log(`Objeto registrado correctamente: ${JSON.stringify(userList)}`);
      return res.status(201).end();
    }

  }
  catch (e) {
    console.error('Error al guardar lista de abordajes:', e);
    return res.status(500).end();
  }
});

// ------------------------------------------------
// METODOS DE ADMINISTRACIÓN DE USUARIOS
// ------------------------------------------------

// Metodo POST para vincular un usuario a una huella y guardarlo
xpress.post('/api/users', async (req, res) => {
  const { biometric_id, route, name } = req.body;
  if (!biometric_id)
    return res.status(400).end();

  const new_user = {
    route,
    name
  };

  await setDoc(doc(db, "users", biometric_id), new_user);

  console.log(`Usuario ingresado correctamente: ${JSON.stringify(new_user)}`);
  return res.status(201).end();
});

// metodo GET para recuperar el nombre de un usuario por su ID
xpress.get('/api/users/id/:id', async (req, res) => {
  const u_id = req.params.id;
  const docRef = doc(db, "users", u_id);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists())
    return res.status(404).send('Unknown user');
  return res.send(docSnap.data().name)
});

// metodo GET para recibir la lista total de usuarios
xpress.get('/api/users', async (req, res) => {
  const docSnap = await getDocs(collection(db, "users"));
  let users = [];

  if (docSnap.empty)
    return res.status(404).json({ error: "Lista de usuarios vacia" });
  docSnap.forEach((doc) => {
    users.push(doc.data());
  });
  res.json(users);
});

// metodo GET para recibir la lista de usuarios pertenecientes a una ruta
xpress.get('/api/users/route/:route', async (req, res) => {
  const route = req.params.route;
  const q = query(collection(db, "users"), where("route", "==", route));
  const docSnap = await getDocs(q);

  if (!docSnap.empty) {
    let users = [];
    docSnap.forEach((doc) => {
      users.push(doc.data());
    });
    res.json(users);
  } else {
    return res.status(404).json({ error: "Ruta de usuarios vacia" });
  }
});

<<<<<<< HEAD
xpress.get('/home', async (req, res) => {
  const docSnap = await getDocs(collection(db, "users"));
  let users = [];

  if (docSnap.empty)
    return res.status(404).json({ error: "No users" });
  docSnap.forEach((doc) => {
    users.push(doc.data());
  });
  res.write(`
    <table>
      <caption>
        Usuarios del transporte administrado por el sistema SABIP
      </caption>
      <thead>
        <tr>
          <th scope="col">Ruta</th>
          <th scope="col">Nombre</th>
        </tr>
      </thead>
      <tbody>`);
  users.forEach((user) => {
    console.log(user);
    res.write(`
      <tr>
        <td>${user.route}</td>
        <td>${user.name}</td>
      </tr>
      `);
  })
  res.write(`
    </tbody>
    </table>
    `);
  res.end();
});

// configuracion del servidor
=======
// ------------------------------------------------
// INICIO DEL SERVIDOR
// ------------------------------------------------
>>>>>>> probando_web
const hostname = '0.0.0.0';
const port = process.env.PORT || 8080; 

xpress.listen(port, hostname, () => {
  console.log(`Servidor corriendo en http://${hostname}:${port}/`);
  console.log(`PWA disponible en http://${hostname}:${port}/`);
});